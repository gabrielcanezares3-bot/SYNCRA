# SYNCRA Critical Security Fix — Deployment Notes

This pending package contains a data-preserving security migration targeting:
1. Preventing signup metadata from assigning the `teacher` role while preserving membership-checked admin role changes.
2. Removing direct event writes and recovery-request inserts so these remain behind checked RPCs.
3. Restricting recovery-request reads to a student's own requests or a teacher's own events.
4. Removing authenticated access to global expired-event cleanup.
5. Removing anonymous and unneeded authenticated table/column privileges.

## Files
- `supabase/pending/202610130001_critical_role_and_api_permissions.sql` — transaction-wrapped migration with schema and trigger preflight checks.
- `supabase/pending/tests/critical_security_postcheck.sql` — read-only effective-privilege and RLS checks.
- `supabase/pending/CRITICAL_SECURITY_FIX_README.md` — these instructions.

## Important behavior and limitations
- No existing rows are changed; no administrator is created or promoted.
- Every new profile insert is forced to `student`. Authenticated profile changes are limited to `full_name`, except that a role change is permitted only with the transaction-local marker used by the membership-checked admin RPC and a positive `gcscan_is_admin()` check.
- The intended authenticated grants are: `profiles` SELECT plus UPDATE on `full_name` only; `events`, `attendance`, and `attendance_recovery_requests` SELECT only. Direct profile inserts, event writes, attendance writes, and recovery-request inserts are not granted.
- Recovery requests receive a permissive owner policy plus a restrictive guard so a broader existing permissive policy cannot widen access. Deployment requires `attendance_recovery_requests` RLS already enabled and not forced, and requires live policy review to verify no existing restrictive policy breaks expected access.
- The historical global purge RPC is revoked from `PUBLIC`, `anon`, and `authenticated`. No scheduled/server cleanup mechanism exists in this repository, so this package does not create one. Expired rows remain visible in the teacher's Recently Deleted list for owner-authorized permanent deletion; restoration is hidden in the UI after 15 days and remains rejected by the restore RPC. Automatic physical purging still requires trusted scheduler/server-side setup. Teacher-triggered global cleanup is intentionally not restored.
- The four event-retention SECURITY DEFINER functions are configured with an empty search path. Their owner checks and grants still require live verification.
- The mobile client uses checked RPCs for event save/close/archive/restore/permanent-delete and recovery creation/review. Direct event writes and recovery inserts are intentionally denied.

## Before running
1. Take/verify a recoverable backup and confirm the target project ref is `bhcuiuxnbamxjpjztgfj`.
2. Review the current live trigger/function definition and compare it to the preflight assumptions. Confirm the script has not already been applied.
3. Run in a staging project first when possible. Do not run unrelated pending migrations at the same time.
4. Execute through Supabase SQL Editor as a trusted project owner. The transaction should roll back on errors.
5. Run `tests/critical_security_postcheck.sql`. The privilege snapshot should match the intended grant matrix; the assertion query should return zero rows; inspect the trigger and function-settings results. The assertion query validates recovery SELECT policy roles, command/permissiveness, `USING`, and `WITH CHECK` against the intended helper predicate.
6. In a disposable staging project, test forged signup metadata (`user_metadata.role='teacher'`), normal profile editing, membership-authorized admin role changes, event list/save/close/archive/restore flows, attendance history/scanning, and recovery submission/review.
7. If an operation fails, stop and inspect its exact RLS/RPC contract. Do not restore broad grants wholesale.

## Important edge cases
- The post-check is a privilege/RLS configuration check, not a full behavioral test. It does not prove all live RPC functions are safe.
- The role trigger blocks non-`full_name` profile changes other than a role change through the marker- and membership-checked admin RPC. Review any additional live profile columns and trigger dependencies first.
- This proposal depends on the live schema containing the described role trigger, admin membership check, retention RPC signatures, and recovery ownership columns. Its preflight fails closed when those prerequisites are absent.
- A SQL Editor execution context may not mimic authenticated signup; the forged-metadata test must use the real signup flow or a safe staging test.

## Deliberate exclusions
No admin membership bootstrap, scheduler/server cleanup infrastructure, migration-history reconciliation, or cosmetic/app changes are included. Existing recovery approval and attendance RPC definitions are not in the local migration history and must be verified against live SQL before deployment.
