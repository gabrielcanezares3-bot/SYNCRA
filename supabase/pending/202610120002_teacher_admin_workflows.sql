-- PENDING PROPOSAL. Requires the separately reviewed admin objects from
-- 202610120001_admin_and_profile_bootstrap.sql. Do not run before verifying the
-- live schema, function owners, grants, RLS, and existing profile-role trigger.
-- Candidate version 202610120002 follows 202610120001; confirm both versions
-- are unused in QR-ATT's remote ledger before deployment.
-- Migration 001 replaces the existing gcscan_protect_profile_role function
-- body and leaves its trigger in place; this migration requires that integration.

begin;

do $preflight$
begin
  if to_regclass('public.gcscan_admin_members') is null
     or to_regclass('public.gcscan_attendance_corrections') is null
     or to_regprocedure('public.gcscan_is_admin()') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Teacher/admin workflow proposal requires the verified admin and profile objects from migration 001.';
  end if;
  if to_regclass('public.gcscan_teacher_access_requests') is not null
     or to_regclass('public.gcscan_notifications') is not null
     or to_regclass('public.gcscan_admin_audit') is not null then
    raise exception 'A teacher workflow object name already exists; inspect it before applying this proposal.';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'gcscan_reject_admin_audit_mutation',
        'gcscan_get_my_teacher_access_requests',
        'gcscan_submit_teacher_access_request',
        'gcscan_withdraw_teacher_access_request',
        'gcscan_get_my_notifications',
        'gcscan_mark_my_notification_read',
        'gcscan_admin_list_teacher_requests',
        'gcscan_admin_decide_teacher_request',
        'gcscan_admin_list_audit',
        'gcscan_admin_list_admin_members',
        'gcscan_admin_grant_membership',
        'gcscan_admin_revoke_membership'
      )
  ) then
    raise exception 'A function with a proposed teacher/admin RPC name already exists; inspect all overloads before continuing.';
  end if;
  if to_regprocedure('public.gcscan_admin_list_teacher_requests(text,integer)') is not null
     or to_regprocedure('public.gcscan_admin_decide_teacher_request(uuid,text,text)') is not null
     or to_regprocedure('public.gcscan_admin_list_audit(text,integer)') is not null
     or to_regprocedure('public.gcscan_admin_list_admin_members(integer)') is not null
     or to_regprocedure('public.gcscan_admin_grant_membership(uuid)') is not null
     or to_regprocedure('public.gcscan_admin_revoke_membership(uuid)') is not null
     or to_regprocedure('public.gcscan_get_my_teacher_access_requests()') is not null
     or to_regprocedure('public.gcscan_submit_teacher_access_request(text)') is not null
     or to_regprocedure('public.gcscan_withdraw_teacher_access_request(uuid)') is not null
     or to_regprocedure('public.gcscan_get_my_notifications(integer)') is not null
     or to_regprocedure('public.gcscan_mark_my_notification_read(uuid)') is not null
     or to_regprocedure('public.gcscan_reject_admin_audit_mutation()') is not null then
    raise exception 'A teacher workflow function name already exists; inspect it before applying this proposal.';
  end if;
  if to_regprocedure('public.gcscan_admin_list_users(text,integer,text)') is null
     or to_regprocedure('public.gcscan_admin_set_user_role(uuid,text)') is null
     or to_regprocedure('public.gcscan_admin_set_event_archived(uuid,boolean)') is null then
    raise exception 'The expected role, event, and user administration functions from migration 001 are missing.';
  end if;
  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.profiles'::regclass
      and not t.tgisinternal
      and t.tgname = 'gcscan_protect_profile_role'
      and t.tgenabled in ('O', 'A')
      and p.prosrc ilike '%new.role := ''student''%'
      and p.prosrc ilike '%gcscan.admin_role_change_user_id%'
      and p.prosrc ilike '%gcscan_is_admin%'
  ) then
    raise exception 'The existing profile-role trigger is not using the reviewed student-default and membership-checked admin path from migration 001.';
  end if;
end;
$preflight$;

create or replace function public.gcscan_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and exists (
      select 1 from public.gcscan_admin_members m
      where m.user_id = auth.uid()
    );
$function$;

create table public.gcscan_teacher_access_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(btrim(reason)) >= 3),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'withdrawn', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete restrict,
  decision_reason text
);
create unique index gcscan_teacher_requests_one_pending
  on public.gcscan_teacher_access_requests(student_id)
  where status = 'pending';
alter table public.gcscan_teacher_access_requests enable row level security;
revoke all on table public.gcscan_teacher_access_requests from public, anon, authenticated;

create table public.gcscan_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete restrict,
  kind text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index gcscan_notifications_recipient_created
  on public.gcscan_notifications(recipient_id, created_at desc);
alter table public.gcscan_notifications enable row level security;
revoke all on table public.gcscan_notifications from public, anon, authenticated;

create table public.gcscan_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  subject_id uuid,
  reason text,
  before_record jsonb,
  after_record jsonb,
  created_at timestamptz not null default now()
);
create index gcscan_admin_audit_created on public.gcscan_admin_audit(created_at desc);
alter table public.gcscan_admin_audit enable row level security;
revoke all on table public.gcscan_admin_audit from public, anon, authenticated;

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
      where archived_at is null
        and (start_time is null or start_time <= now())
        and (end_time is null or end_time > now())
    ),
    'upcoming_event_count', (
      select count(*) from public.events
      where archived_at is null and start_time > now()
        and (end_time is null or end_time > now())
    ),
    'closed_event_count', (
      select count(*) from public.events
      where archived_at is null and end_time <= now()
    ),
    'attendance_count', (select count(*) from public.attendance),
    'archived_event_count', (select count(*) from public.events where archived_at is not null),
    'correction_count', (select count(*) from public.gcscan_attendance_corrections),
    'pending_teacher_request_count', (
      select count(*) from public.gcscan_teacher_access_requests where status = 'pending'
    )
  );
end;
$function$;

create function public.gcscan_reject_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Administrator audit entries are append-only.';
end;
$function$;
revoke all on function public.gcscan_reject_admin_audit_mutation() from public, anon, authenticated;
create trigger gcscan_admin_audit_no_update_delete
before update or delete on public.gcscan_admin_audit
for each row execute function public.gcscan_reject_admin_audit_mutation();
create trigger gcscan_admin_audit_no_truncate
before truncate on public.gcscan_admin_audit
for each statement execute function public.gcscan_reject_admin_audit_mutation();

create function public.gcscan_get_my_teacher_access_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(r) order by r.requested_at desc), '[]'::jsonb))
  into result
  from public.gcscan_teacher_access_requests r
  where r.student_id = auth.uid();
  return result;
end;
$function$;

create function public.gcscan_submit_teacher_access_request(p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_role text;
  request_id uuid;
  request_record jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 1000 then
    raise exception 'A reason of 3 to 1000 characters is required.';
  end if;
  select p.role into profile_role
  from public.profiles p
  where p.id = auth.uid()
  for update;
  if not found or profile_role <> 'student' or public.gcscan_is_admin() then
    raise exception 'Only non-administrator student accounts may request teacher access.' using errcode = '42501';
  end if;
  insert into public.gcscan_teacher_access_requests(student_id, reason)
  values (auth.uid(), btrim(p_reason))
  returning id into request_id;
  select to_jsonb(r) into request_record
  from public.gcscan_teacher_access_requests r
  where r.id = request_id;
  insert into public.gcscan_admin_audit(actor_id, action, subject_id, after_record)
  values (auth.uid(), 'teacher_request_submitted', request_id, request_record);
  insert into public.gcscan_notifications(recipient_id, kind, title, body)
  select m.user_id, 'teacher_request_submitted', 'New teacher access request',
    'A student submitted a teacher access request for administrator review.'
  from public.gcscan_admin_members m;
  return request_id;
end;
$function$;

create function public.gcscan_withdraw_teacher_access_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare request_row public.gcscan_teacher_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into request_row
  from public.gcscan_teacher_access_requests
  where id = p_request_id and student_id = auth.uid()
  for update;
  if not found or request_row.status <> 'pending' then
    return false;
  end if;
  update public.gcscan_teacher_access_requests
  set status = 'withdrawn'
  where id = p_request_id and student_id = auth.uid() and status = 'pending';
  if not found then
    return false;
  end if;
  insert into public.gcscan_admin_audit(actor_id, action, subject_id, reason, before_record, after_record)
  values (
    auth.uid(), 'teacher_request_withdrawn', request_row.id, request_row.reason,
    to_jsonb(request_row), jsonb_build_object('id', request_row.id, 'status', 'withdrawn')
  );
  return true;
end;
$function$;

create function public.gcscan_get_my_notifications(p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'A non-negative page offset is required.';
  end if;
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(page) - 'row_number' order by row_number)
      from (
        select selected.*,
          row_number() over (order by created_at desc, id desc) as row_number
        from (
          select id, kind, title, body, created_at, read_at
          from public.gcscan_notifications
          where recipient_id = auth.uid()
          order by created_at desc, id desc
          offset p_offset limit 101
        ) selected
      ) page
      where row_number <= 100
    ), '[]'::jsonb),
    'has_more', (
      select count(*) > 100
      from (
        select id
        from public.gcscan_notifications
        where recipient_id = auth.uid()
        order by created_at desc, id desc
        offset p_offset limit 101
      ) page_count
    )
  ) into result;
  return result;
end;
$function$;

create function public.gcscan_mark_my_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  update public.gcscan_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and recipient_id = auth.uid();
  return found;
end;
$function$;

create function public.gcscan_admin_list_teacher_requests(
  p_status text default 'pending',
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0
     or (p_status is not null and p_status not in ('pending', 'approved', 'declined', 'withdrawn', 'cancelled')) then
    raise exception 'Invalid request status or page offset.';
  end if;
  with candidates as (
    select r.id, r.student_id, p.full_name as student_name, p.email as student_email,
      r.reason, r.status, r.requested_at, r.reviewed_at, r.reviewer_id, r.decision_reason
    from public.gcscan_teacher_access_requests r
    left join public.profiles p on p.id = r.student_id
    where (p_status is null or r.status = p_status)
      and not exists (
        select 1 from public.gcscan_admin_members m where m.user_id = r.student_id
      )
    order by r.requested_at desc, r.id
    offset p_offset limit 101
  ), page_rows as (
    select candidates.*, row_number() over (order by requested_at desc, id) as row_number
    from candidates
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(r) - 'row_number' order by row_number) from page_rows r where row_number <= 100), '[]'::jsonb),
    'has_more', (select count(*) > 100 from page_rows)
  ) into result;
  return result;
end;
$function$;

create function public.gcscan_admin_decide_teacher_request(
  p_request_id uuid,
  p_decision text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare request_row public.gcscan_teacher_access_requests%rowtype;
  before_profile jsonb;
  after_profile jsonb;
  profile_role text;
begin
  if auth.uid() is null or not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'declined', 'cancelled') then
    raise exception 'Invalid teacher request decision.';
  end if;
  if p_decision in ('declined', 'cancelled')
     and (p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 1000) then
    raise exception 'A reason of 3 to 1000 characters is required for this decision.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(91352, 1001);
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select * into request_row
  from public.gcscan_teacher_access_requests
  where id = p_request_id
  for update;
  if not found or request_row.status <> 'pending' then
    raise exception 'The request is no longer pending.';
  end if;
  if p_decision = 'approved' then
    select p.role, to_jsonb(p) into profile_role, before_profile
    from public.profiles p
    where p.id = request_row.student_id
    for update;
    if before_profile is null then raise exception 'Student profile not found.'; end if;
    if profile_role is distinct from 'student' then
      raise exception 'Only a student-role account can be approved for teacher access.'
        using errcode = '42501';
    end if;
    if exists (
      select 1 from public.gcscan_admin_members m
      where m.user_id = request_row.student_id
    ) then
      raise exception 'Administrator members cannot be approved through teacher access requests.'
        using errcode = '42501';
    end if;
    perform pg_catalog.set_config('gcscan.admin_role_change_user_id', auth.uid()::text, true);
    update public.profiles set role = 'teacher' where id = request_row.student_id;
    perform pg_catalog.set_config('gcscan.admin_role_change_user_id', '', true);
    select to_jsonb(p) into after_profile from public.profiles p where p.id = request_row.student_id;
  end if;
  update public.gcscan_teacher_access_requests
  set status = p_decision,
      reviewed_at = now(),
      reviewer_id = auth.uid(),
      decision_reason = nullif(btrim(p_reason), '')
  where id = p_request_id;
  insert into public.gcscan_admin_audit(actor_id, action, subject_id, reason, before_record, after_record)
  values (
    auth.uid(), 'teacher_request_' || p_decision, request_row.student_id,
    nullif(btrim(p_reason), ''),
    case when p_decision = 'approved' then before_profile else to_jsonb(request_row) end,
    case when p_decision = 'approved' then after_profile else jsonb_build_object('request_id', p_request_id, 'status', p_decision) end
  );
  insert into public.gcscan_notifications(recipient_id, kind, title, body)
  values (
    request_row.student_id,
    'teacher_request_' || p_decision,
    'Teacher access request ' || p_decision,
    case when p_decision = 'approved' then 'Your account now has teacher access.'
      else coalesce(nullif(btrim(p_reason), ''), 'Your request status has changed.') end
  );
  return true;
end;
$function$;

create function public.gcscan_admin_list_audit(
  p_category text default null,
  p_offset integer default 0
)
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
      a.id,
      coalesce(a.actor_id::text, 'trusted project owner') as actor_id,
      a.action,
      a.subject_id,
      a.reason,
      a.before_record,
      a.after_record,
      a.created_at
    from public.gcscan_admin_audit a
    where p_category is null or a.action like p_category || '%'
    union all
    select
      c.id,
      c.actor_id::text,
      'attendance_correction',
      null::uuid,
      c.reason,
      c.before_record,
      c.after_record,
      c.corrected_at
    from public.gcscan_attendance_corrections c
    where p_category is null or p_category = 'attendance'
  ), ordered as (
    select *, row_number() over (order by created_at desc, id) as row_number
    from candidates
    offset p_offset limit 101
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(a) - 'row_number' order by row_number) from ordered a where row_number <= 100), '[]'::jsonb),
    'has_more', (select count(*) > 100 from ordered)
  ) into result;
  return result;
end;
$function$;

create function public.gcscan_admin_list_admin_members(p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'A non-negative page offset is required.';
  end if;
  with candidates as (
    select m.user_id, coalesce(u.email, '') as email, p.full_name, m.granted_at, m.granted_by
    from public.gcscan_admin_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    order by m.granted_at, m.user_id
    offset p_offset limit 101
  ), page_rows as (
    select candidates.*, row_number() over (order by granted_at, user_id) as row_number
    from candidates
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(m) - 'row_number' order by row_number) from page_rows m where row_number <= 100), '[]'::jsonb),
    'has_more', (select count(*) > 100 from page_rows)
  ) into result;
  return result;
end;
$function$;

create function public.gcscan_admin_grant_membership(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  pending_request public.gcscan_teacher_access_requests%rowtype;
  membership_granted boolean := false;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'A valid Auth user UUID is required.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Administrator membership cannot be self-granted.' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(91352, 1001);
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  perform 1
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = p_user_id
  for update of u, p;
  if not found then
    raise exception 'The target Auth account must have a profile.' using errcode = '42501';
  end if;
  insert into public.gcscan_admin_members(user_id, granted_by)
  values (p_user_id, auth.uid())
  on conflict (user_id) do nothing;
  membership_granted := found;
  if membership_granted then
    insert into public.gcscan_admin_audit(actor_id, action, subject_id, after_record)
    values (auth.uid(), 'admin_membership_granted', p_user_id, jsonb_build_object('user_id', p_user_id));
    select * into pending_request
    from public.gcscan_teacher_access_requests
    where student_id = p_user_id and status = 'pending'
    for update;
    if found then
      update public.gcscan_teacher_access_requests
      set status = 'cancelled',
          reviewed_at = now(),
          reviewer_id = auth.uid(),
          decision_reason = 'Administrator membership granted.'
      where id = pending_request.id;
      insert into public.gcscan_admin_audit(
        actor_id, action, subject_id, reason, before_record, after_record
      ) values (
        auth.uid(), 'teacher_request_cancelled', p_user_id,
        'Administrator membership granted.',
        to_jsonb(pending_request),
        jsonb_build_object('id', pending_request.id, 'status', 'cancelled')
      );
      insert into public.gcscan_notifications(recipient_id, kind, title, body)
      values (
        p_user_id, 'teacher_request_cancelled',
        'Teacher access request closed',
        'The request was closed because this account now has administrator access.'
      );
    end if;
  end if;
  return membership_granted;
end;
$function$;

create function public.gcscan_admin_revoke_membership(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare active_admins bigint;
begin
  if auth.uid() is null or not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_user_id is null then raise exception 'A user UUID is required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(91352, 1001);
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select count(*) into active_admins
  from public.gcscan_admin_members;
  if not exists (select 1 from public.gcscan_admin_members where user_id = p_user_id) then
    return false;
  end if;
  if active_admins <= 1 then
    raise exception 'The last administrator cannot be removed.'
      using errcode = '42501';
  end if;
  delete from public.gcscan_admin_members where user_id = p_user_id;
  insert into public.gcscan_admin_audit(actor_id, action, subject_id, before_record)
  values (auth.uid(), 'admin_membership_revoked', p_user_id, jsonb_build_object('user_id', p_user_id));
  return found;
end;
$function$;

create or replace function public.gcscan_admin_set_event_archived(p_event_id uuid, p_archived boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare before_event jsonb; after_event jsonb;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_archived is null then raise exception 'Archive state is required.'; end if;
  select to_jsonb(e) into before_event
  from public.events e where e.id = p_event_id for update;
  if before_event is null then return false; end if;
  update public.events
  set archived_at = case
    when p_archived and archived_at is null then now()
    when not p_archived then null
    else archived_at
  end
  where id = p_event_id
    and (
      (p_archived and archived_at is null)
      or (
        not p_archived
        and archived_at is not null
        and archived_at > now() - interval '15 days'
      )
    );
  if not found then
    raise exception 'Event could not be changed; it may have expired from retention.';
  end if;
  select to_jsonb(e) into after_event from public.events e where e.id = p_event_id;
  insert into public.gcscan_admin_audit(actor_id, action, subject_id, before_record, after_record)
  values (auth.uid(), case when p_archived then 'event_archived' else 'event_restored' end, p_event_id, before_event, after_event);
  return true;
end;
$function$;

-- The RPC must remain unusable until the deployed profile-role trigger has
-- been reviewed and adapted to permit only this membership-checked context.
create or replace function public.gcscan_admin_set_user_role(p_user_id uuid, p_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  before_profile jsonb;
  after_profile jsonb;
  target_role text;
begin
  if auth.uid() is null or not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_user_id is null or p_role is null or p_role not in ('student', 'teacher') then
    raise exception 'Only student and teacher profile roles may be assigned.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(91352, 1001);
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select p.role, to_jsonb(p) into target_role, before_profile
  from public.profiles p
  where p.id = p_user_id
  for update;
  if before_profile is null then return false; end if;
  if target_role is null or target_role not in ('student', 'teacher') then
    raise exception 'The target profile has an unverified role.' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('gcscan.admin_role_change_user_id', auth.uid()::text, true);
  update public.profiles set role = p_role where id = p_user_id;
  perform pg_catalog.set_config('gcscan.admin_role_change_user_id', '', true);
  select to_jsonb(p) into after_profile from public.profiles p where p.id = p_user_id;
  if before_profile is distinct from after_profile then
    insert into public.gcscan_admin_audit(actor_id, action, subject_id, before_record, after_record)
    values (auth.uid(), 'profile_role_changed', p_user_id, before_profile, after_profile);
  end if;
  return true;
end;
$function$;

revoke all on function public.gcscan_get_my_teacher_access_requests() from public, anon;
revoke all on function public.gcscan_submit_teacher_access_request(text) from public, anon;
revoke all on function public.gcscan_withdraw_teacher_access_request(uuid) from public, anon;
revoke all on function public.gcscan_get_my_notifications(integer) from public, anon;
revoke all on function public.gcscan_mark_my_notification_read(uuid) from public, anon;
revoke all on function public.gcscan_admin_list_teacher_requests(text, integer) from public, anon;
revoke all on function public.gcscan_admin_decide_teacher_request(uuid, text, text) from public, anon;
revoke all on function public.gcscan_admin_list_audit(text, integer) from public, anon;
revoke all on function public.gcscan_admin_list_admin_members(integer) from public, anon;
revoke all on function public.gcscan_admin_grant_membership(uuid) from public, anon;
revoke all on function public.gcscan_admin_revoke_membership(uuid) from public, anon;
revoke all on function public.gcscan_admin_set_user_role(uuid, text) from public, anon;

grant execute on function public.gcscan_get_my_teacher_access_requests() to authenticated;
grant execute on function public.gcscan_submit_teacher_access_request(text) to authenticated;
grant execute on function public.gcscan_withdraw_teacher_access_request(uuid) to authenticated;
grant execute on function public.gcscan_get_my_notifications(integer) to authenticated;
grant execute on function public.gcscan_mark_my_notification_read(uuid) to authenticated;
grant execute on function public.gcscan_admin_list_teacher_requests(text, integer) to authenticated;
grant execute on function public.gcscan_admin_decide_teacher_request(uuid, text, text) to authenticated;
grant execute on function public.gcscan_admin_list_audit(text, integer) to authenticated;
grant execute on function public.gcscan_admin_list_admin_members(integer) to authenticated;
grant execute on function public.gcscan_admin_grant_membership(uuid) to authenticated;
grant execute on function public.gcscan_admin_revoke_membership(uuid) to authenticated;
grant execute on function public.gcscan_admin_set_user_role(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
