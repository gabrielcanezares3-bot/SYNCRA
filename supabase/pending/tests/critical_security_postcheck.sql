-- Read-only post-migration verification for SYNCRA critical security fix.
-- Run as project owner in SQL Editor. Any row returned by the second query is a failure.

-- Human-readable effective privilege snapshot (includes inherited grants).
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete,
  has_table_privilege('authenticated', c.oid, 'TRIGGER') as authenticated_trigger,
  has_table_privilege('authenticated', c.oid, 'REFERENCES') as authenticated_references,
  has_table_privilege('authenticated', c.oid, 'TRUNCATE') as authenticated_truncate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles','events','attendance','attendance_recovery_requests')
order by c.relname;

-- Assertion-style checks. Zero rows means these checks passed.
with expected(table_name, privilege_name, should_have) as (
  values
    ('profiles','SELECT',true),
    ('events','SELECT',true),
    ('attendance','SELECT',true),
    ('attendance_recovery_requests','SELECT',true)
), tables as (
  select c.relname, c.oid, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
), failures as (
  select 'missing_table_or_rls_disabled'::text as issue, t.relname as table_name, null::text as privilege_name
  from tables t where t.relname in ('profiles','events','attendance','attendance_recovery_requests')
    and (not t.relrowsecurity)
  union all
  select 'unexpected_anon_privilege', t.relname, p.privilege_name
  from tables t cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege_name)
  where t.relname in ('profiles','events','attendance','attendance_recovery_requests')
    and has_table_privilege('anon', t.oid, p.privilege_name)
  union all
  select 'unexpected_authenticated_privilege', t.relname, p.privilege_name
  from tables t cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege_name)
  where t.relname = 'profiles' and has_table_privilege('authenticated', t.oid, p.privilege_name)
  union all
  select 'unexpected_authenticated_privilege', t.relname, p.privilege_name
  from tables t cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege_name)
  where t.relname = 'events' and has_table_privilege('authenticated', t.oid, p.privilege_name)
  union all
  select 'unexpected_authenticated_privilege', t.relname, p.privilege_name
  from tables t cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege_name)
  where t.relname = 'attendance' and has_table_privilege('authenticated', t.oid, p.privilege_name)
  union all
  select 'unexpected_authenticated_privilege', t.relname, p.privilege_name
  from tables t cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege_name)
  where t.relname = 'attendance_recovery_requests' and has_table_privilege('authenticated', t.oid, p.privilege_name)
  union all
  select 'unexpected_authenticated_column_privilege',
    c.table_name,
    p.privilege_name || ':' || c.column_name
  from information_schema.columns c
  cross join (values ('INSERT'),('UPDATE'),('REFERENCES')) p(privilege_name)
  where c.table_schema = 'public'
    and c.table_name in ('profiles','events','attendance','attendance_recovery_requests')
    and not (
      c.table_name = 'profiles'
      and c.column_name = 'full_name'
      and p.privilege_name = 'UPDATE'
    )
    and has_column_privilege(
      'authenticated',
      format('%I.%I', c.table_schema, c.table_name),
      c.column_name,
      p.privilege_name
    )
  union all
  select 'unexpected_anon_column_privilege',
    c.table_name,
    p.privilege_name || ':' || c.column_name
  from information_schema.columns c
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege_name)
  where c.table_schema = 'public'
    and c.table_name in ('profiles','events','attendance','attendance_recovery_requests')
    and has_column_privilege(
      'anon',
      format('%I.%I', c.table_schema, c.table_name),
      c.column_name,
      p.privilege_name
    )
  union all
  select 'missing_expected_authenticated_privilege', e.table_name, e.privilege_name
  from expected e join tables t on t.relname = e.table_name
  where not has_table_privilege('authenticated', t.oid, e.privilege_name)
  union all
  select 'missing_profile_full_name_update', 'profiles', 'UPDATE:full_name'
  where not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
  union all
  select 'purge_rpc_still_executable', 'events', 'EXECUTE'
  where has_function_privilege('authenticated', 'public.gcscan_purge_expired_events()', 'EXECUTE')
  union all
  select 'invalid_recovery_read_policy', 'attendance_recovery_requests',
    'expected authenticated SELECT; USING gcscan_can_access_recovery_request(student_id, event_id); no WITH CHECK'
  where not exists (
    select 1
    from pg_policy p
    where p.polrelid = 'public.attendance_recovery_requests'::regclass
      and p.polname = 'gcscan_recovery_request_read'
      and p.polcmd = 'r'
      and p.polpermissive
      and cardinality(p.polroles) = 1
      and p.polroles[1] = (select oid from pg_roles where rolname = 'authenticated')
      and p.polqual is not null
      and replace(
        regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]', '', 'g'),
        'public.',
        ''
      ) = 'gcscan_can_access_recovery_request(student_id,event_id)'
      and p.polwithcheck is null
  )
  union all
  select 'invalid_recovery_read_guard_policy', 'attendance_recovery_requests',
    'expected restrictive authenticated SELECT; USING gcscan_can_access_recovery_request(student_id, event_id); no WITH CHECK'
  where not exists (
    select 1
    from pg_policy p
    where p.polrelid = 'public.attendance_recovery_requests'::regclass
      and p.polname = 'gcscan_recovery_request_read_guard'
      and p.polcmd = 'r'
      and not p.polpermissive
      and cardinality(p.polroles) = 1
      and p.polroles[1] = (select oid from pg_roles where rolname = 'authenticated')
      and p.polqual is not null
      and replace(
        regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]', '', 'g'),
        'public.',
        ''
      ) = 'gcscan_can_access_recovery_request(student_id,event_id)'
      and p.polwithcheck is null
  )
)
select * from failures order by table_name, issue, privilege_name;

-- Confirm the expected enabled trigger is attached to the expected function.
select t.tgname, t.tgenabled, pn.nspname as function_schema, p.proname as function_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where n.nspname = 'public' and c.relname = 'profiles'
  and t.tgname = 'gcscan_protect_profile_role' and not t.tgisinternal;

select pg_get_functiondef('public.gcscan_protect_profile_role()'::regprocedure) as role_guard_definition;

select
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
    as authenticated_can_update_full_name,
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
    as authenticated_can_update_any_profile_column;

select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'gcscan_purge_expired_events',
    'gcscan_archive_event',
    'gcscan_restore_event',
    'gcscan_delete_event_permanently'
  )
order by p.proname;
