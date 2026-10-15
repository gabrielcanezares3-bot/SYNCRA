-- PENDING PROPOSAL — do not deploy until migrations 001/002 and the live
-- schema, RLS, grants, and security-definer owners have been reviewed.
-- This proposal deliberately fails closed if the existing event model differs
-- from the client contract. It does not alter QR payloads or attendance keys.

begin;

do $preflight$
begin
  if to_regclass('public.gcscan_admin_members') is null
     or to_regclass('public.gcscan_admin_audit') is null
     or to_regclass('public.gcscan_teacher_access_requests') is null
     or to_regclass('public.gcscan_attendance_corrections') is null
     or to_regprocedure('public.gcscan_is_admin()') is null
     or to_regprocedure('public.gcscan_admin_overview()') is null
     or to_regprocedure('public.gcscan_admin_list_events(integer)') is null
     or to_regclass('public.events') is null
     or to_regclass('public.attendance') is null then
    raise exception 'Event management proposal requires verified admin objects from migrations 001 and 002.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name in ('venue', 'description', 'event_status')
  ) then
    raise exception 'An event detail/status column already exists; inspect its definition before applying this proposal.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'grace_period_minutes' and data_type in ('smallint', 'integer')
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'late_reason_enabled' and data_type = 'boolean'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'zone_enabled' and data_type = 'boolean'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'zone_lat' and data_type in ('real', 'double precision', 'numeric')
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'zone_lon' and data_type in ('real', 'double precision', 'numeric')
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'zone_radius_m' and data_type in ('smallint', 'integer')
  ) then
    raise exception 'Existing attendance-setting columns on public.events do not match the client contract.';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public' and t.relname = 'events'
      and i.indisunique and i.indisvalid and i.indpred is null
      and i.indexprs is null and i.indnkeyatts = 1 and a.attname = 'event_code'
  ) then
    raise exception 'Event code uniqueness is required to prevent duplicate events and preserve QR lookup semantics.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name = 'event_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name = 'attendance_status'
      and data_type in ('text', 'character varying')
  ) then
    raise exception 'The attendance event/status fields do not match the verified client contract.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('gcscan_save_event', 'gcscan_close_event', 'gcscan_reject_closed_event_attendance')
  ) then
    raise exception 'A proposed event-management function already exists; inspect all overloads before continuing.';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'gcscan_events_event_status_check'
  ) then
    raise exception 'The proposed event status constraint name already exists; inspect it before continuing.';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.attendance'::regclass
      and not tgisinternal
      and tgname = 'gcscan_block_attendance_for_closed_events'
  ) then
    raise exception 'The proposed closed-event attendance trigger already exists; inspect it before continuing.';
  end if;
end;
$preflight$;

alter table public.events
  add column venue text,
  add column description text,
  add column event_status text not null default 'active',
  add constraint gcscan_events_event_status_check
    check (event_status in ('active', 'closed'));

-- All application writes now go through the permission-checked, audited RPCs.
-- Preserve existing SELECT grants for event lookup and reporting.
revoke insert, update, delete, truncate on table public.events from anon, authenticated;
do $revoke_event_column_writes$
declare
  event_columns text;
begin
  select string_agg(format('%I', column_name), ', ')
  into event_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'events';
  if event_columns is not null then
    execute format(
      'revoke insert (%1$s), update (%1$s) on table public.events from anon, authenticated',
      event_columns
    );
  end if;
end;
$revoke_event_column_writes$;

create index gcscan_events_status_start_time_idx
  on public.events (event_status, start_time)
  where archived_at is null;

create function public.gcscan_save_event(
  p_event_id uuid,
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_venue text,
  p_description text,
  p_event_status text,
  p_grace_period_minutes integer,
  p_late_reason_enabled boolean,
  p_zone_enabled boolean,
  p_zone_lat double precision,
  p_zone_lon double precision,
  p_zone_radius_m integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  existing_event public.events%rowtype;
  before_event jsonb;
  after_event jsonb;
  saved_event_id uuid;
  zone_is_valid boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.id = auth.uid();
  if not public.gcscan_is_admin() and actor_role is distinct from 'teacher' then
    raise exception 'Only teachers and administrators may manage events.' using errcode = '42501';
  end if;

  if p_event_code is null or length(btrim(p_event_code)) not between 1 and 100
     or p_title is null or length(btrim(p_title)) not between 1 and 200
     or p_start_time is null or p_end_time is null or p_end_time <= p_start_time
     or (p_venue is not null and length(btrim(p_venue)) > 200)
     or (p_description is not null and length(btrim(p_description)) > 5000)
     or (
       p_event_id is null
       and (
         p_venue is null or btrim(p_venue) = ''
         or p_description is null or btrim(p_description) = ''
       )
     )
     or p_event_status is null or p_event_status not in ('active', 'closed')
     or p_grace_period_minutes is null or p_grace_period_minutes not between 0 and 120
     or p_late_reason_enabled is null
     or p_zone_enabled is null
     or p_zone_radius_m is null or p_zone_radius_m not between 25 and 2000 then
    raise exception 'Event fields or attendance settings are invalid.';
  end if;

  zone_is_valid := p_zone_lat is not null and p_zone_lon is not null
    and p_zone_lat between -90 and 90 and p_zone_lon between -180 and 180;
  if p_zone_enabled and not zone_is_valid then
    raise exception 'Enabled attendance zones require valid latitude and longitude.';
  end if;

  if p_event_id is null then
    if p_event_status <> 'active' then
      raise exception 'New events must start active.';
    end if;
    begin
      insert into public.events (
        event_code, title, start_time, end_time, created_by,
        grace_period_minutes, late_reason_enabled, zone_enabled,
        zone_lat, zone_lon, zone_radius_m, venue, description, event_status
      ) values (
        btrim(p_event_code), btrim(p_title), p_start_time, p_end_time, auth.uid(),
        p_grace_period_minutes, p_late_reason_enabled, p_zone_enabled,
        case when p_zone_enabled then p_zone_lat else null end,
        case when p_zone_enabled then p_zone_lon else null end,
        p_zone_radius_m, btrim(p_venue), btrim(p_description), 'active'
      )
      returning id into saved_event_id;
    exception when unique_violation then
      raise exception 'This event code is already in use. Choose a unique code.';
    end;
    select to_jsonb(e) into after_event from public.events e where e.id = saved_event_id;
    insert into public.gcscan_admin_audit(actor_id, action, subject_id, after_record)
    values (auth.uid(), 'event_created', saved_event_id, after_event);
    return saved_event_id;
  end if;

  select * into existing_event
  from public.events e
  where e.id = p_event_id
  for update;
  if not found or existing_event.archived_at is not null then
    raise exception 'The event is unavailable for editing.';
  end if;
  if existing_event.created_by is distinct from auth.uid()
     and not public.gcscan_is_admin() then
    raise exception 'Only the event owner or an administrator may edit this event.' using errcode = '42501';
  end if;
  if existing_event.event_status = 'closed' and p_event_status <> 'closed' then
    raise exception 'Closed events cannot be reopened.';
  end if;

  before_event := to_jsonb(existing_event);
  update public.events
  set event_code = btrim(p_event_code),
      title = btrim(p_title),
      start_time = p_start_time,
      end_time = p_end_time,
      grace_period_minutes = p_grace_period_minutes,
      late_reason_enabled = p_late_reason_enabled,
      zone_enabled = p_zone_enabled,
      zone_lat = case when p_zone_enabled then p_zone_lat else null end,
      zone_lon = case when p_zone_enabled then p_zone_lon else null end,
      zone_radius_m = p_zone_radius_m,
      venue = nullif(btrim(p_venue), ''),
      description = nullif(btrim(p_description), ''),
      event_status = p_event_status
  where id = p_event_id
  returning id into saved_event_id;

  select to_jsonb(e) into after_event from public.events e where e.id = saved_event_id;
  if before_event is distinct from after_event then
    insert into public.gcscan_admin_audit(actor_id, action, subject_id, before_record, after_record)
    values (
      auth.uid(),
      case when existing_event.event_status <> p_event_status and p_event_status = 'closed'
        then 'event_closed' else 'event_updated' end,
      saved_event_id, before_event, after_event
    );
  end if;
  return saved_event_id;
end;
$function$;

create function public.gcscan_close_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event_row public.events%rowtype;
  after_event jsonb;
  actor_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select p.role into actor_role
  from public.profiles p where p.id = auth.uid();
  select * into event_row
  from public.events e
  where e.id = p_event_id and e.archived_at is null
  for update;
  if not found then return false; end if;
  if not public.gcscan_is_admin()
     and (actor_role is distinct from 'teacher'
       or event_row.created_by is distinct from auth.uid()) then
    raise exception 'Only the event owner or an administrator may close this event.' using errcode = '42501';
  end if;
  if event_row.event_status = 'closed' then return true; end if;

  update public.events set event_status = 'closed' where id = p_event_id;
  select to_jsonb(e) into after_event from public.events e where e.id = p_event_id;
  insert into public.gcscan_admin_audit(actor_id, action, subject_id, before_record, after_record)
  values (auth.uid(), 'event_closed', p_event_id, to_jsonb(event_row), after_event);
  return true;
end;
$function$;

create function public.gcscan_reject_closed_event_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.attendance_status::text is distinct from 'recovered'
     and exists (
       select 1 from public.events e
       where e.id = new.event_id and e.event_status = 'closed'
     ) then
    raise exception 'Attendance is closed for this event.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger gcscan_block_attendance_for_closed_events
before insert on public.attendance
for each row execute function public.gcscan_reject_closed_event_attendance();

revoke all on function public.gcscan_save_event(uuid, text, text, timestamptz, timestamptz, text, text, text, integer, boolean, boolean, double precision, double precision, integer) from public, anon;
revoke all on function public.gcscan_close_event(uuid) from public, anon;
revoke all on function public.gcscan_reject_closed_event_attendance() from public, anon, authenticated;
grant execute on function public.gcscan_save_event(uuid, text, text, timestamptz, timestamptz, text, text, text, integer, boolean, boolean, double precision, double precision, integer) to authenticated;
grant execute on function public.gcscan_close_event(uuid) to authenticated;

create or replace function public.gcscan_admin_list_events(p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if auth.uid() is null or not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'A non-negative page offset is required.';
  end if;
  with candidates as (
    select
      e.id,
      e.event_code,
      e.title,
      e.start_time,
      e.end_time,
      e.venue,
      e.description,
      e.event_status,
      e.grace_period_minutes,
      e.late_reason_enabled,
      e.zone_enabled,
      e.zone_lat,
      e.zone_lon,
      e.zone_radius_m,
      e.created_by,
      e.created_at,
      e.archived_at
    from public.events e
    order by e.created_at desc, e.id
    offset p_offset limit 101
  ), page_rows as (
    select candidates.*, row_number() over (order by created_at desc, id) as row_number
    from candidates
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(to_jsonb(e) - 'row_number' order by row_number)
       from page_rows e where row_number <= 100),
      '[]'::jsonb
    ),
    'has_more', (select count(*) > 100 from page_rows)
  ) into result;
  return result;
end;
$function$;

revoke all on function public.gcscan_admin_list_events(integer) from public, anon;
grant execute on function public.gcscan_admin_list_events(integer) to authenticated;

create or replace function public.gcscan_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'user_count', (select count(*) from public.profiles),
    'student_count', (select count(*) from public.profiles where role = 'student'),
    'teacher_count', (select count(*) from public.profiles where role = 'teacher'),
    'event_count', (select count(*) from public.events),
    'active_event_count', (
      select count(*) from public.events
      where archived_at is null and event_status = 'active'
        and (start_time is null or start_time <= now())
        and (end_time is null or end_time > now())
    ),
    'upcoming_event_count', (
      select count(*) from public.events
      where archived_at is null and event_status = 'active'
        and start_time > now() and (end_time is null or end_time > now())
    ),
    'closed_event_count', (
      select count(*) from public.events
      where archived_at is null
        and (event_status = 'closed' or end_time <= now())
    ),
    'attendance_count', (select count(*) from public.attendance),
    'archived_event_count', (
      select count(*) from public.events where archived_at is not null
    ),
    'correction_count', (select count(*) from public.gcscan_attendance_corrections),
    'pending_teacher_request_count', (
      select count(*) from public.gcscan_teacher_access_requests where status = 'pending'
    )
  );
end;
$function$;

revoke all on function public.gcscan_admin_overview() from public, anon;
grant execute on function public.gcscan_admin_overview() to authenticated;

notify pgrst, 'reload schema';

commit;
