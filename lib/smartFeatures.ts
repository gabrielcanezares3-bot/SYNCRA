import { supabase } from './supabase';

export const LATE_REASONS = [
  'Transportation',
  'School Activity',
  'Weather',
  'Personal Reason',
  'Other',
] as const;

export type LateReason = (typeof LATE_REASONS)[number];
export type AttendanceStatus = 'present' | 'late' | 'recovered';

export type AttendanceSettings = {
  gracePeriodMinutes: number;
  zoneEnabled: boolean;
  zoneLat: number | null;
  zoneLon: number | null;
  zoneRadiusM: number;
  lateReasonEnabled: boolean;
};

export type RecoveryStatus = 'pending' | 'approved' | 'rejected';

export type RecoveryRequest = {
  id: string;
  studentId: string;
  eventId: string;
  reason: string;
  status: RecoveryStatus;
  requestedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  attendanceId: number | null;
  eventTitle?: string | null;
  eventCode?: string | null;
  studentName?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === 'present' || value === 'late' || value === 'recovered';
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeAttendanceSettings(
  settings?: Partial<AttendanceSettings>
): AttendanceSettings {
  const grace = Math.max(0, Math.min(120, Math.round(settings?.gracePeriodMinutes ?? 0)));
  const radius = Math.max(25, Math.min(2000, Math.round(settings?.zoneRadiusM ?? 100)));
  const hasCoordinates =
    Number.isFinite(settings?.zoneLat) &&
    Number.isFinite(settings?.zoneLon) &&
    (settings?.zoneLat ?? -91) >= -90 &&
    (settings?.zoneLat ?? 91) <= 90 &&
    (settings?.zoneLon ?? -181) >= -180 &&
    (settings?.zoneLon ?? 181) <= 180;

  return {
    gracePeriodMinutes: grace,
    zoneEnabled: Boolean(settings?.zoneEnabled && hasCoordinates),
    zoneLat: hasCoordinates ? (settings?.zoneLat ?? null) : null,
    zoneLon: hasCoordinates ? (settings?.zoneLon ?? null) : null,
    zoneRadiusM: radius,
    lateReasonEnabled: Boolean(settings?.lateReasonEnabled),
  };
}

export async function recordSmartAttendance(
  eventCode: string,
  location?: { latitude: number; longitude: number },
  lateReason?: LateReason | null
): Promise<{
  success: boolean;
  status?: AttendanceStatus;
  eventTitle?: string;
  scannedAt?: string;
  message: string;
}> {
  const { data, error } = await supabase.rpc('gcscan_record_attendance', {
    p_event_code: eventCode.trim(),
    p_lat: location?.latitude ?? null,
    p_lon: location?.longitude ?? null,
    p_late_reason: lateReason ?? null,
  });

  if (error) {
    const message = error.message || 'Attendance could not be recorded.';
    return { success: false, message };
  }

  const result: unknown = data;
  if (!isRecord(result) || !isAttendanceStatus(result.status)) {
    return { success: false, message: 'The attendance service returned an invalid response.' };
  }
  const status = result.status;
  return {
    success: true,
    status,
    eventTitle: typeof result.event_title === 'string' ? result.event_title : undefined,
    scannedAt: typeof result.scanned_at === 'string' ? result.scanned_at : undefined,
    message: status === 'late' ? 'Attendance recorded as late.' : 'Attendance recorded!',
  };
}

export async function requestAttendanceRecovery(
  eventId: string,
  reason: string
): Promise<{ success: boolean; requestId?: string; message: string }> {
  const { data, error } = await supabase.rpc('gcscan_request_recovery', {
    p_event_id: eventId,
    p_reason: reason.trim(),
  });

  if (error) return { success: false, message: error.message || 'Recovery request could not be submitted.' };
  if (!isUuid(data)) {
    return { success: false, message: 'The server did not confirm the recovery request.' };
  }
  return { success: true, requestId: data, message: 'Recovery request submitted for teacher review.' };
}

export async function getRecoveryRequests(
  role: 'student' | 'teacher',
  userId: string
): Promise<RecoveryRequest[]> {
  const base = supabase
    .from('attendance_recovery_requests')
    .select('id, student_id, event_id, reason, status, requested_at, reviewed_at, review_note, attendance_id')
    .order('requested_at', { ascending: false });

  const { data, error } = role === 'student'
    ? await base.eq('student_id', userId)
    : await base;

  if (error) throw new Error(error.message || 'Recovery requests could not be loaded.');
  if (!data) return [];

  const eventIds = [...new Set(data.map((row: any) => row.event_id))];
  const studentIds = [...new Set(data.map((row: any) => row.student_id))];
  const [eventsResult, profilesResult] = await Promise.all([
    eventIds.length
      ? supabase.from('events').select('id, title, event_code, created_by').in('id', eventIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    studentIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', studentIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (eventsResult.error) throw new Error(eventsResult.error.message || 'Recovery event details could not be loaded.');
  if (profilesResult.error) throw new Error(profilesResult.error.message || 'Recovery student details could not be loaded.');

  const eventMap = new Map((eventsResult.data ?? []).map((event: any) => [event.id, event]));
  const profileMap = new Map((profilesResult.data ?? []).map((profile: any) => [profile.id, profile]));
  const visible = role === 'teacher' ? data.filter((row: any) => eventMap.get(row.event_id)?.created_by === userId) : data;

  return visible.map((row: any) => {
    const event = eventMap.get(row.event_id);
    const profile = profileMap.get(row.student_id);
    return {
      id: row.id,
      studentId: row.student_id,
      eventId: row.event_id,
      reason: row.reason,
      status: row.status,
      requestedAt: row.requested_at,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      attendanceId: row.attendance_id,
      eventTitle: event?.title ?? null,
      eventCode: event?.event_code ?? null,
      studentName: profile?.full_name ?? null,
    };
  });
}

export async function reviewAttendanceRecovery(
  requestId: string,
  decision: 'approved' | 'rejected',
  note?: string
): Promise<{ success: boolean; message: string }> {
  const { error } = await supabase.rpc('gcscan_review_recovery', {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });
  if (error) return { success: false, message: error.message || 'Recovery review failed.' };
  return { success: true, message: decision === 'approved' ? 'Recovery approved.' : 'Recovery rejected.' };
}
