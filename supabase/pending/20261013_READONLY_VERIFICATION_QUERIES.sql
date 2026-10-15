-- READ-ONLY VERIFICATION QUERIES for the SYNCRA pending migration set.
-- Every statement in this file is a SELECT or a DO block containing only
-- SELECT/EXECUTE-of-SELECT probes. None of them create, alter, drop, grant,
-- revoke, insert, update, or delete anything.
--
-- Run these in the Supabase SQL Editor of the CONFIRMED project
-- (verify the project ref is bhcuiuxnbamxjpjztgfj before running) as a
-- trusted project owner, BEFORE applying any pending migration. Compare the
-- results against the preflight checks in the four pending migration files.

-- 1. Server version.
select version();

-- 2. Migration ledger. Pending files are NOT in supabase/migrations; earlier
--    manual runs may not be recorded. A missing row is not proof of absence;
--    a present row for a candidate version blocks that version.
select to_regclass('supabase_migrations.schema_migrations') as ledger;
select version
from supabase_migrations.schema_migrations
where version in ('202610070001', '202610070002', '202610120001', '202610120002', '202610120003', '202610130001')
order by version;

-- 3. Profiles role constraints: names, types, validation state, expressions,
--    and referenced columns. Migration 001 accepts an existing
--    gcscan_profiles_role_check only when it is a validated single-column
--    check on role with student/teacher-only semantics; profiles_role_valid
--    must remain untouched.
select c.conname, c.contype, c.convalidated,
       pg_get_constraintdef(c.oid) as constraint_def,
       pg_get_expr(c.conbin, c.conrelid) as expression,
       (select array_agg(a.attname order by u.ord)
          from unnest(c.conkey) with ordinality as u(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
       ) as columns
from pg_constraint c
where c.conrelid = 'public.profiles'::regclass
order by c.conname;

-- 3b. Semantic probe of the existing role constraint(s). This DO block only
--     runs SELECTs against in-memory VALUES; it changes nothing. Expected:
--     for each existing role check constraint, "accepts_allowed" and
--     "rejects_disallowed" are both true. Anything else = manual review.
do $readonly_role_probe$
declare
  c record;
  expr text;
  accepts boolean;
  rejects boolean;
begin
  for c in
    select pg_get_expr(conbin, conrelid) as expr, conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    expr := c.expr;
    begin
      execute format(
        'select bool_and((%s) is true) from (values (''student''::text), (''teacher'')) as probes(role)',
        expr) into accepts;
      execute format(
        'select bool_and((%s) is false) from (values (''admin''::text), (''administrator''::text), (''staff''::text), (''Student''::text), (''student ''::text), (''teacher ''::text), (''''::text)) as probes(role)',
        expr) into rejects;
      raise notice 'constraint % | accepts_allowed=% | rejects_disallowed=% | expr=%',
        c.conname, accepts, rejects, expr;
    exception when others then
      raise notice 'constraint % could not be probed: %', c.conname, sqlerrm;
    end;
  end loop;
end;
$readonly_role_probe$;

-- 4. Profiles column contract used by migration 001 preflight/backfill.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- 5. Events/attendance/recovery column contracts used by 001/003/130001,
--    including the attendance-setting columns 003 requires to pre-exist and
--    the venue/description/event_status columns 003 requires to be absent.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('events', 'attendance', 'attendance_recovery_requests')
order by table_name, ordinal_position;

-- 5b. Unique valid single-column index on events.event_code (required by 003).
select t.relname, a.attname, i.indisunique, i.indisvalid
from pg_index i
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
where n.nspname = 'public' and t.relname = 'events'
  and i.indisunique and i.indisvalid and i.indpred is null
  and i.indexprs is null and i.indnkeyatts = 1;

-- 6. Which pending-migration objects already exist remotely (partial or manual
--    runs). Any true row here is a preflight collision the migrations will
--    fail on by design; inspect before deciding how to reconcile.
select 'gcscan_admin_members' as object, to_regclass('public.gcscan_admin_members') is not null as object_exists
union all select 'gcscan_attendance_corrections', to_regclass('public.gcscan_attendance_corrections') is not null
union all select 'gcscan_teacher_access_requests', to_regclass('public.gcscan_teacher_access_requests') is not null
union all select 'gcscan_notifications', to_regclass('public.gcscan_notifications') is not null
union all select 'gcscan_admin_audit', to_regclass('public.gcscan_admin_audit') is not null;


-- 6b. Which pending-migration function names already exist remotely. Any row
--     here is a preflight collision by design; inspect all overloads before
--     reconciling.
select p.oid::regprocedure::text as function_signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'gcscan_auth_user_profile', 'gcscan_is_admin', 'gcscan_admin_overview',
    'gcscan_admin_list_users', 'gcscan_admin_set_user_role',
    'gcscan_admin_list_events', 'gcscan_admin_set_event_archived',
    'gcscan_admin_list_attendance', 'gcscan_admin_correct_attendance',
    'gcscan_admin_report', 'gcscan_reject_attendance_audit_mutation',
    'gcscan_reject_admin_audit_mutation', 'gcscan_get_my_teacher_access_requests',
    'gcscan_submit_teacher_access_request', 'gcscan_withdraw_teacher_access_request',
    'gcscan_get_my_notifications', 'gcscan_mark_my_notification_read',
    'gcscan_admin_list_teacher_requests', 'gcscan_admin_decide_teacher_request',
    'gcscan_admin_list_audit', 'gcscan_admin_list_admin_members',
    'gcscan_admin_grant_membership', 'gcscan_admin_revoke_membership',
    'gcscan_save_event', 'gcscan_close_event', 'gcscan_reject_closed_event_attendance',
    'gcscan_can_access_recovery_request', 'gcscan_protect_profile_role'
  )
order by 1;

-- 7. auth.users triggers (migration 001 accepts none or the single exact
--    reviewed fixed-student bootstrap trigger/function).
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as trigger_def
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal;

-- 8. Profile role-guard trigger: enabled state, timing, and function body
--    (migration 001 replaces the body and keeps the trigger; 130001 requires
--    the reviewed markers in prosrc after 001 runs).
select t.tgname, t.tgenabled, t.tgtype,
       p.oid::regprocedure::text as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef, p.proconfig, p.prosrc
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public' and c.relname = 'profiles'
  and not t.tgisinternal;

-- 9. RLS state and policies on the app tables.
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'events', 'attendance',
    'attendance_recovery_requests', 'gcscan_admin_members',
    'gcscan_attendance_corrections', 'gcscan_teacher_access_requests',
    'gcscan_notifications', 'gcscan_admin_audit')
order by 1;

select tablename, policyname, polcmd, polpermissive,
       pg_get_expr(polqual, polrelid) as using_expression,
       pg_get_expr(polwithcheck, polrelid) as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- 10. All gcscan functions: owner, security mode, search_path, ACL. Verify
--     every SECURITY DEFINER function is owned by a trusted role and has
--     search_path locked (130001 also hardens the four retention RPCs).
select p.oid::regprocedure::text as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef, p.proconfig, p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'gcscan_%'
order by p.proname, 1;

-- 11. The three app RPCs that are NOT defined in this repository and must be
--     reviewed against their live definitions (QR scan, recovery request,
--     recovery review): owner, security mode, search_path, ACL, source.
select p.oid::regprocedure::text as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef, p.proconfig, p.proacl, p.prosrc
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('gcscan_record_attendance', 'gcscan_request_recovery', 'gcscan_review_recovery')
order by 1;

-- 12. Any function whose body references the transaction-local role-change
--     marker (after deployment: only the reviewed admin RPC paths plus the
--     role-guard trigger function).
select p.oid::regprocedure::text as function_signature,
       pg_get_userbyid(p.proowner) as function_owner, p.prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosrc ilike '%gcscan.admin_role_change_user_id%';

-- 13. Table privileges for the API roles on the four client-read tables
--     (130001 keeps SELECT for authenticated and UPDATE(full_name) only on
--     profiles).
select grantee, table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'events', 'attendance', 'attendance_recovery_requests')
  and grantee in ('public', 'anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;
