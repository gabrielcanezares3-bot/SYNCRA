# SYNCRA final live-schema reconciliation runbook

**Purpose:** collect the remaining evidence needed to decide whether existing live objects meet the app and security contracts, and to authorize only narrowly scoped forward changes where evidence shows a real gap.

**Read-only boundary:** the SQL in this runbook is catalog/data `SELECT` only. Run it only in the confirmed project as an authorized owner after checking the project reference. Do not run pending migrations as written, use the mutation-oriented regression test against production, or change the remote database as part of evidence collection. No live results or owner approval are asserted here.

## Known facts and decision rule

The project owner has reported that the live database contains the admin and teacher workflow tables/RPCs, an enabled profile-role guard, enabled audit immutability triggers, and a closed-event attendance insert guard. Earlier reports also confirm the target Auth identity `admin@cctc.com` / `8ff7d0f3-5de0-43a1-975a-1d553bd64a27`, its existing `student` profile role, an empty `gcscan_admin_members`, and the intended admin RPC owner/security properties. These reports are context, not a substitute for the owner-approved reconciliation record or the outstanding evidence below.

Versions `202610120001`, `202610120002`, `202610120003`, and `202610130001` were reported absent from the remote migration ledger. Absence does not prove their effects are absent. Migrations 001 and 002 collide with live object names. No approved reconciliation record has been found. Do not infer deployment, mark a migration applied, change the profile role, or run a colliding migration.

Treat every RPC as **unverified until its definition, caller contract, authorization, owner, security mode, `search_path`, and effective grants have been reconciled**. A matching name/signature alone is insufficient.

## Ordered read-only verification

Run these queries in order. Save the unedited outputs with project reference, execution date/time, and the execution identity. Review definitions and policies—not just whether rows exist.

### 1. Event, attendance, and recovery column contracts

```sql
select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('events', 'attendance', 'attendance_recovery_requests')
order by table_name, ordinal_position;
```

**Expected evidence:** `events` has the fields actually consumed by the app and proposed event functions, including UUID `id`/`created_by`, `event_code`, `title`, `start_time`, `end_time`, `created_at`, `archived_at`, the attendance-setting fields, and `venue`, `description`, `event_status` with compatible types. `attendance` exposes the event/student IDs, scan timestamp, status, and late reason expected by the callers and guard. Recovery requests expose the exact IDs, status/reason, request/review timestamps, review note, and attendance reference used by `lib/smartFeatures.ts`; ownership columns are UUIDs.

**Release blocker:** a missing/incompatible required field; an unexpected required field/default that prevents the existing RPC from writing; `event_status` not constrained to the supported `active`/`closed` domain; incompatible status/ID types; or a shape that does not support the app's joins/filters. Do not add or alter a column based solely on this comparison—first establish whether a compatible live implementation already exists.

### 2. Event and attendance integrity objects

```sql
select t.relname as table_name, c.conname, c.contype, c.convalidated,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('events', 'attendance', 'attendance_recovery_requests')
order by t.relname, c.conname;

select t.relname as table_name, i.indexrelid::regclass as index_name,
       i.indisunique, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid) as definition
from pg_index i
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('events', 'attendance', 'attendance_recovery_requests')
order by t.relname, i.indexrelid::regclass::text;
```

**Expected evidence:** a valid unique `events.event_code` key/index; supported event status values; and foreign keys/uniqueness rules consistent with event, attendance, and recovery references. Report any legacy or extra constraints explicitly.

**Release blocker:** no valid uniqueness protection for event codes, invalid/unvalidated integrity constraints, or constraints that permit statuses/relationships the functions and client cannot handle. A discrepancy must be assessed for existing data impact before any DDL is proposed.

### 3. Event/attendance/recovery triggers and their function bodies

```sql
select n.nspname as table_schema, c.relname as table_name, t.tgname,
       t.tgenabled, t.tgtype, pg_get_triggerdef(t.oid) as trigger_definition,
       p.oid::regprocedure::text as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       p.prosrc as function_body
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname in (
    'events', 'attendance', 'attendance_recovery_requests',
    'gcscan_admin_audit', 'gcscan_attendance_corrections',
    'gcscan_teacher_access_requests', 'gcscan_notifications',
    'gcscan_admin_members'
  )
  and not t.tgisinternal
order by c.relname, t.tgname;
```

**Expected evidence:** the enabled closed-event guard is a row-level `BEFORE INSERT` trigger on attendance and prevents ordinary attendance writes to closed events. Inspect the full function body and all triggers, including any additional recovery-specific path. The intended recovery exception must not permit a client to forge `recovered` attendance; only the authorized recovery review path may create it. Event audit/archive triggers, if present, must not bypass the checked RPC paths.

**Release blocker:** guard absent/disabled/misbound; it fails to enforce the closed-event rule; a general authenticated path can insert forged `recovered` rows; untrusted function ownership or unsafe `search_path`; or a trigger silently conflicts with/repeats the required workflow.

### 4. Exact RPC identities, return types, owners, definitions, and effective grants

This includes the client-called event, attendance, recovery, retention, and admin/workflow RPCs from all four proposals. Any absent expected row is a mismatch, not an implicit default.

```sql
select p.oid::regprocedure::text as signature,
       p.proargnames as argument_names,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_function_result(p.oid) as return_type,
       l.lanname as language,
       p.provolatile as volatility,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as function_settings,
       p.proacl as function_acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       pg_get_functiondef(p.oid) as full_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname in (
    'gcscan_is_admin', 'gcscan_admin_overview',
    'gcscan_admin_list_users', 'gcscan_admin_set_user_role',
    'gcscan_admin_list_events', 'gcscan_admin_set_event_archived',
    'gcscan_admin_list_attendance', 'gcscan_admin_correct_attendance',
    'gcscan_admin_report', 'gcscan_admin_list_teacher_requests',
    'gcscan_admin_decide_teacher_request', 'gcscan_admin_list_audit',
    'gcscan_admin_list_admin_members', 'gcscan_admin_grant_membership',
    'gcscan_admin_revoke_membership', 'gcscan_get_my_teacher_access_requests',
    'gcscan_submit_teacher_access_request', 'gcscan_withdraw_teacher_access_request',
    'gcscan_get_my_notifications', 'gcscan_mark_my_notification_read',
    'gcscan_protect_profile_role', 'gcscan_reject_attendance_audit_mutation',
    'gcscan_reject_admin_audit_mutation',
    'gcscan_save_event', 'gcscan_close_event',
    'gcscan_reject_closed_event_attendance',
    'gcscan_record_attendance', 'gcscan_request_recovery',
    'gcscan_review_recovery', 'gcscan_can_access_recovery_request',
    'gcscan_archive_event', 'gcscan_restore_event',
    'gcscan_delete_event_permanently', 'gcscan_purge_expired_events'
  )
order by p.proname, p.oid::regprocedure::text;
```

**Expected evidence:** one matching overload for every matrix entry below; exact input names/types and return type; readable full body; correct caller authorization and object ownership; fixed safe `search_path` for SECURITY DEFINER functions (expected empty path for reviewed GCScan definer functions); no anonymous execution; and authenticated execution only for intended app RPCs. The global purge function must not be executable by `anon` or `authenticated`. Review `PUBLIC` grants too: effective `has_function_privilege` results account for inherited/public execution, while `proacl` shows the recorded ACL.

**Release blocker:** missing/extra/ambiguous overload; argument name/type mismatch; return type or JSON shape incompatible with the call site; missing authorization/ownership checks; untrusted definer owner or mutable/unsafe path; anonymous or unintended public execution; missing authenticated execution for a required call; or client execution of global purge. An app RPC that returns success without a meaningful checked result is not equivalent to a caller that requires a UUID, boolean, or page object.

### 5. RLS policies and effective API table/column privileges

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls,
       p.policyname, p.permissive, p.roles, p.cmd,
       p.qual as using_expression, p.with_check as check_expression
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'events', 'attendance', 'attendance_recovery_requests',
    'gcscan_admin_members', 'gcscan_attendance_corrections',
    'gcscan_teacher_access_requests', 'gcscan_notifications', 'gcscan_admin_audit'
  )
order by c.relname, p.policyname;

with targets(table_name) as (
  values ('profiles'), ('events'), ('attendance'),
         ('attendance_recovery_requests'), ('gcscan_admin_members'),
         ('gcscan_attendance_corrections'), ('gcscan_teacher_access_requests'),
         ('gcscan_notifications'), ('gcscan_admin_audit')
), privileges(privilege_name) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
         ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
select t.table_name, r.rolname as api_role, p.privilege_name,
       has_table_privilege(r.rolname, format('public.%I', t.table_name), p.privilege_name) as effective
from targets t
cross join (values ('anon'), ('authenticated')) as r(rolname)
cross join privileges p
order by t.table_name, r.rolname, p.privilege_name;

select c.table_name, c.column_name,
       has_column_privilege('anon',
         format('%I.%I', c.table_schema, c.table_name), c.column_name, 'SELECT') as anon_select,
       has_column_privilege('authenticated',
         format('%I.%I', c.table_schema, c.table_name), c.column_name, 'SELECT') as authenticated_select,
       has_column_privilege('authenticated',
         format('%I.%I', c.table_schema, c.table_name), c.column_name, 'INSERT') as authenticated_insert,
       has_column_privilege('authenticated',
         format('%I.%I', c.table_schema, c.table_name), c.column_name, 'UPDATE') as authenticated_update,
       has_column_privilege('authenticated',
         format('%I.%I', c.table_schema, c.table_name), c.column_name, 'REFERENCES') as authenticated_references
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'profiles', 'events', 'attendance', 'attendance_recovery_requests',
    'gcscan_admin_members', 'gcscan_attendance_corrections',
    'gcscan_teacher_access_requests', 'gcscan_notifications', 'gcscan_admin_audit'
  )
order by c.table_name, c.ordinal_position;
```

**Expected evidence:** RLS enabled for sensitive/app relations; no direct `anon` access; no direct authenticated access to admin membership, audit, notification, teacher-request, or correction internals; authenticated client read paths retain only the access needed by their callers. For the 130001 intended matrix, `profiles`, `events`, `attendance`, and recovery requests have authenticated SELECT; only `profiles.full_name` has authenticated UPDATE; no direct authenticated writes to events, attendance, or recovery requests. The recovery-request SELECT policy must enforce student-own-request or teacher-own-event visibility on the server; a client-side filter is not an authorization boundary. Keep all policy roles, commands, permissiveness, `USING`, and `WITH CHECK` expressions in the evidence.

**Release blocker:** RLS disabled where required; broad `anon`/authenticated direct writes or reads to sensitive tables; profile update beyond `full_name`; missing required SELECT/column access; a recovery policy allowing cross-student/cross-teacher visibility; or an existing permissive policy that widens access beyond the required ownership guard. A policy name alone is not evidence of its predicate.

### 6. Recovery helper and recovery policy exact comparison

Use the function-definition query in check 4 for `gcscan_can_access_recovery_request(uuid,uuid)`. Review it together with the policy rows from check 5.

**Expected evidence:** the helper is stable, SECURITY DEFINER with a trusted owner and fixed safe search path; it returns true only for the authenticated student owning the request with student role, or a teacher whose own event owns the request. It is executable by authenticated as required and not anonymous. The intended permissive and restrictive SELECT policies apply only to authenticated and use the helper with the request's `student_id` and `event_id`; neither introduces a write check.

**Release blocker:** helper missing/overbroad, policy predicate mismatch or missing restrictive guard where needed, direct recovery insert/update/delete permission, or inability to establish that `gcscan_review_recovery` alone authorizes review and creates recovered attendance safely.

### 7. Execution identity and owner approval context

```sql
select current_user as current_execution_role,
       session_user as session_role,
       current_database() as database_name,
       current_setting('server_version') as server_version;
```

**Expected evidence:** capture the actual SQL Editor execution role in the same session immediately before an owner-run bootstrap or approved mutation. The prior reported role was `postgres`; re-confirm rather than assuming it. Verify the project reference in the dashboard independently; this query does not return the Supabase project ref.

**Release blocker:** unexpected project/database/role, missing project-owner authorization, or inability to tie the saved outputs to the confirmed project and review.

## RPC-to-app reconciliation matrix

This is the **expected contract**, based on static inspection of pending SQL and local app callers. It is not a claim about the live database. Compare the exact catalog signatures, result types, JSON fields, authorization, and behavior from check 4 against each row. `jsonb` page callers validate at minimum `items` array and `has_more` boolean; item fields below come from local TypeScript consumers and must be present with compatible/nullability-safe values.

| RPC signature → return shape expected | Actual app call site / use | Release comparison |
|---|---|---|
| `gcscan_is_admin()` → `boolean` | `lib/admin.ts` `checkAdministratorAccess`; admin tab gate in `app/(tabs)/_layout.tsx` | Must derive access from membership, not profile role; deny unauthenticated/nonmembers. |
| `gcscan_admin_overview()` → `jsonb` object: `user_count`, `student_count`, `teacher_count`, `event_count`, `active_event_count`, `upcoming_event_count`, `closed_event_count`, `attendance_count`, `archived_event_count`, `correction_count`, `pending_teacher_request_count` (counts) | `lib/admin.ts` `getAdminOverview`; Admin overview screen | Every consumed metric must be accurate against live event states/columns; no missing or differently named keys. |
| `gcscan_admin_list_users(text,integer,text)` → `jsonb {items,has_more}` with `id,email,full_name,role` | `lib/admin.ts` `listAdminUsers` | Search, role filter, paging; only supported profile roles; requires admin check. |
| `gcscan_admin_set_user_role(uuid,text)` → `boolean` | `lib/admin.ts` `setManagedUserRole` | Only `student`/`teacher`; require membership authorization and role-guard marker; audit actual changes; never promote to admin profile role. |
| `gcscan_admin_list_events(integer)` → `jsonb {items,has_more}` with `id,event_code,title,start_time,end_time,venue,description,event_status,grace_period_minutes,late_reason_enabled,zone_enabled,zone_lat,zone_lon,zone_radius_m,created_by,created_at,archived_at` | `lib/admin.ts` `listAdminEvents` | Admin-only; includes creator and archive/status data; fields must match live event schema. |
| `gcscan_admin_set_event_archived(uuid,boolean)` → `boolean` | `lib/admin.ts` `setAdminEventArchived` | Admin-only, audited, preserve 15-day restore limit; no permanent deletion. |
| `gcscan_admin_list_attendance(text,text,integer,text,timestamptz,timestamptz)` → `jsonb {items,has_more}` with attendance/student/event/time/status fields | `lib/admin.ts` `listAdminAttendance` | Admin-only filters and paging must match named arguments and returned fields consumed by the table. |
| `gcscan_admin_correct_attendance(text,text,text,text)` → UUID audit/correction identifier | `lib/admin.ts` `correctAdminAttendance` | Admin-only; validates status/reason; updates attendance and writes immutable before/after correction evidence atomically. |
| `gcscan_admin_report(text,timestamptz,timestamptz)` → `jsonb` with `status_counts`, `event_summaries`, `recent_attendance`, `recent_corrections` | `lib/admin.ts` `getAdminReport` | Admin-only; verify exact nested keys, filtering, and counts; no data omitted/expanded by RLS incorrectly. |
| `gcscan_admin_list_teacher_requests(text,integer)` → `jsonb {items,has_more}` with `id,student_id,student_name,student_email,reason,status,requested_at,reviewed_at,reviewer_id,decision_reason` | `lib/admin.ts` `listAdminTeacherRequests` | Admin-only; excludes admin members where intended; status set matches UI. |
| `gcscan_admin_decide_teacher_request(uuid,text,text)` → `boolean` | `lib/admin.ts` `decideAdminTeacherRequest` | Admin-only and serialized; approval changes only student profile to teacher through guard; decisions/audit/notification atomic; no duplicate or stale decision succeeds. |
| `gcscan_admin_list_audit(text,integer)` → `jsonb {items,has_more}` with `id,actor_id,action,subject_id,reason,before_record,after_record,created_at` | `lib/admin.ts` `listAdminAudit` | Admin-only; includes intended correction events; respects append-only protection. |
| `gcscan_admin_list_admin_members(integer)` → `jsonb {items,has_more}` with `user_id,email,full_name,granted_at,granted_by` | `lib/admin.ts` `listAdminMembers` | Admin-only; no direct table access. |
| `gcscan_admin_grant_membership(uuid)` → `boolean` | `lib/admin.ts` `grantAdminMembership` | Admin-only for existing use; no self-grant; requires target Auth/profile; serialized and audited. Not a first-admin bootstrap path. |
| `gcscan_admin_revoke_membership(uuid)` → `boolean` | `lib/admin.ts` `revokeAdminMembership` | Admin-only; must prevent removing the last administrator and audit revocation. |
| `gcscan_save_event(uuid,text,text,timestamptz,timestamptz,text,text,text,integer,boolean,boolean,double precision,double precision,integer)` → UUID event id | `lib/events.ts` `saveEvent`; `lib/admin.ts` `saveAdminEvent` | Teacher owns create/edit; admin manages any event; validate fields/zone; preserve event code and audit; no direct writes. |
| `gcscan_close_event(uuid)` → `boolean` | `lib/events.ts` `closeEvent`; `lib/admin.ts` `closeAdminEvent` | Teacher may close own event; admin any event; closed events do not reopen; audit; archived/missing event returns false. |
| `gcscan_record_attendance(text,double precision,double precision,text)` → JSON with `status` in `present|late|recovered`, optional `event_title`, `scanned_at` | `lib/smartFeatures.ts` `recordSmartAttendance`, reached via `lib/attendance.ts` `registerAttendance` and `app/(tabs)/scan.tsx` | Must authorize current student, validate event/QR/location/late reason, prevent duplicate/forged attendance, and comply with closed-event guard. Client rejects missing/invalid status. |
| `gcscan_request_recovery(uuid,text)` → UUID request id | `lib/smartFeatures.ts` `requestAttendanceRecovery`; `app/recovery.tsx` | Student-only; enforce own identity, eligibility, reason, duplicate/pending rules; client requires UUID. |
| `gcscan_review_recovery(uuid,text,text)` → review result; caller currently treats any error-free response as success | `lib/smartFeatures.ts` `reviewAttendanceRecovery`; teacher recovery screen | Exact live decision values/authorization/result and attendance mutation must be reviewed. Must enforce event-owner teacher, valid pending request, atomic decision/audit/notification, and no forged recovered insert. Any ambiguity blocks release. |
| `gcscan_archive_event(uuid)` → `boolean` | `lib/events.ts` `archiveEvent`; teacher event management | Teacher may archive only own active event; audit/retention consistent; false reported as failure. |
| `gcscan_restore_event(uuid)` → `boolean` | `lib/events.ts` `restoreEvent`; teacher event management | Owner-only and within 15 days; false/expired reported as failure. |
| `gcscan_delete_event_permanently(uuid)` → `boolean` | `lib/events.ts` `permanentlyDeleteEvent`; teacher Recently Deleted screen | Owner-only archived event; inspect cascading/dependent recovery deletion semantics and audit obligations; destructive operation must be explicitly authorized by existing behavior. |
| `gcscan_purge_expired_events()` → integer (tracked local migration) | No app caller | Must not be callable by `anon` or `authenticated`; any automated cleanup requires a separately trusted scheduler/server mechanism. Do not restore client execution. |
| `gcscan_get_my_teacher_access_requests()` → `jsonb {items}` | `lib/accessWorkflow.ts` `getMyTeacherAccessRequests`; Profile request state | Authenticated user receives only own rows; response fields match `TeacherAccessRequest`. |
| `gcscan_submit_teacher_access_request(text)` → UUID | `lib/accessWorkflow.ts` `submitTeacherAccessRequest`; Profile | Only non-admin student; validate reason and pending uniqueness; audit/notify atomically; UUID required. |
| `gcscan_withdraw_teacher_access_request(uuid)` → `boolean` | `lib/accessWorkflow.ts` `withdrawTeacherAccessRequest`; Profile | Only request owner, pending state; audit atomically; boolean true required. |
| `gcscan_get_my_notifications(integer)` → `jsonb {items,has_more}` with `id,kind,title,body,created_at,read_at` | `lib/accessWorkflow.ts` `getMyNotifications` | Authenticated user receives own notifications only; bounded page; UI reads items. |
| `gcscan_mark_my_notification_read(uuid)` → `boolean` | `lib/accessWorkflow.ts` `markMyNotificationRead` | Only recipient; true required; cannot mark another user's notification. |

**Direct table reads also form part of the contract:** `lib/smartFeatures.ts` loads recovery rows directly, then filters teacher rows in client code; therefore RLS must independently restrict a teacher to requests for that teacher's events. Student attendance/history reads and events/profiles joins likewise depend on correct RLS and effective SELECT grants. Client filtering is never sufficient security.

## Conditional forward-only SQL work (not executable instructions)

Do not execute this section as a script. No mutation is currently authorized by this runbook. First identify one concrete discrepancy in the saved live evidence, its impact, and the exact affected object; obtain project-owner approval and a recoverable backup. Then write a separately reviewed, narrowly scoped forward change and its post-check. Never apply 001/002/003/130001 wholesale, drop/recreate an existing object just to bypass a preflight, overwrite a working SECURITY DEFINER function without reviewed definition comparison, weaken RLS, edit migration history, or change the `student` role.

| Confirmed discrepancy | Smallest candidate change, only after definition/data review | Required safety conditions |
|---|---|---|
| A required event detail column or event-status constraint/index is genuinely absent, while no equivalent object exists | Add only the missing compatible column/constraint/index using a forward-only change; do not re-add existing objects or backfill speculative values. | Prove defaults/nullability preserve existing rows; validate uniqueness/data first; preserve QR/event behavior. |
| Event save/close RPC or trigger is genuinely absent | Add only the missing exact-signature function/trigger, using reviewed authorization, fixed `search_path`, trusted ownership, explicit grants, and audit semantics from the proposal. | Verify dependent tables/columns, function privileges, trigger uniqueness, closed-event/recovery interaction, and rollback plan. Do not use `CREATE OR REPLACE` on an unreviewed live function. |
| Live event RPC exists but has a proven narrow contract/security defect | Prepare a function-specific replacement preserving its signature and unrelated behavior, or a grant-only change if the body is correct. | Diff the exact live body against reviewed intended behavior; test in disposable staging; keep role checks and audit atomic. |
| Attendance guard is missing/incorrect or `recovered` can be forged | Repair only the guard/authorization path shown to be defective; if recovery review is the legitimate exception, enforce it through a verified trusted context rather than allowing ordinary client inserts. | Must demonstrate normal scans still work, closed events reject scans, legitimate approved recovery still works, and unauthorized recovery cannot create attendance. |
| Recovery read policy/helper is absent or overbroad | Add/replace only the necessary ownership predicate/policies or revoke an excessive grant; preserve unrelated policies that are proven safe. | Review all permissive and restrictive policies together and test student-own/teacher-own-event denials in staging. |
| Critical API grants exceed the intended least-privilege contract | Revoke only the proven excess grants and restore only the verified client-required SELECT / `profiles.full_name` update grants. | Check column-level ACLs as well as table grants, inherited `PUBLIC` privileges, and service-role/admin paths. Never revoke access blindly. |
| A SECURITY DEFINER function has an unsafe owner/path or public/anonymous execution | Correct only that function's owner/configuration/ACL after reviewing its body and callers. | Confirm every referenced object is schema-qualified or safe under empty `search_path`; retain authenticated EXECUTE only where intended; verify effective grants after. |
| Live admin/teacher workflow differs from 001/002 or app contract | Fix only the individually proven missing/incorrect object; otherwise record equivalence and leave live object unchanged. | Existing table/RPC collisions are not authorization to overwrite; prove audit immutability, policy, signatures, data shape, and role checks first. |
| Migration ledger is incomplete | No database mutation is implied. Follow supported Supabase history-reconciliation tooling and retain an owner-approved record of actual live effects. | Never manually insert ledger rows or claim a migration ran based on object presence. Keep the pending proposals out of automatic deployment. |

## Owner approval and separate initial-admin bootstrap

### Approval package required before any bootstrap

The project owner must approve and retain all of the following:

1. Confirmed Supabase project reference and environment; saved, timestamped outputs from checks 1–7, especially exact function definitions, effective grants, policies, triggers, and relevant constraints/indexes.
2. A reconciliation matrix identifying each intended effect of 001, 002, 003, and 130001 as `verified equivalent`, `verified missing`, `verified mismatch`, or `unverified`; explain the absent ledger rows without claiming deployment and resolve the historical version/name mapping through supported tooling.
3. A review of the exact live definitions and app contracts in this document, recording any discrepancies and the narrowly scoped changes (if any) approved separately. No outstanding security-critical `unverified` item may be treated as a pass.
4. Explicit authorization under the project's legitimate schema-reconciliation procedure to bootstrap based on verified live prerequisites even though the 001/002 migration ledger entries are absent. This is not permission to falsely mark either migration applied.
5. Confirmation that the Auth UUID/email pair is still exact, its existing profile role remains `student`, membership is still absent, and the bootstrap audit/membership constraints and expected columns are correct.
6. A recoverable backup/rollback plan and a second-person review of the precise owner-run bootstrap script and target project.
7. Immediately before execution, `select current_user, session_user;` in the same SQL Editor session. The previously reported `postgres` role is not a substitute for this fresh check.

### Separate bootstrap action

Only after the approval package is complete, the owner may run the existing `supabase/pending/INITIAL_ADMIN_BOOTSTRAP.sql` as a **separate, explicitly authorized owner action**, not as a migration and not together with any reconciliation DDL. The existing script verifies the designated UUID/email pair and owner role, inserts a profile only if missing, leaves an existing profile untouched, inserts membership with `granted_by = null`, and writes an audit entry for a newly created membership. Its comments require migrations 001 and 002 to have committed; because those versions are absent and the objects collide, do not run it unless the owner-approved reconciliation procedure explicitly accepts verified equivalent live effects in place of those migration commits. Do not edit the script or ledger to evade that prerequisite.

The bootstrap must not set `profiles.role` to `admin`, disable or bypass `gcscan_protect_profile_role`, create an application RPC for first-admin creation, or use the self-service grant RPC. Keep it separate from any forward-only schema change so failure/rollback scope is clear.

If the project owner cannot approve the reconciliation substitution or any critical prerequisite is unverified, **do not bootstrap**. Resolve that one prerequisite with another read-only catalog check or supported migration-history evidence first.

## Post-change verification and release gates

After each separately approved change, capture outputs in the same project and compare to the exact expected evidence above. Do not infer success from a committed transaction or app tab visibility.

### Post-change database checks

- Re-run checks 1–7 for affected contracts; all expected RPC identities and return types are present and unambiguous.
- Re-check `anon`/`authenticated` effective table, column, and function privileges; no unintended direct sensitive-table access or anonymous RPC execution.
- Re-check RLS enabled state and all policy predicates/roles/commands; test student and teacher row isolation in a disposable staging project.
- Re-check event status constraint, unique event code, expected columns, event/attendance triggers, fixed definer search paths, and trusted function owners.
- Confirm audit UPDATE/DELETE/TRUNCATE protections remain enabled and all workflow mutations create the expected immutable audit evidence.
- Following the separately approved bootstrap, confirm the exact Auth identity still maps to the same profile UUID, profile role remains `student`, exactly the intended membership is present, `gcscan_is_admin()` resolves true for that member and false for a nonmember, and the initial membership audit record exists. Never expose credentials or tokens in the record.
- Verify migration history only through supported project tooling. Do not add ledger rows manually.

### Ordered application checks: Admin → Teacher → Student

**Admin**

1. Sign in as the designated account; verify Admin navigation appears and Student profile role remains unchanged. Confirm a normal nonmember cannot access Admin sections or privileged RPC results.
2. Load overview, users, teacher requests, events, attendance, audit, and admin membership pages; verify pagination, counts/filters, event creator/schedule/status, and real response shapes.
3. Review/decide a disposable teacher request with reason; confirm role change is limited to `student` → `teacher`, request/notification/audit changes are atomic, and the protected role guard remains enabled.
4. Use a disposable event to test admin save/close/archive/restore and attendance correction; verify audit before/after records. Do not perform permanent deletion on production data.
5. Confirm direct reads/writes of sensitive admin tables remain denied; all actions go through authorized RPCs.

**Teacher**

1. Sign in as a teacher; verify Teacher navigation remains available and Admin navigation/requests are not exposed.
2. Create/edit/close an owned disposable event; verify QR lookup, status/settings, and event ownership.
3. Attempt access to another teacher's event and recovery request; server authorization/RLS must deny it regardless of client filtering.
4. Submit/review an eligible recovery in staging; verify only the event owner can decide, an approved recovery creates the permitted recovered attendance, and a closed event still rejects ordinary scans.
5. Test archive/restore within and beyond 15 days using controlled staging fixtures; verify owner restrictions and retention behavior.

**Student**

1. Sign in as a student; verify student navigation and QR scanning are unchanged; Admin and Teacher-only views remain unavailable.
2. Record valid attendance and verify duplicate/closed-event/invalid-location denials; confirm history is limited to that student.
3. Submit/inspect/withdraw a teacher-access request and read/mark only personal notifications; verify duplicate and cross-user attempts are denied.
4. Submit eligible recovery and confirm the student cannot review it or read another student's request.
5. Verify normal profile display-name updates work but direct role changes, forged signup role metadata, and sensitive table writes are denied.

### APK readiness

APK build readiness is **blocked** until the owner-approved reconciliation and bootstrap decision are complete, every security-critical live contract has verified evidence, any necessary forward-only changes have passed database post-checks and staging behavior tests, the account's membership is verified without changing its `student` profile role, and the ordered Admin → Teacher → Student acceptance checks pass. A local TypeScript build or successful dashboard render alone is not sufficient.
