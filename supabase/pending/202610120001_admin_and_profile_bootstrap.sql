-- PENDING VERIFICATION — DO NOT DEPLOY UNTIL the live-schema checklist in
-- docs_ADMIN_IMPLEMENTATION.md has been completed by a trusted project owner.
-- This file is intentionally outside supabase/migrations so normal migration
-- deployment does not apply it implicitly.
--
-- The preflight checks fail closed on the app-visible schema contract. They
-- cannot verify the deployed RLS policy design or security-definer ownership;
-- those must be reviewed manually before deployment.
--
-- Candidate version 202610120001 is later than the historical migrations.
-- Confirm it is unused in QR-ATT's remote ledger before deployment; the exact
-- remote historical version mapping was not independently inspected here.
--
-- Role-constraint handling (repaired): an existing
-- gcscan_profiles_role_check is accepted without dropping or recreating it
-- only after its structure (single-column check on profiles.role, validated)
-- and its semantics are verified by probe-evaluating the stored expression
-- (pg_get_expr) against allowed and disallowed role values. The separate
-- profiles_role_valid constraint is never touched.

begin;

do $preflight$
declare
  v_role_con_id oid;
  v_role_expr text;
  v_role_con_validated boolean;
  v_role_attnum smallint;
  v_probe_accepts_valid boolean := false;
  v_probe_rejects_invalid boolean := false;
  v_auth_trigger_count integer;
  v_auth_function_count integer;
  v_auth_function_valid boolean;
begin
  if to_regclass('public.profiles') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'id' and data_type = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'email' and data_type in ('text', 'character varying')
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'full_name' and data_type in ('text', 'character varying')
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'role' and data_type in ('text', 'character varying')
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'created_at' and data_type = 'timestamp with time zone'
     ) then
    raise exception 'Admin migration blocked: verify public.profiles columns and types, including created_at, against the preflight contract.';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public' and t.relname = 'profiles'
      and i.indisunique and i.indisvalid and i.indpred is null
      and i.indexprs is null and i.indnkeyatts = 1 and a.attname = 'id'
  ) then
    raise exception 'Admin migration blocked: public.profiles.id must have a valid unique constraint.';
  end if;

  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'profiles'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%role%'
      and (
        pg_get_constraintdef(c.oid) not ilike '%student%'
        or pg_get_constraintdef(c.oid) not ilike '%teacher%'
      )
  ) then
    raise exception 'Admin migration blocked: a profiles role check constraint may reject student or teacher; review it manually.';
  end if;

  if exists (
    select 1 from public.profiles
    where role is null or role not in ('student', 'teacher')
  ) then
    raise exception 'Admin migration blocked: review existing profiles with roles outside student/teacher before enforcing the allowed role set.';
  end if;

  -- An existing gcscan_profiles_role_check is acceptable. Verify its
  -- structure and live semantics instead of rejecting it by name: it must be
  -- a validated, single-column check on profiles.role whose stored expression
  -- evaluates TRUE for 'student' and 'teacher' and never evaluates TRUE for
  -- out-of-set values. The expression is probe-evaluated from pg_get_expr
  -- output rather than compared as text, so any equivalent definition is
  -- accepted. An unevaluable expression or incompatible semantics fails
  -- closed for manual review. The separate profiles_role_valid constraint is
  -- left untouched.
  select c.oid, c.convalidated, pg_get_expr(c.conbin, c.conrelid),
         (select a.attnum from pg_attribute a
           where a.attrelid = c.conrelid and a.attname = 'role'
             and a.attnum > 0 and not a.attisdropped)
    into v_role_con_id, v_role_con_validated, v_role_expr, v_role_attnum
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'gcscan_profiles_role_check';

  if v_role_con_id is not null then
    if (select c.contype from pg_constraint c where c.oid = v_role_con_id) <> 'c'
       or v_role_attnum is null
       or not exists (
         select 1 from pg_constraint c
         where c.oid = v_role_con_id and c.conkey = array[v_role_attnum]
       ) then
      raise exception 'Admin migration blocked: gcscan_profiles_role_check exists but is not a single-column check constraint on profiles.role; inspect it before continuing.';
    end if;

    if not v_role_con_validated then
      raise exception 'Admin migration blocked: gcscan_profiles_role_check exists but is not validated; review the existing rows, then VALIDATE it before continuing.';
    end if;

    if v_role_expr is null then
      raise exception 'Admin migration blocked: the stored expression of gcscan_profiles_role_check could not be read; inspect it before continuing.';
    end if;

    -- Probe semantics: 'student' and 'teacher' must satisfy the check.
    begin
      execute format(
        'select bool_and((%s) is true) from (values (''student''::text), (''teacher'')) as probes(role)',
        v_role_expr
      ) into v_probe_accepts_valid;
    exception when others then
      raise exception 'Admin migration blocked: the existing gcscan_profiles_role_check expression could not be evaluated against the allowed roles (%). Manual inspection required.', sqlerrm;
    end;

    -- ...and a fixed set of out-of-set values must evaluate strictly FALSE in
    -- it (a CHECK passes on NULL, so a NULL result would mean the constraint
    -- does not actually reject the value).
    begin
      execute format(
        'select bool_and((%s) is false) from (values (''admin''::text), (''administrator''::text), (''staff''::text), (''Student''::text), (''student ''::text), (''teacher ''::text), (''''::text)) as probes(role)',
        v_role_expr
      ) into v_probe_rejects_invalid;
    exception when others then
      raise exception 'Admin migration blocked: the existing gcscan_profiles_role_check expression could not be evaluated against the disallowed roles (%). Manual inspection required.', sqlerrm;
    end;

    if not coalesce(v_probe_accepts_valid, false)
       or not coalesce(v_probe_rejects_invalid, false) then
      raise exception 'Admin migration blocked: the existing gcscan_profiles_role_check does not accept exactly the student/teacher role set; inspect it before continuing.';
    end if;
  end if;

  if exists (
    select 1
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
    where n.nspname = 'public' and t.relname = 'profiles'
      and a.attnum > 0 and not a.attisdropped and a.attnotnull
      and a.attname not in ('id', 'email', 'full_name', 'role')
      and d.oid is null and a.attgenerated = ''
  ) then
    raise exception 'Admin migration blocked: profiles has another required column without a default; include it only after schema review.';
  end if;

  if exists (
    select 1
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
      and (
        (not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'profiles'
            and c.column_name = 'email' and c.is_nullable = 'YES'
        ) and u.email is null)
      )
  ) then
    raise exception 'Admin migration blocked: missing Auth users cannot satisfy required profiles.email/full_name values.';
  end if;

  if to_regclass('public.events') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'events'
         and column_name = 'id' and data_type = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'events'
         and column_name = 'created_by' and data_type = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'events'
         and column_name in ('event_code', 'title')
         and data_type in ('text', 'character varying')
       group by table_name having count(distinct column_name) = 2
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'events'
         and column_name = 'created_at' and data_type = 'timestamp with time zone'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'events'
         and column_name = 'start_time' and data_type = 'timestamp with time zone'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'events'
         and column_name = 'end_time' and data_type = 'timestamp with time zone'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'events'
         and column_name = 'archived_at' and data_type = 'timestamp with time zone'
     ) then
    raise exception 'Admin migration blocked: verify the public.events columns and types used by this migration.';
  end if;

  if to_regclass('public.attendance') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'attendance'
         and column_name in ('id', 'event_id', 'student_id', 'scanned_at', 'attendance_status', 'late_reason')
       group by table_name having count(distinct column_name) = 6
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'attendance'
         and column_name = 'event_id' and data_type = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'attendance'
         and column_name = 'student_id' and data_type = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'attendance'
         and column_name = 'scanned_at' and data_type = 'timestamp with time zone'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'attendance'
         and column_name = 'attendance_status'
         and data_type in ('text', 'character varying')
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'attendance'
         and column_name = 'late_reason'
         and data_type in ('text', 'character varying')
     ) then
    raise exception 'Admin migration blocked: verify the public.attendance columns and types used by this migration.';
  end if;

  select count(*) into v_auth_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'gcscan_auth_user_profile';

  select bool_and(
    p.pronargs = 0
    and p.pronargdefaults = 0
    and p.prorettype = 'trigger'::regtype
    and p.prokind = 'f'
    and not p.proretset
    and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
    and p.provolatile = 'v'
    and not p.proisstrict
    and p.prosecdef
    and p.proparallel = 'u'
    and pg_get_userbyid(p.proowner) = 'postgres'
    and p.proconfig = array['search_path=""']
    and p.prosrc = $expected_auth_profile_function$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.email), ''),
      'Student'
    ),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$expected_auth_profile_function$
  ) into v_auth_function_valid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'gcscan_auth_user_profile';

  if v_auth_function_count > 1
     or (v_auth_function_count = 1 and not coalesce(v_auth_function_valid, false)) then
    raise exception 'Admin migration blocked: public.gcscan_auth_user_profile exists but does not exactly match the reviewed function signature, owner, security settings, search_path, and body.';
  end if;

  select count(*) into v_auth_trigger_count
  from pg_trigger t
  where t.tgrelid = 'auth.users'::regclass
    and not t.tgisinternal;

  if v_auth_trigger_count > 0
     and (
       v_auth_trigger_count <> 1
       or not exists (
         select 1
         from pg_trigger t
         where t.tgrelid = 'auth.users'::regclass
           and not t.tgisinternal
           and t.tgname = 'gcscan_auth_user_profile'
           and t.tgenabled in ('O', 'A')
           and t.tgtype = 5
           and t.tgconstraint = 0
           and not t.tgdeferrable
           and not t.tginitdeferred
           and t.tgparentid = 0
           and t.tgnargs = 0
           and t.tgqual is null
           and t.tgfoid = to_regprocedure('public.gcscan_auth_user_profile()')
       )
     ) then
    raise exception 'Admin migration blocked: auth.users has a non-internal trigger that does not exactly match the reviewed enabled AFTER INSERT FOR EACH ROW profile bootstrap.';
  end if;

  if to_regclass('public.gcscan_admin_members') is not null
     or to_regclass('public.gcscan_attendance_corrections') is not null then
    raise exception 'Admin migration blocked: an administrator object name already exists; inspect its definition before continuing.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'gcscan_is_admin',
        'gcscan_admin_overview',
        'gcscan_admin_list_users',
        'gcscan_admin_set_user_role',
        'gcscan_admin_list_events',
        'gcscan_admin_set_event_archived',
        'gcscan_admin_list_attendance',
        'gcscan_admin_correct_attendance',
        'gcscan_admin_report',
        'gcscan_reject_attendance_audit_mutation'
      )
  ) then
    raise exception 'Admin migration blocked: a function with a proposed administrator RPC name already exists; inspect all overloads before continuing.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where t.tgrelid = 'public.profiles'::regclass
      and not t.tgisinternal
      and t.tgname = 'gcscan_protect_profile_role'
      and t.tgenabled in ('O', 'A')
      and pn.nspname = 'public'
      and p.proname = 'gcscan_protect_profile_role'
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 2
      and (t.tgtype & 4) = 4
      and (t.tgtype & 16) = 16
  ) then
    raise exception 'Admin migration blocked: expected enabled public.gcscan_protect_profile_role trigger for row INSERT and UPDATE was not found on public.profiles.';
  end if;
end;
$preflight$;

-- Create the role constraint only when it does not already exist. When the
-- constraint is present, the preflight above has verified its structure and
-- semantics; it is preserved untouched (as is profiles_role_valid).
do $create_role_constraint$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'gcscan_profiles_role_check'
  ) then
    alter table public.profiles
      add constraint gcscan_profiles_role_check
      check (role in ('student', 'teacher')) not valid;

    alter table public.profiles
      validate constraint gcscan_profiles_role_check;
  end if;
end;
$create_role_constraint$;

alter table public.profiles
  alter column role set not null;

create table public.gcscan_admin_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id)
);

alter table public.gcscan_admin_members enable row level security;
revoke all on table public.gcscan_admin_members from public, anon, authenticated;

create table public.gcscan_attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  attendance_id text not null,
  actor_id uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) >= 3),
  before_record jsonb not null,
  after_record jsonb not null,
  corrected_at timestamptz not null default now()
);

alter table public.gcscan_attendance_corrections enable row level security;
revoke all on table public.gcscan_attendance_corrections from public, anon, authenticated;

create function public.gcscan_reject_attendance_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Attendance correction audit entries are append-only.';
end;
$function$;

revoke all on function public.gcscan_reject_attendance_audit_mutation() from public, anon, authenticated;
create trigger gcscan_attendance_corrections_append_only
before update or delete on public.gcscan_attendance_corrections
for each row execute function public.gcscan_reject_attendance_audit_mutation();
create trigger gcscan_attendance_corrections_no_truncate
before truncate on public.gcscan_attendance_corrections
for each statement execute function public.gcscan_reject_attendance_audit_mutation();

-- Replace the existing profile guard function before the backfill below so
-- that every profile INSERT in this migration is governed by the reviewed
-- student-forcing body; its existing trigger stays attached throughout.
-- Signup metadata is never authoritative for the initial profile role.
create or replace function public.gcscan_protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.role := 'student';
    if auth.role() = 'authenticated' then
      new.email := coalesce(auth.jwt() ->> 'email', new.email);
    end if;
  elsif auth.role() = 'authenticated' then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.created_at is distinct from old.created_at then
      raise exception 'Only display name changes are allowed for this profile'
        using errcode = '42501';
    end if;

    if new.role is distinct from old.role then
      if auth.uid() is null
         or pg_catalog.current_setting('gcscan.admin_role_change_user_id', true)
              is distinct from auth.uid()::text
         or not public.gcscan_is_admin() then
        raise exception 'Only an authorized administrator may change profile roles'
          using errcode = '42501';
      end if;
      if new.role is null or new.role not in ('student', 'teacher') then
        raise exception 'Only student and teacher profile roles are allowed'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- Existing Auth users are preserved: only missing profile IDs are inserted,
-- and an existing profile is never updated or assigned a new role.
insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.email), ''),
    'Student'
  ),
  'student'
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

do $create_auth_profile_function$
begin
  if to_regprocedure('public.gcscan_auth_user_profile()') is null then
    execute $function_ddl$
      create function public.gcscan_auth_user_profile()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $function$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.email), ''),
      'Student'
    ),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
    $function_ddl$;
  end if;
end;
$create_auth_profile_function$;

revoke all on function public.gcscan_auth_user_profile() from public, anon, authenticated;
do $create_auth_profile_trigger$
begin
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and t.tgname = 'gcscan_auth_user_profile'
  ) then
    create trigger gcscan_auth_user_profile
    after insert on auth.users
    for each row execute function public.gcscan_auth_user_profile();
  end if;
end;
$create_auth_profile_trigger$;

create function public.gcscan_is_admin()
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

create function public.gcscan_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'user_count', (select count(*) from public.profiles),
    'event_count', (select count(*) from public.events),
    'attendance_count', (select count(*) from public.attendance),
    'archived_event_count', (select count(*) from public.events where archived_at is not null),
    'correction_count', (select count(*) from public.gcscan_attendance_corrections)
  );
end;
$function$;

create function public.gcscan_admin_list_users(
  p_search text default null,
  p_offset integer default 0,
  p_role text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'A non-negative page offset is required.';
  end if;
  if p_role is not null and p_role not in ('student', 'teacher') then
    raise exception 'Invalid user role filter.';
  end if;
  with candidates as (
    select
      id,
      email,
      full_name,
      role
    from public.profiles
    where (p_search is null
       or email ilike '%' || p_search || '%'
       or coalesce(full_name, '') ilike '%' || p_search || '%')
      and (p_role is null or role = p_role)
    order by full_name nulls last, email, id
    offset p_offset
    limit 101
  ),
  page_rows as (
    select candidates.*, row_number() over (order by full_name nulls last, email, id) as row_number
    from candidates
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(u) - 'row_number' order by row_number)
      from page_rows u where row_number <= 100
    ), '[]'::jsonb),
    'has_more', (select count(*) > 100 from page_rows)
  )
  into result;
  return result;
end;
$function$;

create function public.gcscan_admin_set_user_role(p_user_id uuid, p_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  updated boolean;
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
  select p.role into target_role
  from public.profiles p
  where p.id = p_user_id
  for update;
  if not found then
    return false;
  end if;
  if target_role is null or target_role not in ('student', 'teacher') then
    raise exception 'The target profile has an unverified role.' using errcode = '42501';
  end if;
  perform pg_catalog.set_config(
    'gcscan.admin_role_change_user_id',
    auth.uid()::text,
    true
  );
  -- The existing profile-role trigger function verifies this marker against
  -- the authoritative administrator membership before allowing a role change.
  update public.profiles set role = p_role where id = p_user_id;
  updated := found;
  perform pg_catalog.set_config('gcscan.admin_role_change_user_id', '', true);
  return updated;
end;
$function$;

create function public.gcscan_admin_list_events(p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'A non-negative page offset is required.';
  end if;
  with candidates as (
    select
      id,
      event_code,
      title,
      start_time,
      end_time,
      created_by,
      created_at,
      archived_at
    from public.events
    order by created_at desc, id
    offset p_offset
    limit 101
  ),
  page_rows as (
    select candidates.*, row_number() over (order by created_at desc, id) as row_number
    from candidates
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(e) - 'row_number' order by row_number)
      from page_rows e where row_number <= 100
    ), '[]'::jsonb),
    'has_more', (select count(*) > 100 from page_rows)
  )
  into result;
  return result;
end;
$function$;

create function public.gcscan_admin_set_event_archived(p_event_id uuid, p_archived boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'Archive state is required.';
  end if;
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
  return found;
end;
$function$;

create function public.gcscan_admin_list_attendance(
  p_event_id text default null,
  p_status text default null,
  p_offset integer default 0,
  p_student_id text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'A non-negative page offset is required.';
  end if;
  if p_status is not null and p_status not in ('present', 'late', 'recovered') then
    raise exception 'Invalid attendance status filter.';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'The attendance date range must have its start before its end.';
  end if;
  with candidates as (
    select
      att.id::text as id,
      att.student_id,
      p.full_name as student_name,
      att.event_id,
      e.title as event_title,
      e.event_code,
      att.scanned_at,
      att.attendance_status,
      att.late_reason
    from public.attendance att
    left join public.profiles p on p.id = att.student_id
    left join public.events e on e.id = att.event_id
    where (p_event_id is null or att.event_id::text = p_event_id)
      and (p_status is null or att.attendance_status::text = p_status)
      and (p_student_id is null or att.student_id::text = p_student_id)
      and (p_from is null or att.scanned_at >= p_from)
      and (p_to is null or att.scanned_at < p_to)
    order by att.scanned_at desc, att.id::text
    offset p_offset
    limit 101
  ),
  page_rows as (
    select candidates.*, row_number() over (order by scanned_at desc, id) as row_number
    from candidates
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(a) - 'row_number' order by row_number)
      from page_rows a where row_number <= 100
    ), '[]'::jsonb),
    'has_more', (select count(*) > 100 from page_rows)
  )
  into result;
  return result;
end;
$function$;

create function public.gcscan_admin_correct_attendance(
  p_attendance_id text,
  p_attendance_status text,
  p_late_reason text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_record jsonb;
  corrected_record jsonb;
  audit_id uuid;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_attendance_status is null
     or p_attendance_status not in ('present', 'late', 'recovered') then
    raise exception 'Invalid attendance status.';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 1000 then
    raise exception 'A correction reason of 3 to 1000 characters is required.';
  end if;

  select to_jsonb(a) into previous_record
  from public.attendance a
  where a.id::text = p_attendance_id
  for update;
  if previous_record is null then
    raise exception 'Attendance record not found.';
  end if;

  update public.attendance a
  set attendance_status = p_attendance_status,
      late_reason = p_late_reason
  where a.id::text = p_attendance_id;

  select to_jsonb(a) into corrected_record
  from public.attendance a
  where a.id::text = p_attendance_id;

  insert into public.gcscan_attendance_corrections
    (attendance_id, actor_id, reason, before_record, after_record)
  values
    (p_attendance_id, auth.uid(), btrim(p_reason), previous_record, corrected_record)
  returning id into audit_id;
  return audit_id;
end;
$function$;

create function public.gcscan_admin_report(
  p_event_id text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.gcscan_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'The report date range must have its start before its end.';
  end if;
  select jsonb_build_object(
    'status_counts', coalesce((
      select jsonb_object_agg(status, amount)
      from (
        select coalesce(attendance_status::text, 'unknown') as status, count(*) as amount
        from public.attendance
        where (p_event_id is null or event_id::text = p_event_id)
          and (p_from is null or scanned_at >= p_from)
          and (p_to is null or scanned_at < p_to)
        group by attendance_status
      ) counts
    ), '{}'::jsonb),
    'event_summaries', coalesce((
      select jsonb_agg(
        to_jsonb(summary)
        order by summary.start_time desc nulls last, summary.event_id
      )
      from (
        select
          e.id::text as event_id,
          e.title as event_title,
          e.event_code,
          e.start_time,
          e.end_time,
          count(a.id) as attendance_count,
          coalesce((
            select jsonb_object_agg(status, amount)
            from (
              select coalesce(a2.attendance_status::text, 'unknown') as status, count(*) as amount
              from public.attendance a2
              where a2.event_id = e.id
                and (p_from is null or a2.scanned_at >= p_from)
                and (p_to is null or a2.scanned_at < p_to)
              group by a2.attendance_status
            ) status_totals
          ), '{}'::jsonb) as status_counts
        from public.events e
        left join public.attendance a
          on a.event_id = e.id
          and (p_from is null or a.scanned_at >= p_from)
          and (p_to is null or a.scanned_at < p_to)
        where p_event_id is null or e.id::text = p_event_id
        group by e.id, e.title, e.event_code, e.start_time, e.end_time
        order by e.start_time desc nulls last, e.id
        limit 100
      ) summary
    ), '[]'::jsonb),
    'recent_attendance', coalesce((
      select jsonb_agg(to_jsonb(activity))
      from (
        select
          a.id::text as id,
          a.event_id,
          e.title as event_title,
          e.event_code,
          p.full_name as student_name,
          a.attendance_status,
          a.scanned_at
        from public.attendance a
        left join public.events e on e.id = a.event_id
        left join public.profiles p on p.id = a.student_id
        where (p_event_id is null or a.event_id::text = p_event_id)
          and (p_from is null or a.scanned_at >= p_from)
          and (p_to is null or a.scanned_at < p_to)
        order by a.scanned_at desc, a.id::text
        limit 50
      ) activity
    ), '[]'::jsonb),
    'recent_corrections', coalesce((
      select jsonb_agg(to_jsonb(c))
      from (
        select id, attendance_id, actor_id, reason, corrected_at, before_record, after_record
        from public.gcscan_attendance_corrections c
        where (p_from is null or c.corrected_at >= p_from)
          and (p_to is null or c.corrected_at < p_to)
          and (
            p_event_id is null
            or exists (
              select 1 from public.attendance a
              where a.id::text = c.attendance_id
                and a.event_id::text = p_event_id
            )
          )
        order by c.corrected_at desc
        limit 100
      ) c
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

revoke all on function public.gcscan_is_admin() from public, anon;
revoke all on function public.gcscan_admin_overview() from public, anon;
revoke all on function public.gcscan_admin_list_users(text, integer, text) from public, anon;
revoke all on function public.gcscan_admin_set_user_role(uuid, text) from public, anon;
revoke all on function public.gcscan_admin_list_events(integer) from public, anon;
revoke all on function public.gcscan_admin_set_event_archived(uuid, boolean) from public, anon;
revoke all on function public.gcscan_admin_list_attendance(text, text, integer, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.gcscan_admin_correct_attendance(text, text, text, text) from public, anon;
revoke all on function public.gcscan_admin_report(text, timestamptz, timestamptz) from public, anon;

grant execute on function public.gcscan_is_admin() to authenticated;
grant execute on function public.gcscan_admin_overview() to authenticated;
grant execute on function public.gcscan_admin_list_users(text, integer, text) to authenticated;
grant execute on function public.gcscan_admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.gcscan_admin_list_events(integer) to authenticated;
grant execute on function public.gcscan_admin_set_event_archived(uuid, boolean) to authenticated;
grant execute on function public.gcscan_admin_list_attendance(text, text, integer, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.gcscan_admin_correct_attendance(text, text, text, text) to authenticated;
grant execute on function public.gcscan_admin_report(text, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

commit;
