# SYNCRA administrator implementation — pending deployment

## Status

The Expo administrator and teacher-access screens and RPC clients are
implemented against the contracts in the four SQL proposals under
`supabase/pending/`. They are **not deployed** and must not be moved into
`supabase/migrations` until a trusted project owner verifies the deployed
schema, security configuration, and function ownership. QR-ATT live findings
and the prior `gcscan_protect_profile_role()` definition were supplied for this
work but were not re-queried here. The latest verified live Auth-trigger
result reports one enabled `AFTER INSERT FOR EACH ROW` trigger named
`gcscan_auth_user_profile`, bound to a `postgres`-owned SECURITY DEFINER
function with an empty search path. Its body uses the fixed-student profile
bootstrap. Migration 001 accepts that trigger only when its catalog shape,
function metadata, and exact body match the reviewed definition; it keeps the
existing trigger and function rather than replacing or duplicating them.

The metadata-based teacher-on-signup path is intentionally retired: new
signups receive the student role, and teacher access must be requested from
the student account and approved by an administrator. The current registration
screen creates student accounts only; confirm this replacement workflow is
acceptable for any external or legacy teacher-signup clients before deployment.

The pending migrations define `gcscan_is_admin()` using the separate
`gcscan_admin_members` table only; profile role is not part of administrator
authorization. A teacher can also be an administrator, and granting or
revoking membership never changes profile role. The membership grant RPC
takes the shared transaction lock, rechecks the caller, locks the target
Auth/profile rows, and rejects self-grants. Last-admin protection counts all
membership rows. Teacher-request approval remains limited to student-role
requesters who are not administrator members. Granting admin membership
cancels an existing pending request with an audit record and notification.

`supabase/pending/tests/admin_authorization_regression.sql` is a manual,
transaction-rolled-back regression harness for a disposable Supabase project.
It requires existing student, teacher, and administrator fixture UUIDs and
at least one attendance row. It tests teacher-role membership, administrator
request separation, unauthorized role/event changes, membership grant/revoke,
last-administrator protection, attendance correction audit/restore, and event
reports/closure. It has not been run against a database in this environment.
Static SQL review cannot establish deployed
RLS, function ownership, grants, trigger compatibility, or runtime behavior.

No Supabase connection, SQL execution, or environment-file access was used to
prepare this work. Migration 002 depends on the reviewed objects from 001.
Migration 003 depends on migrations 001 and 002 and adds event details, edit
and close RPCs, and a database attendance-insert guard for explicitly closed
events. Migration 130001 is the final API privilege and recovery-policy
hardening proposal. Apply none until the full four-migration sequence is
reviewed.

## Required verification before deployment

Verify from a trusted machine/account, then compare against the migration
preflight and function bodies:

- `public.profiles`: `id` is UUID and uniquely constrained; `email`,
  `full_name`, and `role` are text/varchar; `created_at` is timestamptz for the
  role-guard trigger; required columns allow the trigger's inserted values;
  role constraints accept `student` and existing rows use only expected values.
- `public.events`: the migration uses UUID `id`/`created_by`, text `event_code`
  and `title`, timestamptz `created_at`/`archived_at`, and the app-visible
  `start_time`/`end_time` fields. Migration 003 additionally requires the
  existing attendance-setting fields and a unique `event_code` index, then
  adds nullable venue/description for legacy-row compatibility and an
  `event_status` constrained to `active`/`closed`. Upcoming is derived from
  `start_time`; no status is fabricated for old venue/description values.
- `public.attendance`: verify `id`, UUID `event_id`/`student_id`, timestamptz
  `scanned_at`, text/varchar `attendance_status`/`late_reason`, and accepted
  status values `present`, `late`, and `recovered`.
- `auth.users`: the latest verified live result reports exactly one enabled
  `gcscan_auth_user_profile` trigger, defined as `AFTER INSERT FOR EACH ROW`
  and bound to `public.gcscan_auth_user_profile()`. The function is owned by
  `postgres`, is SECURITY DEFINER with `search_path = ''`, inserts only the
  fixed `student` role, and does nothing on profile-ID conflict. Migration
  001's preflight accepts it only when the trigger shape, function metadata,
  and exact function body match; it does not drop, replace, or duplicate them.
  If both are absent, the migration creates them; if only the matching
  function exists, it creates only the trigger.
- `public.profiles`: migration 001 replaces the supplied
  `gcscan_protect_profile_role()` function body but leaves its existing trigger
  in place only after confirming it is bound to that public function and fires
  for row INSERT and UPDATE. Every inserted profile is assigned `student`, irrespective of JWT
  user metadata. Authenticated updates retain the existing
  ID/email/created_at protections; role updates require the transaction-local
  marker plus `gcscan_is_admin()` membership verification. Administrator
  membership remains separate from the `student`/`teacher` profile role. Verify the
  deployed function owner and search for any
  other exposed function that can set the marker; test direct update and
  non-admin RPC denials before enabling role-management UI.
- Review all existing table grants, RLS policies, triggers, function owners,
  and `SECURITY DEFINER` function settings. Do not replace existing policies
  or rely on this migration to repair unknown policy gaps.
- Confirm that the database role owning the new security-definer functions can
  read/write protected tables while callers cannot directly write the admin
  membership or correction tables.
- Migration 003 revokes direct event-table mutations from `anon` and
  `authenticated`; verify no project-specific client write path depends on
  those grants. Existing event reads and RPC-based archive/restore remain.

The SQL includes fail-closed checks for key column names/types, profile ID
uniqueness and allowed roles, the exact reviewed Auth bootstrap trigger and
function when already present, required values for missing profiles,
object-name collisions, and the presence of the
deployed role-protection trigger. It also inserts only missing profile IDs and
never updates existing profile rows. Those checks are not a substitute for manual schema,
constraint, policy, grants, trigger-body, and function-owner review. The
verified Auth-trigger result resolves that trigger-specific blocker;
schema, RLS, policy, owner, and grant checks remain required.

### Read-only Supabase inspection

Run these only in the SQL Editor or CLI for the confirmed project, while signed
in with an authorized project owner. They inspect catalogs; they do not modify
data or schema. Do not export Auth secrets or environment files.

```sql
-- Table columns, nullability, defaults, and data types
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where (table_schema = 'public' and table_name in
  ('profiles', 'events', 'attendance', 'attendance_recovery_requests',
   'gcscan_admin_members', 'gcscan_attendance_corrections',
   'gcscan_teacher_access_requests', 'gcscan_notifications', 'gcscan_admin_audit'))
   or (table_schema = 'auth' and table_name = 'users')
order by table_schema, table_name, ordinal_position;

-- Constraints and indexes for app tables
select n.nspname, t.relname, c.conname, c.contype, pg_get_constraintdef(c.oid)
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('profiles', 'events', 'attendance', 'attendance_recovery_requests')
order by t.relname, c.conname;

-- Profile role guard and Auth signup/profile triggers, with trigger function source/owner
select n.nspname as table_schema, c.relname as table_name, t.tgname,
       pg_get_triggerdef(t.oid) as trigger_definition,
       p.oid::regprocedure as function_signature,
       pg_get_userbyid(p.proowner) as function_owner, p.prosecdef,
       pg_get_functiondef(p.oid) as function_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and ((n.nspname = 'public' and c.relname = 'profiles')
    or (n.nspname = 'auth' and c.relname = 'users'))
order by n.nspname, c.relname, t.tgname;

-- Existing RLS state and policies (read-only)
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'events', 'attendance',
    'attendance_recovery_requests', 'gcscan_admin_members',
    'gcscan_attendance_corrections', 'gcscan_teacher_access_requests',
    'gcscan_notifications', 'gcscan_admin_audit');
select * from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'events', 'attendance',
    'attendance_recovery_requests', 'gcscan_admin_members',
    'gcscan_attendance_corrections', 'gcscan_teacher_access_requests',
    'gcscan_notifications', 'gcscan_admin_audit')
order by tablename, policyname;

-- Existing GCScan RPC owners, security mode, and grants
select p.oid::regprocedure as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef, p.proconfig,
       p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'gcscan_%'
order by p.proname, p.oid::regprocedure::text;

-- Search function source for the transaction-local role-change marker
select n.nspname, p.oid::regprocedure, pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef, pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosrc ilike '%gcscan.admin_role_change_user_id%';
```

Review the returned trigger source before approving profile-role RPCs or signup
bootstrap. The migration preflight cannot prove an existing trigger's body,
owner, or call graph is safe.

## Provisioning the dedicated first administrator

This procedure is an explicit, owner-controlled setup step, not part of either
migration and not exposed as an application RPC or public endpoint. Confirm the
project reference in the Supabase Dashboard is `bhcuiuxnbamxjpjztgfj` before
continuing. Never place the initial password or a service-role key in SQL,
source code, client app configuration, shell history, logs, or Git.

1. In Auth > Users, search for the exact account email. If it exists, record
   only its verified Auth UUID and do not reset its password or overwrite its
   metadata. If it does not exist, create it using the Supabase Dashboard's
   Auth user-creation flow or a trusted server-side Auth Admin API client.
   The API path must first enumerate/search Auth users by normalized email,
   call `auth.admin.createUser` only when absent, and re-query if a concurrent
   create reports a duplicate. Supply the temporary password interactively or
   from a secrets manager at runtime; never persist or print it. Do not trust
   user metadata for the profile role or admin membership.
2. Before granting admin access, send the user a password-reset/change flow
   and have them set a new private password. Do not enable membership until
   the intended user has confirmed access and changed the temporary password.
   If the account already existed, do not reset its password as part of this
   procedure; coordinate with its owner instead.
3. Run
   [`supabase/pending/INITIAL_ADMIN_BOOTSTRAP.sql`](./supabase/pending/INITIAL_ADMIN_BOOTSTRAP.sql)
   only as a trusted Supabase database owner after migrations 001 and 002 have
   committed. Migration 002 creates `gcscan_admin_audit`, which the bootstrap
   requires to record the initial grant. The script independently checks its
   role, required tables/functions/columns, the profile-role trigger binding,
   the exact Auth UUID/email pair (`8ff7d0f3-5de0-43a1-975a-1d553bd64a27`,
   `admin@cctc.com`), and case-insensitive email uniqueness. It does not create
   Auth users or change an existing profile role. A missing profile is inserted
   with role `student`, subject to the existing profile trigger. The audit row
   uses `actor_id = NULL` to identify an owner-run bootstrap; the audit-list RPC
   renders that actor as `trusted project owner`.

The bootstrap is not an app RPC, public endpoint, or self-promotion workflow.
It is idempotent: an existing membership is preserved and no duplicate
bootstrap audit row is written. See
[`supabase/pending/STAGING_DEPLOYMENT_CHECKLIST.md`](./supabase/pending/STAGING_DEPLOYMENT_CHECKLIST.md)
for the complete staging runbook and required verification.

### Deployment sequence

1. Confirm the exact Supabase project reference in the trusted Dashboard before
   inspecting or deploying anything.
2. Run the read-only inspection above and compare all returned schema, trigger,
   policy, grants, function owners, and Auth trigger definitions with the
   pending SQL. Confirm the existing Auth trigger/function still matches the
   exact reviewed definition and resolve the profile-role trigger integration.
3. The local repository previously had duplicate historical `202610070001`
   identifiers for event retention and recovery indexes; the recovery-index
   file now uses the local candidate version `202610070002`. The supplied
   QR-ATT finding says event retention, recovery indexes, and signup-role
   preservation have unique remote versions, but their exact mapping was not
   independently inspected here, and the live ledger has no `202610070001`
   row. Do not deploy the duplicate/candidate local history as-is or modify the
   remote ledger; confirm `202610070002` is unused remotely and reconcile both
   files against the actual remote migration list.
4. Confirm pending versions `202610120001`, `202610120002`, `202610120003`,
   and `202610130001` are unused remotely. Apply the reviewed proposals in that
   order using the exact procedure in
   [`supabase/pending/STAGING_DEPLOYMENT_CHECKLIST.md`](./supabase/pending/STAGING_DEPLOYMENT_CHECKLIST.md).
   They are under `supabase/pending/`; default `supabase db push` will not
   include them.
5. Run the owner bootstrap only after 001 and 002 have committed; the runbook
   recommends doing so after all four proposals and their postchecks.
6. Run the SQL postcheck and disposable-account staging regression/smoke tests.
   Recovery review remains blocked until the live `gcscan_review_recovery`
   definition and authorization behavior have been verified.

Do not run these deployment steps on the public lab PC or with an unverified
project reference. No deployment or live verification has occurred here.

## Implemented app functionality (database contracts pending)

- Administrator tab visibility is checked by `gcscan_is_admin`; the dashboard
  independently checks membership. These checks control presentation only;
  every RPC must still authorize on the server.
- Seven Admin sections: Overview, Teacher Requests, Users, Events, Attendance,
  Audit Log, and Admin Access.
- Teacher request submission/status/history on Profile, pending-request
  withdrawal, request review and decision reason, plus in-app notifications
  and unread indicators.
- User search, app-role filtering, paging, and confirmed assignment of the
  limited `student`/`teacher` roles.
- User, event, and attendance lists are paged in 100-record windows.
- Cross-system event listing and archive/restore.
- Teacher and administrator event create/edit/close flows, with required
  venue/description, immutable QR event codes, and a server-side insert guard
  that rejects ordinary check-ins for explicitly closed events.
- Overall attendance list with event, student, status, and date-range filters.
- Attendance status/late-reason correction with a required reason, before/after
  JSON snapshots, actor ID, and database timestamp.
- Role/event summary counts, event-level attendance summaries, recent activity,
  attendance status/correction reports with event/date filters, unified audit
  history, and admin membership listing/grant/revoke controls.
- Teacher requests are only presented to confirmed non-admin student accounts;
  the Teacher tab is gated by profile role, and the Admin tab is gated by
  database membership.

The service modules call explicit RPC names defined by the pending proposals.
Until those proposals are reviewed and deployed, the calls will report backend
errors and none of the privileged or teacher-request workflows are available
in a live project. The screens do not constitute authorization.

### Client-to-SQL RPC contract review

The frontend calls below use named arguments; signatures are the SQL argument
types in order. Page RPCs return `{items, has_more}`; personal list RPCs return
`{items}`. This mapping was statically compared with the pending SQL files;
it is not evidence that these functions exist in Supabase.

| Frontend RPC | Arguments | SQL return |
|---|---|---|
| `gcscan_is_admin` | none | `boolean` |
| `gcscan_admin_overview` | none | `jsonb` role/event/attendance/request counts; full event statuses require migration 003 |
| `gcscan_admin_list_users` | `p_search text, p_offset integer, p_role text` | `jsonb` page |
| `gcscan_admin_set_user_role` | `p_user_id uuid, p_role text` | `boolean` |
| `gcscan_admin_list_events` | `p_offset integer` | `jsonb` page |
| `gcscan_admin_set_event_archived` | `p_event_id uuid, p_archived boolean` | `boolean` |
| `gcscan_admin_list_attendance` | `p_event_id text, p_status text, p_offset integer, p_student_id text, p_from timestamptz, p_to timestamptz` | `jsonb` page |
| `gcscan_admin_correct_attendance` | `p_attendance_id text, p_attendance_status text, p_late_reason text, p_reason text` | `uuid` audit ID |
| `gcscan_admin_report` | `p_event_id text, p_from timestamptz, p_to timestamptz` | `jsonb` event/status/activity/correction report |
| `gcscan_save_event` | `p_event_id uuid, p_event_code text, p_title text, p_start_time timestamptz, p_end_time timestamptz, p_venue text, p_description text, p_event_status text, p_grace_period_minutes integer, p_late_reason_enabled boolean, p_zone_enabled boolean, p_zone_lat double precision, p_zone_lon double precision, p_zone_radius_m integer` | `uuid` event ID |
| `gcscan_close_event` | `p_event_id uuid` | `boolean` |
| `gcscan_admin_list_teacher_requests` | `p_status text, p_offset integer` | `jsonb` page |
| `gcscan_admin_decide_teacher_request` | `p_request_id uuid, p_decision text, p_reason text` | `boolean` |
| `gcscan_admin_list_audit` | `p_category text, p_offset integer` | `jsonb` page |
| `gcscan_admin_list_admin_members` | `p_offset integer` | `jsonb` page |
| `gcscan_admin_grant_membership` | `p_user_id uuid` | `boolean` |
| `gcscan_admin_revoke_membership` | `p_user_id uuid` | `boolean` |
| `gcscan_get_my_teacher_access_requests` | none | `jsonb` personal items |
| `gcscan_submit_teacher_access_request` | `p_reason text` | `uuid` request ID |
| `gcscan_withdraw_teacher_access_request` | `p_request_id uuid` | `boolean` |
| `gcscan_get_my_notifications` | `p_offset integer` | `jsonb` `{ items, has_more }`; at most 100 personal notifications |
| `gcscan_mark_my_notification_read` | `p_notification_id uuid` | `boolean` |

The original planned sequence was migration 001 for admin and
attendance-correction foundations, migration 002 for teacher requests,
notifications, the append-only admin audit trail, membership administration,
and audited role/event workflows, migration 003 for event details and
event-management RPCs, then migration 130001 for API privilege and
recovery-policy hardening. This sequence is not an instruction to apply the
pending files to the current project: the live database already contains
objects that make migrations 001 and 002 fail their preflights, and the
equivalence of those objects to the proposals has not been established here.
Migration-ledger absence does not prove that a migration's effects are absent,
and proposed SQL is not evidence of deployment. Do not run the pending
migrations wholesale or edit migration history to make them appear applied.
First reconcile each intended effect against the live definitions and obtain
an owner-approved record of that reconciliation. Only specifically verified
missing changes may be handled in a separately reviewed, forward-only change.
Keep the affected client workflows disabled until their live RPC contracts,
privileges, RLS, and required event/recovery behavior are verified.

Each proposal emits `NOTIFY pgrst, 'reload schema'` at commit; if an approved
change is later deployed and the client receives a schema-cache error, the
project owner should verify the notification/logs and issue that notification
manually in the confirmed project's SQL Editor.

### Existing RPC dependencies outside the proposals

The app also depends on these existing RPCs, whose definitions are not present
in this repository except for the event-retention functions below. Their live
signatures, return types, owners, `SECURITY DEFINER` configuration, and grants
must be verified using the read-only catalog query above before any deployment:

| RPC | Client arguments / expected response |
|---|---|
| `gcscan_record_attendance` | `p_event_code`, `p_lat`, `p_lon`, `p_late_reason`; expected JSON with a valid `status` and optional event/time details |
| `gcscan_request_recovery` | `p_event_id`, `p_reason`; expected non-empty request UUID |
| `gcscan_review_recovery` | `p_request_id`, `p_decision`, `p_note`; client currently treats an error-free call as success, so verify the server's decision result and authorization |
| `gcscan_purge_expired_events` | No arguments; the tracked migration returns an integer. The pending security proposal revokes client EXECUTE access. Teachers can permanently delete their own expired archived events through the owner-checked delete RPC; automatic physical cleanup still requires trusted scheduler/server-side setup, which is not configured in this repository. |
| `gcscan_archive_event` | `p_event_id uuid`; the tracked migration returns a boolean and restricts changes to the owning user |
| `gcscan_restore_event` | `p_event_id uuid`; the tracked migration returns a boolean and restricts restoration to the owning user within 15 days |
| `gcscan_delete_event_permanently` | `p_event_id uuid`; the tracked migration returns a boolean and restricts permanent deletion to the owning user |

The attendance and recovery RPC implementation/permission contracts cannot be
confirmed locally. Do not infer that the pending admin migrations secure these
separate existing workflows; verify their authoritative role checks and row
ownership against the deployed schema. Migration 003 blocks inserts into an
explicitly closed event except when the inserted status is `recovered`, to
preserve recovery approval behavior. Before deployment, verify that ordinary
clients cannot insert forged recovered records and that only the authorized
recovery workflow can create them. The attendance trigger owner must be able to
read the events table despite RLS; review its security-definer owner and
function grants explicitly.

## Authentication account administration

The implemented user manager changes only the app profile role. It does not
create, suspend, or delete Supabase Auth accounts, so no Edge Function or
service-role secret is required for this scope. If Auth lifecycle operations
are later added, implement them in a trusted server-side Edge Function and
configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-side secrets
only. Never add either secret to Expo variables or client code.

## Student profile bootstrap

Migration 001 contains a missing-profile-only backfill and an AFTER INSERT
Auth bootstrap. The latest verified live result reports the expected existing
trigger/function pair. Its preflight verifies their exact shape and function
definition, retaining them rather than replacing or duplicating them; when
absent, it creates the missing objects. The profile name reads metadata
only for display and falls back to Auth email or literal `Student`; profile
role is always set to `student`; administrator access is a separate membership
grant and is not a profile role. The existing `gcscan_protect_profile_role`
trigger remains attached; migration 001 replaces its body so signup metadata
cannot assign teacher and authenticated profile-role changes require the
membership-checked admin RPC path. Required-column compatibility and the
deployed function owner still require project-side verification.

## Pending workflow migrations 002 and 003

The second pending SQL proposal depends on the reviewed objects from migration
001 and is not safe to deploy separately from it. Apply neither proposal until
the preflight and permission checks pass; deploy them as a coordinated release
and do not enable the client until both succeed. They are separate SQL
transactions, so deployment of both files is not itself atomic: if 002 fails
after 001 commits, leave the client features disabled and resolve the failure
before proceeding. It adds teacher-access
request history with one pending request per user,
user-scoped notification RPCs, an append-only admin audit table, serialized
admin grant/revoke RPCs with last-admin protection, transactional request
decisions, and role-filtered user listing. Event archive/restore and profile
role changes are audited. Attendance corrections remain transactionally
recorded in the correction table introduced by migration 001. Direct table
grants are revoked and RLS is enabled on the new tables.

Submission, withdrawal, and admin decisions each write audit entries in the
same transaction as the request state change; the withdrawal audit timestamp
records when the student withdrew. This SQL has not been run or parsed by a
live PostgreSQL server. Verify every
referenced column and function signature, ensure the migration owner can
access protected relations under RLS, and test denials/rollback in a disposable
project matching the verified production schema. do not promote any of the pending files
into the active migration workflow until the verified remote version mapping,
function ownership, RLS, and grants have been reconciled.
