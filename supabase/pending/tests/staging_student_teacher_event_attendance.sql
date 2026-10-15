-- Rollback-only staging regression test for the student/teacher event and
-- attendance RPC paths. Never run against production or shared user data.
-- Replace both UUID placeholders with disposable existing fixture accounts.
-- Requires migration 003 and the separately reviewed gcscan_record_attendance
-- RPC, whose implementation is not present in this repository's migrations.
begin;

select set_config('gcscan.test.student_id', 'REPLACE_WITH_STUDENT_UUID', true);
select set_config('gcscan.test.teacher_id', 'REPLACE_WITH_TEACHER_UUID', true);

do $preflight$
declare
  student_id uuid := current_setting('gcscan.test.student_id')::uuid;
  teacher_id uuid := current_setting('gcscan.test.teacher_id')::uuid;
begin
  if student_id = teacher_id then
    raise exception 'Use distinct disposable student and teacher fixtures.';
  end if;
  if (select role from public.profiles where id = student_id) is distinct from 'student'
     or (select role from public.profiles where id = teacher_id) is distinct from 'teacher'
     or exists (
       select 1 from public.gcscan_admin_members
       where user_id in (student_id, teacher_id)
     ) then
    raise exception 'Fixtures must be a non-admin student and a non-admin teacher.';
  end if;
  if to_regprocedure(
       'public.gcscan_save_event(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,integer,boolean,boolean,double precision,double precision,integer)'
     ) is null
     or to_regprocedure(
       'public.gcscan_record_attendance(text,double precision,double precision,text)'
     ) is null then
    raise exception 'Required event or attendance RPC signature is absent; inspect the staging app contract before running this test.';
  end if;
end;
$preflight$;

set local role authenticated;

do $test$
declare
  student_id uuid := current_setting('gcscan.test.student_id')::uuid;
  teacher_id uuid := current_setting('gcscan.test.teacher_id')::uuid;
  event_id uuid;
  event_code text := 'staging-regression-' || pg_catalog.gen_random_uuid()::text;
  attendance_result jsonb;
  recorded_student uuid;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', teacher_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', teacher_id, 'role', 'authenticated')::text,
    true
  );

  event_id := public.gcscan_save_event(
    null,
    event_code,
    'Staging attendance regression',
    now() - interval '1 minute',
    now() + interval '1 hour',
    'Disposable staging venue',
    'Rollback-only regression event.',
    'active',
    0,
    false,
    false,
    null,
    null,
    100
  );

  if event_id is null or not exists (
    select 1 from public.events
    where id = event_id and created_by = teacher_id
  ) then
    raise exception 'Teacher event creation did not assign ownership to auth.uid().';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', student_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', student_id, 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.gcscan_close_event(event_id);
    raise exception 'Student unexpectedly closed a teacher-owned event.';
  exception when insufficient_privilege then
    null;
  end;

  attendance_result := public.gcscan_record_attendance(
    event_code, null::double precision, null::double precision, null::text
  );
  if attendance_result is null
     or attendance_result->>'status' is null
     or attendance_result->>'status' not in ('present', 'late') then
    raise exception 'Attendance RPC did not return the expected recorded status.';
  end if;

  select a.student_id into recorded_student
  from public.attendance a
  where a.event_id = event_id
  order by a.scanned_at desc
  limit 1;

  if recorded_student is distinct from student_id then
    raise exception 'Attendance identity was not derived from auth.uid().';
  end if;
end;
$test$;

rollback;
