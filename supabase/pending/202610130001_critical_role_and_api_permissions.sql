-- SYNCRA critical security hardening (targeted, data-preserving).
-- Review against the live schema before execution. Does not create/promote admins
-- and does not run event cleanup.

begin;

-- Fail closed if the expected schema and the exact role-guard trigger are not present.
do $preflight$
declare
  v_profiles oid := to_regclass('public.profiles');
  v_events oid := to_regclass('public.events');
  v_attendance oid := to_regclass('public.attendance');
  v_recovery oid := to_regclass('public.attendance_recovery_requests');
begin
  if v_profiles is null or v_events is null or v_attendance is null or v_recovery is null
     or to_regprocedure('public.gcscan_protect_profile_role()') is null
     or to_regprocedure('public.gcscan_is_admin()') is null
     or to_regprocedure('public.gcscan_admin_set_user_role(uuid,text)') is null
     or to_regprocedure('public.gcscan_purge_expired_events()') is null
     or to_regprocedure('public.gcscan_archive_event(uuid)') is null
     or to_regprocedure('public.gcscan_restore_event(uuid)') is null
     or to_regprocedure('public.gcscan_delete_event_permanently(uuid)') is null then
    raise exception 'Preflight failed: expected SYNCRA tables/function are missing; no changes applied.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'full_name'
  ) then
    raise exception 'Preflight failed: profiles.role/full_name contract is missing; no changes applied.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and t.tgname = 'gcscan_protect_profile_role'
      and not t.tgisinternal and t.tgenabled <> 'D'
      and pn.nspname = 'public' and p.proname = 'gcscan_protect_profile_role'
  ) then
    raise exception 'Preflight failed: expected enabled role-guard trigger is missing or points to another function; no changes applied.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = v_profiles
      and t.tgname = 'gcscan_protect_profile_role'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and p.prosrc ilike '%new.role := ''student''%'
      and p.prosrc ilike '%gcscan.admin_role_change_user_id%'
      and p.prosrc ilike '%gcscan_is_admin%'
  ) then
    raise exception 'Preflight failed: profile trigger must default signups to student and support the membership-checked admin role workflow.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = v_recovery and relrowsecurity and not relforcerowsecurity
  ) then
    raise exception 'Preflight failed: attendance_recovery_requests must have RLS enabled and must not FORCE RLS.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance_recovery_requests'
      and column_name = 'student_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance_recovery_requests'
      and column_name = 'event_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'role'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'created_by' and data_type = 'uuid'
  ) then
    raise exception 'Preflight failed: recovery ownership columns do not match the reviewed policy contract.';
  end if;

  if exists (
    select 1 from pg_policy
    where polrelid = v_recovery
      and polname in ('gcscan_recovery_request_read', 'gcscan_recovery_request_read_guard')
  ) or to_regprocedure('public.gcscan_can_access_recovery_request(uuid,uuid)') is not null then
    raise exception 'Preflight failed: a proposed recovery policy/helper already exists; inspect it before continuing.';
  end if;
end;
$preflight$;

-- Keep the admin workflow's transaction-local authorization marker while limiting
-- authenticated profile edits to full_name and membership-checked role changes.
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
    if (to_jsonb(new) - 'full_name' - 'role' - 'updated_at')
       is distinct from (to_jsonb(old) - 'full_name' - 'role' - 'updated_at') then
      raise exception 'Only full_name and authorized role changes are allowed for this profile'
        using errcode = '42501';
    end if;
    if new.role is distinct from old.role then
      if auth.uid() is null
         or pg_catalog.current_setting('gcscan.admin_role_change_user_id', true)
              is distinct from auth.uid()::text
         or not public.gcscan_is_admin()
         or new.role is null
         or new.role not in ('student', 'teacher') then
        raise exception 'Only an authorized administrator may change profile roles'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- The historical retention RPC is global cleanup, not a client operation.
-- No scheduler/server cleanup exists in this repository; keep it owner-only until
-- a trusted cleanup mechanism is deliberately provisioned.
revoke all on function public.gcscan_purge_expired_events() from public, anon, authenticated;
alter function public.gcscan_purge_expired_events() set search_path = '';
alter function public.gcscan_archive_event(uuid) set search_path = '';
alter function public.gcscan_restore_event(uuid) set search_path = '';
alter function public.gcscan_delete_event_permanently(uuid) set search_path = '';

-- API privilege hardening. Keep event writes and recovery creation on checked RPCs.
revoke all privileges on table public.profiles from public, anon;
revoke all privileges on table public.events from public, anon;
revoke all privileges on table public.attendance from public, anon;
revoke all privileges on table public.attendance_recovery_requests from public, anon;


revoke insert, update, delete, references, trigger, truncate on table public.profiles from authenticated;
revoke insert, update, delete, references, trigger, truncate on table public.events from authenticated;
revoke insert, update, delete, references, trigger, truncate on table public.attendance from authenticated;
revoke insert, update, delete, references, trigger, truncate on table public.attendance_recovery_requests from authenticated;

-- Explicit grants for known client paths; RLS still controls individual rows.
grant select on table public.profiles to authenticated;
grant select on table public.events to authenticated;
grant select on table public.attendance to authenticated;
grant select on table public.attendance_recovery_requests to authenticated;

-- Clear any pre-existing column-specific grants before restoring profile
-- display-name edits.
do $revoke_column_privileges$
declare
  target record;
  column_names text;
begin
  for target in
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'profiles', 'events', 'attendance', 'attendance_recovery_requests'
      )
  loop
    select string_agg(format('%I', column_name), ', ')
    into column_names
    from information_schema.columns
    where table_schema = 'public' and table_name = target.table_name;
    if column_names is not null then
      execute format(
        'revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) on table public.%2$I from public, anon, authenticated',
        column_names, target.table_name
      );
    end if;
  end loop;
end;
$revoke_column_privileges$;

-- Restore the intended profile display-name editing after column grants clear.
grant update (full_name) on table public.profiles to authenticated;

create function public.gcscan_can_access_recovery_request(
  p_student_id uuid,
  p_event_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and (
    (
      p_student_id = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'student'
      )
    )
    or (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'teacher'
      )
      and exists (
        select 1 from public.events e
        where e.id = p_event_id and e.created_by = auth.uid()
      )
    )
  );
$function$;

revoke all on function public.gcscan_can_access_recovery_request(uuid, uuid) from public, anon;
grant execute on function public.gcscan_can_access_recovery_request(uuid, uuid) to authenticated;

create policy gcscan_recovery_request_read
on public.attendance_recovery_requests
as permissive for select to authenticated
using (public.gcscan_can_access_recovery_request(student_id, event_id));

-- This restrictive policy caps any broader existing permissive SELECT policy.
create policy gcscan_recovery_request_read_guard
on public.attendance_recovery_requests
as restrictive for select to authenticated
using (public.gcscan_can_access_recovery_request(student_id, event_id));

-- Do not grant admin privileges, alter existing profile roles, or touch existing rows.
notify pgrst, 'reload schema';
commit;
