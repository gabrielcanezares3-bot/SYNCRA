import { supabase } from './supabase';

export type AdminSection =
  | 'overview'
  | 'teacherRequests'
  | 'users'
  | 'events'
  | 'attendance'
  | 'audit'
  | 'adminAccess';
export type ManagedRole = 'student' | 'teacher';
export type AdminUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: ManagedRole;
};
export type AdminEvent = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  description: string | null;
  event_status: 'active' | 'closed';
  grace_period_minutes: number;
  late_reason_enabled: boolean;
  zone_enabled: boolean;
  zone_lat: number | null;
  zone_lon: number | null;
  zone_radius_m: number;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
};
export type AdminAttendance = {
  id: string;
  student_id: string;
  student_name: string | null;
  event_id: string;
  event_title: string | null;
  event_code: string | null;
  scanned_at: string;
  attendance_status: 'present' | 'late' | 'recovered';
  late_reason: string | null;
};
export type AdminOverview = {
  user_count: number;
  student_count: number;
  teacher_count: number;
  event_count: number;
  active_event_count: number;
  upcoming_event_count: number;
  closed_event_count: number;
  attendance_count: number;
  archived_event_count: number;
  correction_count: number;
  pending_teacher_request_count: number;
};
export type AdminReport = {
  status_counts: Record<string, number>;
  event_summaries: {
    event_id: string;
    event_title: string;
    event_code: string;
    start_time: string | null;
    end_time: string | null;
    attendance_count: number;
    status_counts: Record<string, number>;
  }[];
  recent_attendance: {
    id: string;
    event_id: string;
    event_title: string | null;
    event_code: string | null;
    student_name: string | null;
    attendance_status: string;
    scanned_at: string;
  }[];
  recent_corrections: {
    id: string;
    attendance_id: string;
    reason: string;
    corrected_at: string;
    actor_id: string;
    before_record: Record<string, unknown>;
    after_record: Record<string, unknown>;
  }[];
};
export type AdminPage<T> = { items: T[]; has_more: boolean };
export type AdminTeacherRequest = {
  id: string;
  student_id: string;
  student_name: string | null;
  student_email: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn' | 'cancelled';
  requested_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
  decision_reason: string | null;
};
export type AdminAuditEntry = {
  id: string;
  actor_id: string;
  action: string;
  subject_id: string | null;
  reason: string | null;
  before_record: Record<string, unknown> | null;
  after_record: Record<string, unknown> | null;
  created_at: string;
};
export type AdminMember = {
  user_id: string;
  email: string;
  full_name: string | null;
  granted_at: string;
  granted_by: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parsePage<T>(value: unknown): AdminPage<T> {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.has_more !== 'boolean') {
    throw new Error('Administrator service returned an invalid response.');
  }
  return { items: value.items as T[], has_more: value.has_more };
}

async function callAdmin<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || 'Administrator request failed.');
  return data as T;
}

export async function checkAdministratorAccess(): Promise<boolean> {
  const result: unknown = await callAdmin('gcscan_is_admin');
  if (typeof result !== 'boolean') throw new Error('Administrator access could not be verified.');
  return result;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const result: unknown = await callAdmin('gcscan_admin_overview');
  if (!isRecord(result)) throw new Error('Administrator overview is unavailable.');
  return result as unknown as AdminOverview;
}

export async function listAdminUsers(search = '', page = 0, role = ''): Promise<AdminPage<AdminUser>> {
  const result: unknown = await callAdmin('gcscan_admin_list_users', {
    p_search: search.trim() || null,
    p_offset: page * 100,
    p_role: role || null,
  });
  return parsePage<AdminUser>(result);
}

export async function setManagedUserRole(userId: string, role: ManagedRole): Promise<void> {
  const changed = await callAdmin<boolean>('gcscan_admin_set_user_role', { p_user_id: userId, p_role: role });
  if (!changed) throw new Error('The requested user profile was not found.');
}

export async function listAdminEvents(page = 0): Promise<AdminPage<AdminEvent>> {
  const result: unknown = await callAdmin('gcscan_admin_list_events', { p_offset: page * 100 });
  return parsePage<AdminEvent>(result);
}

export async function setAdminEventArchived(eventId: string, archived: boolean): Promise<void> {
  const changed = await callAdmin<boolean>('gcscan_admin_set_event_archived', {
    p_event_id: eventId,
    p_archived: archived,
  });
  if (!changed) throw new Error('The event could not be changed; it may have expired from retention.');
}

export async function saveAdminEvent(event: {
  eventCode: string;
  title: string;
  start: string;
  end: string;
  venue: string;
  description: string;
  eventStatus?: 'active' | 'closed';
  gracePeriodMinutes?: number;
  lateReasonEnabled?: boolean;
  zoneEnabled?: boolean;
  zoneLat?: number | null;
  zoneLon?: number | null;
  zoneRadiusM?: number;
}, eventId?: string): Promise<void> {
  const result: unknown = await callAdmin('gcscan_save_event', {
    p_event_id: eventId ?? null,
    p_event_code: event.eventCode.trim(),
    p_title: event.title.trim(),
    p_start_time: event.start,
    p_end_time: event.end,
    p_venue: event.venue.trim(),
    p_description: event.description.trim(),
    p_event_status: event.eventStatus ?? 'active',
    p_grace_period_minutes: event.gracePeriodMinutes ?? 0,
    p_late_reason_enabled: event.lateReasonEnabled ?? false,
    p_zone_enabled: event.zoneEnabled ?? false,
    p_zone_lat: event.zoneLat ?? null,
    p_zone_lon: event.zoneLon ?? null,
    p_zone_radius_m: event.zoneRadiusM ?? 100,
  });
  if (!isUuid(result)) throw new Error('The server did not confirm the saved event.');
}

export async function closeAdminEvent(eventId: string): Promise<void> {
  const result = await callAdmin<boolean>('gcscan_close_event', { p_event_id: eventId });
  if (!result) throw new Error('The event could not be found or is archived.');
}

export async function listAdminAttendance(filters: {
  eventId?: string;
  status?: string;
  studentId?: string;
  from?: string;
  to?: string;
  page?: number;
} = {}): Promise<AdminPage<AdminAttendance>> {
  const result: unknown = await callAdmin('gcscan_admin_list_attendance', {
    p_event_id: filters.eventId || null,
    p_status: filters.status || null,
    p_student_id: filters.studentId || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_offset: (filters.page ?? 0) * 100,
  });
  return parsePage<AdminAttendance>(result);
}

export async function correctAdminAttendance(
  attendanceId: string,
  status: AdminAttendance['attendance_status'],
  lateReason: string | null,
  reason: string,
): Promise<void> {
  const auditId: unknown = await callAdmin('gcscan_admin_correct_attendance', {
    p_attendance_id: attendanceId,
    p_attendance_status: status,
    p_late_reason: lateReason,
    p_reason: reason.trim(),
  });
  if (!isUuid(auditId)) {
    throw new Error('The attendance correction audit entry could not be confirmed.');
  }
}

export async function getAdminReport(filters: {
  eventId?: string;
  from?: string;
  to?: string;
} = {}): Promise<AdminReport> {
  const result: unknown = await callAdmin('gcscan_admin_report', {
    p_event_id: filters.eventId || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
  });
  if (!isRecord(result)) throw new Error('Administrator report is unavailable.');
  return result as unknown as AdminReport;
}

export async function listAdminTeacherRequests(
  status = 'pending',
  page = 0,
): Promise<AdminPage<AdminTeacherRequest>> {
  const result: unknown = await callAdmin('gcscan_admin_list_teacher_requests', {
    p_status: status || null,
    p_offset: page * 100,
  });
  return parsePage<AdminTeacherRequest>(result);
}

export async function decideAdminTeacherRequest(
  requestId: string,
  decision: 'approved' | 'declined' | 'cancelled',
  reason: string | null,
): Promise<void> {
  const result: unknown = await callAdmin('gcscan_admin_decide_teacher_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_reason: reason?.trim() || null,
  });
  if (result !== true) throw new Error('The teacher access request was not updated.');
}

export async function listAdminAudit(
  category = '',
  page = 0,
): Promise<AdminPage<AdminAuditEntry>> {
  const result: unknown = await callAdmin('gcscan_admin_list_audit', {
    p_category: category || null,
    p_offset: page * 100,
  });
  return parsePage<AdminAuditEntry>(result);
}

export async function listAdminMembers(page = 0): Promise<AdminPage<AdminMember>> {
  const result: unknown = await callAdmin('gcscan_admin_list_admin_members', {
    p_offset: page * 100,
  });
  return parsePage<AdminMember>(result);
}

export async function grantAdminMembership(userId: string): Promise<void> {
  const result: unknown = await callAdmin('gcscan_admin_grant_membership', {
    p_user_id: userId.trim(),
  });
  if (result !== true) throw new Error('Administrator membership was not granted.');
}

export async function revokeAdminMembership(userId: string): Promise<void> {
  const result: unknown = await callAdmin('gcscan_admin_revoke_membership', {
    p_user_id: userId,
  });
  if (result !== true) throw new Error('Administrator membership was not revoked.');
}
