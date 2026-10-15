# SYNCRA Phase 1 staging deployment checklist

This is an operator runbook for a **disposable staging project only**. It is
not evidence that the local proposals match a live project. Do not apply these
files to production or to an unverified Supabase project.

## Blocking facts to resolve first

- The committed local files previously shared version `202610070001`. The
  indexes file now carries the local candidate version `202610070002`
  (`supabase/migrations/202610070002_recovery_fk_indexes.sql`); the retention
  file keeps `202610070001`. A live ledger check on 2026-10-15 found no row for
  `202610070001`, so neither local version is confirmed remote. Determine the
  actual remote version/name mapping from the verified staging migration ledger
  and confirm `202610070002` is unused remotely before any push. Do not deploy
  either local file or edit the remote ledger to force a match.
- Verify that each pending version below is unused remotely. Pending files
  are not in `supabase/migrations` and are not included by a normal
  `supabase db push`.
- The proposals assume a particular live schema, policy set, role-guard
  trigger, and function ownership. Every check below must pass or be reviewed
  and reconciled before proceeding.
- The local repository does not define
  `gcscan_record_attendance`, `gcscan_request_recovery`, or
  `gcscan_review_recovery`. Their live definitions, argument types, owners,
  grants, authorization rules, and effects must be reviewed before the
  corresponding smoke tests. Do not deploy based solely on their app callers.
- No trusted scheduled expired-event cleanup mechanism is configured in this
  repository. The proposal revokes authenticated access to the global purge.
  Until a trusted scheduler/server cleanup is separately configured, expired
  archived events must be permanently deleted by their authorized owners;
  never restore client access to the global purge or delete active events.
- Migration 001 adds a fixed-student Auth profile trigger when absent. It
  accepts an existing `auth.users` trigger only when it is the single enabled
  `AFTER INSERT FOR EACH ROW` `gcscan_auth_user_profile` trigger bound to the
  exact reviewed `postgres`-owned SECURITY DEFINER function with empty
  `search_path` and the expected body. It does not drop, replace, or duplicate
  that trigger/function. The migration also replaces (but does not recreate)
  `public.gcscan_protect_profile_role()` and requires an enabled row-level
  BEFORE INSERT OR UPDATE trigger bound to that function.
- The initial admin script is owner-only and depends on migration 001's
  `gcscan_admin_members` and migration 002's `gcscan_admin_audit`. Run it only
  after both migrations; the recommended order below runs it after all four.

## Candidate migration order

After resolving the version collision and remote ledger:

1. `supabase/pending/202610120001_admin_and_profile_bootstrap.sql`
   - Requires the verified `profiles`, `events`, and `attendance` contracts,
     the existing profile-role trigger, and either no Auth user trigger or the
     single exact reviewed fixed-student bootstrap trigger/function.
   - Creates membership and attendance-correction objects, fixed-student
     signup profile creation, and admin RPCs.
2. `supabase/pending/202610120002_teacher_admin_workflows.sql`
   - Requires 001; creates teacher requests, notifications, and the
     append-only admin audit table, then adds membership, approval, audit,
     and teacher-request RPCs.
3. `supabase/pending/202610120003_event_management.sql`
   - Requires 001 and 002; adds event fields, event save/close RPCs, and the
     closed-event attendance insert guard.
4. `supabase/pending/202610130001_critical_role_and_api_permissions.sql`
   - Requires the profile/admin and retention RPCs and recovery request table;
     it restricts API grants, removes authenticated execution of global
     expired-event cleanup, and adds recovery read-policy guards.
5. `supabase/pending/INITIAL_ADMIN_BOOTSTRAP.sql` (owner-run SQL, not a
   migration), as described below. The audit table is created in step 2, so
   steps 1 and 2 are mandatory prerequisites. Running after step 4 ensures the
   complete proposed baseline is in place before granting the first admin.

These are separate transactions. Do not enable the updated app until every
migration, bootstrap, and required postcheck has completed successfully.

## 1. Identify project and inspect migration history

In an authorized project-owner SQL Editor session, confirm the project
reference from the Dashboard before running any query. Record the project
reference in the deployment ticket; do not paste service-role secrets.

Confirm the ledger relation and its columns:

```sql
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;

select column_name, data_type
from information_schema.columns
where table_schema = 'supabase_migrations'
  and table_name = 'schema_migrations'
order by ordinal_position;
```

If the relation or a `version` column is absent, stop and obtain the actual
migration history from the project's supported Supabase tooling. Do not assume
files in this repository were applied remotely. If the standard `version`
column exists, list the relevant remote entries:

```sql
select version
from supabase_migrations.schema_migrations
where version in (
  '202610070001',
  '202610070002',
  '202610120001',
  '202610120002',
  '202610120003',
  '202610130001'
)
order by version;
```

Compare the returned versions against the exact remote migration names using
the supported project migration tooling. The SQL ledger query above only
shows version identifiers. Resolve whether remote `202610070001` represents
retention, recovery indexes, or another migration before proceeding.

**Stop** if a proposed pending version already exists remotely, a required
version is missing unexpectedly, the version/name mapping is ambiguous, or
the remote/local migration histories cannot be reconciled.

## 2. Read-only schema and security preflight

Run the following queries as the authorized project owner. These are
inspection-only; they do not apply a migration.

### Required columns, types, nullability, and defaults

```sql
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where (table_schema = 'public' and table_name in (
    'profiles', 'events', 'attendance', 'attendance_recovery_requests',
    'gcscan_admin_members', 'gcscan_attendance_corrections',
    'gcscan_teacher_access_requests', 'gcscan_notifications', 'gcscan_admin_audit'
  ))
   or (table_schema = 'auth' and table_name in ('users', 'identities'))
order by table_schema, table_name, ordinal_position;
```

Compare with the preflights in the four migrations. In particular:

- `profiles`: UUID unique `id`; text/varchar `email`, `full_name`, `role`;
  timestamptz `created_at`; existing rows only `student` or `teacher`; inserts
  can satisfy all required columns.
- `events`: UUID `id`/`created_by`; text/varchar `event_code`/`title`;
  timestamptz `created_at`, `start_time`, `end_time`, `archived_at`;
  attendance-setting fields required by migration 003; a valid unique
  `event_code` index.
- `attendance`: UUID `event_id`/`student_id`; required `id`, `scanned_at`,
  `attendance_status`, and `late_reason` with compatible types.
- `attendance_recovery_requests`: UUID `student_id`/`event_id`; the exact
  request and review columns used by the app and policies.
- Any extra required profile/event/attendance columns, existing constraints,
  and existing objects that collide with proposed names must be resolved
  before deployment.

### Constraints and indexes

```sql
select n.nspname, t.relname, c.conname, c.contype,
       pg_get_constraintdef(c.oid) as definition, c.convalidated
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in (
    'profiles', 'events', 'attendance', 'attendance_recovery_requests'
  )
order by t.relname, c.conname;

select n.nspname, t.relname, i.indexrelid::regclass as index_name,
       i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid) as definition
from pg_index i
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('profiles', 'events', 'attendance_recovery_requests')
order by t.relname, i.indexrelid::regclass::text;
```

### Existing triggers and their bound functions

```sql
select n.nspname as table_schema, c.relname as table_name, t.tgname,
       t.tgenabled, pg_get_triggerdef(t.oid) as trigger_definition,
       p.oid::regprocedure as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       pg_get_functiondef(p.oid) as function_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and ((n.nspname = 'public' and c.relname in ('profiles', 'attendance'))
       or (n.nspname = 'auth' and c.relname = 'users'))
order by n.nspname, c.relname, t.tgname;
```

Before 001, confirm the profile trigger is enabled and is bound to
`public.gcscan_protect_profile_role()`, fires before row INSERT and UPDATE,
and read its function and owner; do not rely on its name alone. For
`auth.users`, verify there are either no non-internal triggers or exactly one
enabled `gcscan_auth_user_profile` trigger firing AFTER INSERT FOR EACH ROW.
Read the attached function definition, owner, SECURITY DEFINER setting, and
search_path. Migration 001 compares these to the reviewed fixed-student
definition and fails closed on any mismatch. Search all exposed functions for
other ways to set `gcscan.admin_role_change_user_id`.

### Policies, effective grants, and security-definer functions

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls, p.polname, p.polcmd,
       p.polpermissive, p.polroles::regrole[] as target_roles,
       pg_get_expr(p.polqual, p.polrelid) as using_expression,
       pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'events', 'attendance', 'attendance_recovery_requests',
    'gcscan_admin_members', 'gcscan_attendance_corrections',
    'gcscan_teacher_access_requests', 'gcscan_notifications', 'gcscan_admin_audit'
  )
order by c.relname, p.polname;

select c.relname as table_name, r.rolname,
       has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
       has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
       has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as can_truncate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join pg_roles r
where n.nspname = 'public'
  and r.rolname in ('anon', 'authenticated')
  and c.relname in (
    'profiles', 'events', 'attendance', 'attendance_recovery_requests',
    'gcscan_admin_members', 'gcscan_attendance_corrections',
    'gcscan_teacher_access_requests', 'gcscan_notifications', 'gcscan_admin_audit'
  )
order by c.relname, r.rolname;

select p.oid::regprocedure as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'gcscan_protect_profile_role', 'gcscan_auth_user_profile', 'gcscan_is_admin',
    'gcscan_admin_set_user_role', 'gcscan_admin_grant_membership',
    'gcscan_admin_revoke_membership', 'gcscan_admin_decide_teacher_request',
    'gcscan_admin_set_event_archived', 'gcscan_save_event', 'gcscan_close_event',
    'gcscan_purge_expired_events', 'gcscan_archive_event',
    'gcscan_restore_event', 'gcscan_delete_event_permanently',
    'gcscan_record_attendance', 'gcscan_request_recovery',
    'gcscan_review_recovery', 'gcscan_can_access_recovery_request'
  )
order by p.proname, p.oid::regprocedure::text;
```

Confirm that all proposed `SECURITY DEFINER` functions have a trusted,
reviewed owner, a safe fixed search path, server-side authorization/ownership
checks, and only intended EXECUTE grants. Confirm clients have no direct
event, attendance, or recovery-request write privileges after hardening;
profile `full_name` UPDATE is the intentional column-level exception. Existing
restrictive policies and grants inherited through role membership must be
reviewed, not inferred from the proposal.

### Recovery request isolation prerequisite

The proposed 130001 adds permissive and restrictive authenticated SELECT
policies using `gcscan_can_access_recovery_request(student_id, event_id)`.
Before deploying, inspect any existing policies and the helper/function owner.
After deployment, `critical_security_postcheck.sql` must return zero failure
rows. Students must only see their own requests; teachers must only see
requests for events they own. The actual `gcscan_review_recovery` RPC
definition is not in the local proposals and is a separate blocker until its
signature, authorization, and update behavior are verified in staging.

## 3. Apply the reviewed SQL in order

Only proceed after the ledger and schema checks pass and a restorable staging
snapshot/backup is available.

1. Apply the exact reviewed copy of `202610120001_admin_and_profile_bootstrap.sql`.
   Confirm it commits; immediately verify the role trigger binding, student
   signup default, admin membership table, role constraint, and RPC grants.
2. Apply `202610120002_teacher_admin_workflows.sql`. Confirm teacher-request,
   notifications, and admin-audit tables exist with RLS enabled; confirm
   append-only audit triggers and grants.
3. Apply `202610120003_event_management.sql`. Confirm expected event columns,
   owner-checked save/close RPCs, closed-event attendance trigger, and removed
   direct event writes.
4. Apply `202610130001_critical_role_and_api_permissions.sql`. Confirm recovery
   policy predicates/roles and that authenticated cannot execute the global
   purge RPC or directly write protected tables.
5. Only after migrations 001 and 002 are committed (and, recommended, after
   all four steps), run
   `supabase/pending/INITIAL_ADMIN_BOOTSTRAP.sql` as a trusted SQL owner. Verify
   exact Auth UUID/email first. Do not run it as `authenticated` or `anon`.

Do not rename or copy proposals into active migrations until the remote
version mapping is resolved and deployment approval is recorded. Run them
through the project's approved staging deployment process, not by relying on
`supabase db push` to discover files under `supabase/pending/`.

## 4. Post-migration catalog assertions

Run the read-only `supabase/pending/tests/critical_security_postcheck.sql`.
It must report no failure rows. Then run:

```sql
-- Confirm the proposals were recorded in the staging migration ledger.
-- If the approved process runs SQL files manually in SQL Editor, the ledger
-- may not record them; use the deployment record and never insert ledger rows
-- manually.
select version
from supabase_migrations.schema_migrations
where version in ('202610120001', '202610120002', '202610120003', '202610130001')
order by version;

-- Required objects and signatures from the four proposals.
with expected(signature) as (
  values
    ('public.gcscan_is_admin()'),
    ('public.gcscan_admin_overview()'),
    ('public.gcscan_admin_list_users(text,integer,text)'),
    ('public.gcscan_admin_set_user_role(uuid,text)'),
    ('public.gcscan_admin_set_event_archived(uuid,boolean)'),
    ('public.gcscan_admin_correct_attendance(text,text,text,text)'),
    ('public.gcscan_admin_report(text,timestamp with time zone,timestamp with time zone)'),
    ('public.gcscan_admin_list_teacher_requests(text,integer)'),
    ('public.gcscan_admin_decide_teacher_request(uuid,text,text)'),
    ('public.gcscan_admin_list_audit(text,integer)'),
    ('public.gcscan_admin_grant_membership(uuid)'),
    ('public.gcscan_admin_revoke_membership(uuid)'),
    ('public.gcscan_get_my_teacher_access_requests()'),
    ('public.gcscan_submit_teacher_access_request(text)'),
    ('public.gcscan_withdraw_teacher_access_request(uuid)'),
    ('public.gcscan_get_my_notifications(integer)'),
    ('public.gcscan_mark_my_notification_read(uuid)'),
    ('public.gcscan_admin_list_events(integer)'),
    ('public.gcscan_save_event(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,integer,boolean,boolean,double precision,double precision,integer)'),
    ('public.gcscan_close_event(uuid)'),
    ('public.gcscan_purge_expired_events()'),
    ('public.gcscan_archive_event(uuid)'),
    ('public.gcscan_restore_event(uuid)'),
    ('public.gcscan_delete_event_permanently(uuid)'),
    ('public.gcscan_can_access_recovery_request(uuid,uuid)')
), missing as (
  select signature from expected
  where to_regprocedure(signature) is null
)
select 'missing_function' as issue, signature from missing;

-- Missing tables and tables without RLS are failures; expect zero rows.
with expected(table_name) as (
  values
    ('profiles'), ('events'), ('attendance'), ('attendance_recovery_requests'),
    ('gcscan_admin_members'), ('gcscan_attendance_corrections'),
    ('gcscan_teacher_access_requests'), ('gcscan_notifications'), ('gcscan_admin_audit')
)
select e.table_name, c.relkind, c.relrowsecurity, c.relforcerowsecurity
from expected e
left join pg_class c
  on c.relnamespace = 'public'::regnamespace and c.relname = e.table_name
where c.oid is null or c.relkind not in ('r', 'p') or not c.relrowsecurity
order by e.table_name;

-- Expected authenticated RPCs must be callable; global cleanup must not be.
with expected(signature, should_execute) as (
  values
    ('public.gcscan_is_admin()', true),
    ('public.gcscan_admin_set_user_role(uuid,text)', true),
    ('public.gcscan_admin_set_event_archived(uuid,boolean)', true),
    ('public.gcscan_admin_grant_membership(uuid)', true),
    ('public.gcscan_admin_revoke_membership(uuid)', true),
    ('public.gcscan_admin_decide_teacher_request(uuid,text,text)', true),
    ('public.gcscan_admin_list_events(integer)', true),
    ('public.gcscan_save_event(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,integer,boolean,boolean,double precision,double precision,integer)', true),
    ('public.gcscan_close_event(uuid)', true),
    ('public.gcscan_archive_event(uuid)', true),
    ('public.gcscan_restore_event(uuid)', true),
    ('public.gcscan_delete_event_permanently(uuid)', true),
    ('public.gcscan_can_access_recovery_request(uuid,uuid)', true),
    ('public.gcscan_purge_expired_events()', false)
)
select signature, should_execute,
       to_regprocedure(signature) is not null as function_exists,
       case when to_regprocedure(signature) is null then null
            else has_function_privilege('authenticated', signature, 'EXECUTE')
       end as authenticated_execute
from expected
where to_regprocedure(signature) is null
   or has_function_privilege('authenticated', signature, 'EXECUTE') is distinct from should_execute
order by signature;

-- Security-definer routines must be reviewed for trusted owner and fixed search path.
select p.oid::regprocedure as signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'gcscan_is_admin', 'gcscan_admin_set_user_role',
    'gcscan_admin_grant_membership', 'gcscan_admin_revoke_membership',
    'gcscan_admin_decide_teacher_request', 'gcscan_save_event',
    'gcscan_close_event', 'gcscan_can_access_recovery_request',
    'gcscan_purge_expired_events', 'gcscan_archive_event',
    'gcscan_restore_event', 'gcscan_delete_event_permanently'
  )
order by p.proname, p.oid::regprocedure::text;
```

For the output, verify every expected function exists, every intended checked
RPC has the intended authenticated grant, purge does not, each security
definer has `search_path=...` fixed in `proconfig`, and each owner is trusted.
The last query is an inspection report; a returned row is not automatically a
pass. Review the complete function definitions and compare to the approved
files.

After the owner bootstrap, confirm the target identity has membership and a
matching owner-bootstrap audit row. This query is read-only:

```sql
select u.id, u.email, p.role, m.granted_at, a.action, a.actor_id, a.after_record
from auth.users u
join public.profiles p on p.id = u.id
join public.gcscan_admin_members m on m.user_id = u.id
left join public.gcscan_admin_audit a
  on a.subject_id = u.id and a.action = 'initial_admin_membership_granted'
where u.id = '8ff7d0f3-5de0-43a1-975a-1d553bd64a27'
  and lower(u.email) = lower('admin@cctc.com')
order by a.created_at;
```

Require exactly one identity/membership result. For a newly inserted
membership, require one audit row with `actor_id IS NULL` and
`after_record.source = owner_bootstrap`. If the account was already a member,
the idempotent script intentionally emits no duplicate audit row; investigate
the existing audit trail instead of rerunning or altering the membership.

## 5. Staging regression and smoke tests

Use disposable accounts and records only. Run no mutation-oriented test in
production. Reset the SQL Editor role/session as described by each script;
the rollback-only SQL tests must be run as a project owner able to set role and
write fixtures.

1. Run `supabase/pending/tests/critical_security_postcheck.sql` as owner.
   Confirm no reported privilege or policy failures and verify exact recovery
   policy role/command/`USING`/`WITH CHECK` values.
2. Run `supabase/pending/tests/admin_authorization_regression.sql` against a
   disposable staging project after replacing the three fixture UUID
   placeholders. It requires a student, teacher, membership-authorized admin,
   and an attendance row. It rolls back. It covers student direct-role and
   self-membership denial, teacher-request submission/history/withdrawal,
   non-admin RPC denials, admin role and membership operations, teacher
   approval, audit, admin event creation/closure, and attendance correction.
3. Run `supabase/pending/tests/staging_student_teacher_event_attendance.sql`
   with disposable student and teacher UUIDs. It creates a teacher-owned event,
   tests student event mutation denial and records attendance through the
   attendance RPC, asserting the row uses `auth.uid()`. It rolls back. Before
   use, confirm the live attendance RPC signature/definition against the
   app contract and this staging-only test, and confirm it has no external
   side effects that a database rollback cannot undo.
4. Run the recovery review smoke test below only after inspecting the live
   `gcscan_request_recovery` and `gcscan_review_recovery` definitions and
   verifying the request table columns/constraints. These RPC definitions
   are absent from local migrations, so this check is blocked until staging
   inspection confirms the test's expected contract.
5. Perform the Student, Teacher, and Admin app smoke tests below using
   disposable accounts and a fresh event/request. Do not bootstrap a
   production admin or use live user data for tests.

### Student smoke

- Sign up in staging with user metadata containing a forged `role: teacher`
  and/or `role: admin`. Verify the new profile is `student` and the account
  has no `gcscan_admin_members` row. Delete the disposable Auth user through
  the trusted staging Auth admin interface after testing.
- Sign in; read/edit permitted profile display name; verify changing `role`
  directly is denied.
- Scan a valid active event QR. Verify the attendance row is associated with
  the signed-in user's `auth.uid()`, not a client-supplied identity, and appears
  in that user's history. Verify a second scan follows the reviewed duplicate
  attendance behavior.
- Submit a teacher-access request; verify it appears in the student's own
  history and can be withdrawn while pending.
- Submit a recovery request for a controlled staging event; verify only that
  student can read it and cannot review it or another user's request.

### Teacher smoke

- Verify an ordinary teacher cannot call admin membership, user-role, audit,
  teacher-request-decision, or admin-only event RPCs.
- Create and edit a teacher-owned event; close it; verify another teacher and
  a student cannot edit or close it. Verify a closed event rejects ordinary
  attendance but that the reviewed recovery path still works.
- Read attendance monitoring only for events owned by that teacher.
- Read/review a recovery request only for that teacher's event. Verify an
  unrelated teacher cannot read or decide it. Perform this only after the
  live recovery-review function has been inspected and its expected effects
  are known.
- Archive/restore and permanent-delete tests must use disposable events.
  Verify restore succeeds within 15 days, fails after the boundary, and
  permanent deletion requires the owner and an archived event. Never test
  deletion against shared or production data.

### Admin smoke

- Verify the bootstrapped account is recognized by `gcscan_is_admin()` based
  on `gcscan_admin_members`, independent of whether its profile role is student
  or teacher.
- Review/approve a disposable student teacher-access request; confirm profile
  role becomes teacher, request state/audit/notification are correct, and
  non-admins cannot decide it.
- Assign and restore student/teacher profile roles through the authorized
  RPC; confirm direct table role edits remain denied.
- Grant/revoke membership for disposable accounts; verify self-grant and
  last-admin removal fail.
- View/correct a disposable attendance row and confirm before/after audit
  records. Create, edit, close, archive, restore, and permanently delete only
  disposable events; verify audit and ownership checks.

### Recovery review smoke (live RPC prerequisite)

Use two disposable teachers, one disposable student, and an event owned by
teacher A. Submit a request as the student through the app. Confirm via the
postcheck that the student can read only their own request, teacher A can read
it, and teacher B cannot. Attempt `gcscan_review_recovery` as teacher B and
confirm it is denied without changing request state. Review as teacher A and
confirm the request state, review identity/time/note, and any attendance
effect match the verified live function definition. Confirm the student can
read their own resulting state and teacher B still cannot read or mutate it.
Rollback/recreate disposable fixtures between cases; do not guess whether
approval creates or updates attendance.

## 6. Rollback and stop conditions

- Each proposal starts and commits its own transaction. A failure before
  `COMMIT` should leave that migration's transaction unapplied; verify the
  migration tool's behavior and ledger before retrying.
- Once a migration commits, do not attempt an ad hoc `DROP TABLE`, restore
  production data, or edit the migration ledger to simulate rollback. Stop
  client rollout, preserve logs/output, and prepare a reviewed forward-fix or
  restore the disposable staging project from its pre-deployment snapshot.
- The bootstrap is a separate transaction. Any failed identity, table, or
  audit prerequisite aborts the transaction; inspect the cause rather than
  removing checks. If already a member, it is idempotent and does not create a
  duplicate owner-bootstrap audit row.
- Stop if any preflight differs from the reviewed schema, any migration
  version mapping is unresolved, any postcheck reports a failure, function
  owners/search paths/grants are unexpected, recovery RPC behavior is unknown,
  or a smoke test fails.
- Do not promote these staging files to production until a trusted owner
  repeats project-specific schema/history verification and explicitly
  approves a separately reviewed production deployment.
