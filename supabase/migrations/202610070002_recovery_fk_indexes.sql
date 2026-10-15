-- Performance indexes for recovery request foreign keys.
-- Safe to apply repeatedly.
create index if not exists attendance_recovery_attendance_id_idx
  on public.attendance_recovery_requests(attendance_id);

create index if not exists attendance_recovery_reviewed_by_idx
  on public.attendance_recovery_requests(reviewed_by);
