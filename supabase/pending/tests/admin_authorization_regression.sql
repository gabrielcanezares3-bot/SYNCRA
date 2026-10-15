-- Disposable-project regression checks for the pending admin RPC migrations.
-- Replace the three UUID values with existing fixture accounts before running.
-- The fixtures must be a regular student, a teacher, and an authorized admin
-- who already has gcscan_admin_members. The admin may have either profile role.
-- At least one attendance row must exist for the correction/restore checks.
-- The transaction rolls back the temporary teacher membership and all changes.
begin;

select set_config('gcscan.test.student_id', 'REPLACE_WITH_STUDENT_UUID', true);
select set_config('gcscan.test.teacher_id', 'REPLACE_WITH_TEACHER_UUID', true);
select set_config('gcscan.test.admin_id', 'REPLACE_WITH_ADMIN_UUID', true);

do $test$
declare
  student_id uuid := current_setting('gcscan.test.student_id')::uuid;
  teacher_id uuid := current_setting('gcscan.test.teacher_id')::uuid;
  admin_id uuid := current_setting('gcscan.test.admin_id')::uuid;
  student_role text;
  teacher_role text;
  admin_role text;
  student_notification_id uuid;
  teacher_notification_id uuid;
  attendance_fixture_id text;
  attendance_fixture_status text;
  attendance_fixture_reason text;
begin
  select role into student_role from public.profiles where id = student_id;
  select role into teacher_role from public.profiles where id = teacher_id;
  select role into admin_role from public.profiles where id = admin_id;
  if student_role is distinct from 'student'
     or teacher_role is distinct from 'teacher'
     or admin_role is null
     or admin_role not in ('student', 'teacher')
     or not exists (select 1 from public.gcscan_admin_members where user_id = admin_id) then
    raise exception 'Fixtures must be a student, a teacher, and a membership-authorized administrator.';
  end if;
  if exists (
    select 1 from public.gcscan_admin_members where user_id in (student_id, teacher_id)
  ) then
    raise exception 'Student and teacher fixtures must not initially have admin membership.';
  end if;
  if (select count(*) from public.gcscan_admin_members) >= 99 then
    raise exception 'Use a disposable test project with fewer than 99 membership rows.';
  end if;
  if not has_function_privilege('authenticated', 'public.gcscan_is_admin()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_admin_overview()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_admin_list_users(text,integer,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_admin_grant_membership(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_admin_set_user_role(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_admin_list_admin_members(integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_admin_correct_attendance(text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_save_event(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,integer,boolean,boolean,double precision,double precision,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.gcscan_close_event(uuid)', 'EXECUTE') then
    raise exception 'Expected authenticated RPC grants are missing; denial checks would be inconclusive.';
  end if;
  if has_table_privilege('anon', 'public.gcscan_admin_members', 'SELECT')
     or has_table_privilege('authenticated', 'public.gcscan_admin_members', 'SELECT')
     or has_table_privilege('anon', 'public.gcscan_admin_audit', 'SELECT')
     or has_table_privilege('authenticated', 'public.gcscan_admin_audit', 'SELECT') then
    raise exception 'Administrator tables must not be directly readable by anon or authenticated.';
  end if;
  if not exists (select 1 from public.attendance) then
    raise exception 'Create one attendance fixture before running correction regression checks.';
  end if;
  select id::text, attendance_status::text, late_reason
  into attendance_fixture_id, attendance_fixture_status, attendance_fixture_reason
  from public.attendance
  order by scanned_at desc
  limit 1
  for update;
  if attendance_fixture_status is null
     or attendance_fixture_status not in ('present', 'late', 'recovered') then
    raise exception 'The selected attendance fixture has an unsupported status.';
  end if;
  perform pg_catalog.set_config(
    'gcscan.test.attendance_id',
    attendance_fixture_id,
    true
  );
  perform pg_catalog.set_config(
    'gcscan.test.attendance_status',
    attendance_fixture_status,
    true
  );
  perform pg_catalog.set_config(
    'gcscan.test.attendance_late_reason',
    coalesce(attendance_fixture_reason, ''),
    true
  );

  -- Isolate one valid administrator so the last-admin denial can be tested.
  -- The transaction rollback restores every membership row after the test.
  delete from public.gcscan_admin_members where user_id <> admin_id;

  insert into public.gcscan_notifications(recipient_id, kind, title, body)
  values (student_id, 'regression', 'Student fixture', 'Student-only notification')
  returning id into student_notification_id;
  insert into public.gcscan_notifications(recipient_id, kind, title, body)
  values (teacher_id, 'regression', 'Teacher fixture', 'Teacher-only notification')
  returning id into teacher_notification_id;
  insert into public.gcscan_admin_audit(actor_id, action, subject_id, reason)
  values (null, 'regression_owner_bootstrap', admin_id, 'Owner audit rendering test.');
  if position(
       '''student'''
       in pg_get_functiondef('public.gcscan_auth_user_profile()'::regprocedure)
     ) = 0
     or position(
       'new.role := ''student'''
       in pg_get_functiondef('public.gcscan_protect_profile_role()'::regprocedure)
     ) = 0
     or position(
       'raw_user_meta_data ->> ''role'''
       in pg_get_functiondef('public.gcscan_auth_user_profile()'::regprocedure)
     ) > 0 then
    raise exception 'Signup bootstrap and existing profile guard must force the student role.';
  end if;
  perform pg_catalog.set_config(
    'gcscan.test.student_notification_id',
    student_notification_id::text,
    true
  );
  perform pg_catalog.set_config(
    'gcscan.test.teacher_notification_id',
    teacher_notification_id::text,
    true
  );
end;
$test$;

set local role authenticated;

do $test$
declare
  student_id uuid := current_setting('gcscan.test.student_id')::uuid;
  teacher_id uuid := current_setting('gcscan.test.teacher_id')::uuid;
  admin_id uuid := current_setting('gcscan.test.admin_id')::uuid;
  student_notification_id uuid := current_setting('gcscan.test.student_notification_id')::uuid;
  teacher_notification_id uuid := current_setting('gcscan.test.teacher_notification_id')::uuid;
  attendance_id text := current_setting('gcscan.test.attendance_id');
  original_attendance_status text := current_setting('gcscan.test.attendance_status');
  original_late_reason text := nullif(current_setting('gcscan.test.attendance_late_reason'), '');
  correction_id uuid;
  test_event_id uuid;
  test_event_code text := 'regression-' || pg_catalog.gen_random_uuid()::text;
  test_report jsonb;
  original_admin_role text;
  request_id uuid;
  notifications jsonb;
  members jsonb;
  audit_page jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', student_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', student_id, 'role', 'authenticated')::text,
    true
  );
  if public.gcscan_is_admin() then
    raise exception 'Student unexpectedly passed gcscan_is_admin.';
  end if;
  begin
    update public.profiles set role = 'teacher' where id = student_id;
    raise exception 'Student unexpectedly changed their profile role directly.';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.gcscan_admin_members(user_id) values (student_id);
    raise exception 'Student unexpectedly inserted their own administrator membership.';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.gcscan_admin_grant_membership(student_id);
    raise exception 'Student unexpectedly self-granted administrator membership.';
  exception when insufficient_privilege then
    null;
  end;
  request_id := public.gcscan_submit_teacher_access_request('Regression test request');
  if request_id is null
     or not exists (
       select 1 from jsonb_array_elements(
         public.gcscan_get_my_teacher_access_requests()->'items'
       ) item where item->>'id' = request_id::text
     ) then
    raise exception 'Student teacher-access submission/history failed.';
  end if;
  if not public.gcscan_withdraw_teacher_access_request(request_id) then
    raise exception 'Student could not withdraw their own pending teacher request.';
  end if;
  request_id := public.gcscan_submit_teacher_access_request('Approval regression request');
  notifications := public.gcscan_get_my_notifications(0);
  if jsonb_typeof(notifications->'items') is distinct from 'array' then
    raise exception 'Personal notification RPC returned an invalid shape.';
  end if;
  if not exists (
       select 1 from jsonb_array_elements(notifications->'items') item
       where item->>'id' = student_notification_id::text
     )
     or exists (
       select 1 from jsonb_array_elements(notifications->'items') item
       where item->>'id' = teacher_notification_id::text
     ) then
    raise exception 'Personal notifications were not restricted to auth.uid().';
  end if;
  if not public.gcscan_mark_my_notification_read(student_notification_id)
     or public.gcscan_mark_my_notification_read(teacher_notification_id) then
    raise exception 'Notification read updates were not restricted to auth.uid().';
  end if;
  begin
    perform public.gcscan_admin_overview();
    raise exception 'Student unexpectedly invoked the admin overview.';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.gcscan_admin_grant_membership(teacher_id);
    raise exception 'Student unexpectedly granted admin membership.';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.gcscan_admin_set_user_role(student_id, 'teacher');
    raise exception 'Student unexpectedly invoked the admin role-change RPC.';
  exception when insufficient_privilege then
    null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', teacher_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', teacher_id, 'role', 'authenticated')::text,
    true
  );
  if public.gcscan_is_admin() then
    raise exception 'Teacher without membership unexpectedly passed gcscan_is_admin.';
  end if;
  begin
    perform public.gcscan_admin_grant_membership(teacher_id);
    raise exception 'Teacher without membership unexpectedly granted admin membership.';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.gcscan_admin_grant_membership(teacher_id);
    raise exception 'Teacher unexpectedly self-granted administrator membership.';
  exception when insufficient_privilege then
    null;
  end;
  notifications := public.gcscan_get_my_notifications(0);
  if not exists (
       select 1 from jsonb_array_elements(notifications->'items') item
       where item->>'id' = teacher_notification_id::text
     )
     or exists (
       select 1 from jsonb_array_elements(notifications->'items') item
       where item->>'id' = student_notification_id::text
     )
     or public.gcscan_mark_my_notification_read(student_notification_id) then
    raise exception 'Teacher notification access escaped auth.uid() scope.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(
      public.gcscan_get_my_teacher_access_requests()->'items'
    ) item
    where item->>'student_id' = student_id::text
  ) then
    raise exception 'Teacher unexpectedly read another user''s teacher request history.';
  end if;
  begin
    perform public.gcscan_admin_list_users(null, 0, null);
    raise exception 'Teacher unexpectedly invoked the admin user-list RPC.';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.gcscan_admin_grant_membership(student_id);
    raise exception 'Teacher unexpectedly granted admin membership.';
  exception when insufficient_privilege then
    null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', admin_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  if not public.gcscan_is_admin() then
    raise exception 'Verified membership administrator was denied.';
  end if;
  select role into original_admin_role from public.profiles where id = admin_id;
  if not public.gcscan_admin_set_user_role(admin_id, 'student') then
    raise exception 'Administrator could not use the role RPC to retain the student app role.';
  end if;
  begin
    perform public.gcscan_submit_teacher_access_request('Admin role isolation test');
    raise exception 'An administrator member unexpectedly submitted a teacher access request.';
  exception when insufficient_privilege then
    null;
  end;
  if original_admin_role = 'teacher'
     and not public.gcscan_admin_set_user_role(admin_id, 'teacher') then
    raise exception 'Administrator profile role could not be restored after request isolation test.';
  end if;
  if public.gcscan_admin_overview() is null then
    raise exception 'Verified administrator did not receive an overview result.';
  end if;
  audit_page := public.gcscan_admin_list_audit('regression_owner_bootstrap', 0);
  if not exists (
    select 1 from jsonb_array_elements(audit_page->'items') item
    where item->>'actor_id' = 'trusted project owner'
  ) then
    raise exception 'Owner-bootstrap audit actor did not retain its client-facing label.';
  end if;
  if not public.gcscan_admin_set_user_role(admin_id, 'teacher')
     or not public.gcscan_is_admin() then
    raise exception 'Administrator membership was lost when the administrator profile became teacher.';
  end if;
  correction_id := public.gcscan_admin_correct_attendance(
    attendance_id,
    case when original_attendance_status = 'late' then 'present' else 'late' end,
    case when original_attendance_status = 'late' then null else 'Regression correction test' end,
    'Regression test correction; transaction will roll back.'
  );
  if correction_id is null then
    raise exception 'Authorized attendance correction did not create an audit entry.';
  end if;
  audit_page := public.gcscan_admin_list_audit('attendance', 0);
  if not exists (
    select 1 from jsonb_array_elements(audit_page->'items') item
    where item->>'action' = 'attendance_correction'
      and item->>'reason' = 'Regression test correction; transaction will roll back.'
  ) then
    raise exception 'Attendance correction audit history was not returned to the administrator.';
  end if;
  perform public.gcscan_admin_correct_attendance(
    attendance_id,
    original_attendance_status,
    original_late_reason,
    'Restore fixture after regression correction.'
  );
  test_event_id := public.gcscan_save_event(
    null,
    test_event_code,
    'Admin event regression',
    now() - interval '1 minute',
    now() + interval '1 hour',
    'Test venue',
    'Transaction-rolled-back permission fixture.',
    'active',
    0,
    false,
    false,
    null,
    null,
    100
  );
  test_report := public.gcscan_admin_report(test_event_id::text, null, null);
  if test_report is null
     or jsonb_typeof(test_report->'event_summaries') is distinct from 'array' then
    raise exception 'Filtered event report did not return its expected shape.';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', student_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', student_id, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.gcscan_close_event(test_event_id);
    raise exception 'Student unexpectedly closed an administrator-owned event.';
  exception when insufficient_privilege then
    null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', admin_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  if not public.gcscan_close_event(test_event_id) then
    raise exception 'Administrator could not close an event.';
  end if;
  if not public.gcscan_admin_grant_membership(teacher_id) then
    raise exception 'Administrator could not grant membership to an existing teacher.';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', teacher_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', teacher_id, 'role', 'authenticated')::text,
    true
  );
  if not public.gcscan_is_admin()
     or public.gcscan_admin_overview() is null then
    raise exception 'Teacher-role administrator did not receive administrator access.';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', admin_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  if not public.gcscan_admin_revoke_membership(teacher_id) then
    raise exception 'Administrator could not revoke a non-last teacher administrator.';
  end if;
  if not public.gcscan_admin_decide_teacher_request(request_id, 'approved', null) then
    raise exception 'Administrator could not approve the pending teacher request.';
  end if;
  begin
    perform public.gcscan_admin_grant_membership(admin_id);
    raise exception 'Administrator unexpectedly self-granted membership.';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles set role = 'teacher' where id = student_id;
    raise exception 'Administrator unexpectedly changed a profile role outside the role RPC.';
  exception when insufficient_privilege then
    null;
  end;
  if not public.gcscan_admin_set_user_role(student_id, 'student') then
    raise exception 'Administrator could not restore the approved profile to student.';
  end if;
  if not public.gcscan_admin_set_user_role(student_id, 'teacher') then
    raise exception 'Administrator could not assign teacher role through the authorized RPC.';
  end if;
  if not public.gcscan_admin_set_user_role(student_id, 'student') then
    raise exception 'Administrator could not restore student role through the authorized RPC.';
  end if;
  begin
    perform public.gcscan_admin_revoke_membership(admin_id);
    raise exception 'The last administrator unexpectedly revoked the final membership.';
  exception when insufficient_privilege then
    null;
  end;
  members := public.gcscan_admin_list_admin_members(0);
  if exists (
    select 1
    from jsonb_array_elements(coalesce(members->'items', '[]'::jsonb)) item
    where item->>'user_id' = student_id::text
  ) then
    raise exception 'A denied student membership grant unexpectedly persisted.';
  end if;
end;
$test$;

rollback;
