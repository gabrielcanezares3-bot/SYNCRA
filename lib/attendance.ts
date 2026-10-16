import { parseQRPayload } from './qr';
import { supabase } from './supabase';
import { recordSmartAttendance, type AttendanceStatus, type LateReason } from './smartFeatures';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type AttendanceRecord = {
  id: string;
  eventId: string;
  eventTitle: string;
  scannedAt: string;
  status: AttendanceStatus;
  lateReason: string | null;
};

export type RegisterResult = {
  success: boolean;
  message: string;
  eventTitle?: string;
  status?: AttendanceStatus;
};

export async function registerAttendance(
  rawPayload: string,
  studentId: string,
  location?: { latitude: number; longitude: number },
  lateReason?: LateReason | null
): Promise<RegisterResult> {
  const parsed = parseQRPayload(rawPayload);
  if (!parsed.ok) return { success: false, message: parsed.message };

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || user.id !== studentId) {
    return { success: false, message: 'Your session could not be verified. Please sign in again.' };
  }

  const result = await recordSmartAttendance(parsed.payload.event, location, lateReason);
  return {
    success: result.success,
    message: result.message,
    eventTitle: result.eventTitle,
    status: result.status,
  };
}

export async function getAttendanceHistory(
  studentId: string
): Promise<AttendanceRecord[]> {
  return fetchAttendanceHistory(studentId);
}

async function fetchAttendanceHistory(studentId: string): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select('id, scanned_at, attendance_status, late_reason, events ( event_code, title )')
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });

  if (error) throw new Error(error.message || 'Attendance history could not be loaded.');
  if (!data) throw new Error('Attendance history could not be loaded.');

  return data.map((row: any) => ({
    id: row.id,
    eventId: row.events?.event_code ?? '',
    eventTitle: row.events?.title ?? '',
    scannedAt: row.scanned_at,
    status: row.attendance_status ?? 'present',
    lateReason: row.late_reason ?? null,
  }));
}

const HISTORY_CLEARED_AT_KEY = 'gcscan.attendance-history-cleared';
const LEGACY_WEB_HISTORY_CLEARED_AT_KEY = 'gcscan:attendance-history-cleared';

function getHistoryClearTimestampKey(studentId: string): string {
  const key = `${HISTORY_CLEARED_AT_KEY}.${studentId}`;
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new Error('Your account ID cannot be used to access saved attendance settings.');
  }
  return key;
}

async function getHistoryClearTimestamp(studentId: string): Promise<number | null> {
  const key = getHistoryClearTimestampKey(studentId);
  let stored: string | null;
  if (Platform.OS === 'web') {
    stored = globalThis.localStorage.getItem(key)
      ?? globalThis.localStorage.getItem(`${LEGACY_WEB_HISTORY_CLEARED_AT_KEY}:${studentId}`);
  } else {
    stored = await SecureStore.getItemAsync(key);
  }

  if (!stored) return null;
  const timestamp = Date.parse(stored);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Saved attendance history settings are invalid.');
  }
  return timestamp;
}

async function saveHistoryClearTimestamp(studentId: string, timestamp: string): Promise<void> {
  const key = getHistoryClearTimestampKey(studentId);
  if (Platform.OS === 'web') {
    globalThis.localStorage.setItem(key, timestamp);
    return;
  }
  await SecureStore.setItemAsync(key, timestamp);
}

async function verifyCurrentStudent(studentId: string): Promise<void> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || user.id !== studentId) {
    throw new Error('Your session could not be verified. Please sign in again.');
  }
}

export async function getVisibleAttendanceHistory(
  studentId: string
): Promise<{ records: AttendanceRecord[]; wasCleared: boolean }> {
  await verifyCurrentStudent(studentId);
  const [records, clearedAt] = await Promise.all([
    fetchAttendanceHistory(studentId),
    getHistoryClearTimestamp(studentId),
  ]);
  if (clearedAt === null) return { records, wasCleared: false };
  return {
    records: records.filter((record) => {
      const scannedAt = Date.parse(record.scannedAt);
      return !Number.isFinite(scannedAt) || scannedAt > clearedAt;
    }),
    wasCleared: true,
  };
}

export async function clearVisibleAttendanceHistory(studentId: string): Promise<void> {
  await verifyCurrentStudent(studentId);
  await saveHistoryClearTimestamp(studentId, new Date().toISOString());
}

export type TeacherEventAttendance = {
  eventId: string;
  eventCode: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  attendeeCount: number;
  attendees: {
    studentId: string;
    studentName: string | null;
    scannedAt: string;
    status: string;
  }[];
};

export type TeacherEventSummary = {
  eventId: string;
  eventCode: string;
  title: string;
  attendeeCount: number;
};

export type StudentAttendanceInsights = {
  total: number;
  present: number;
  late: number;
  recovered: number;
  monthlyActivity: { key: string; label: string; count: number }[];
};

export type TeacherProfileOverview = {
  eventCount: number;
  scanCount: number;
  events: TeacherEventSummary[];
};

async function verifyUserId(userId: string): Promise<void> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || user.id !== userId) {
    throw new Error('Your session could not be verified. Please sign in again.');
  }
}

export async function getStudentAttendanceInsights(
  studentId: string
): Promise<StudentAttendanceInsights> {
  await verifyUserId(studentId);
  const { data, error } = await supabase
    .from('attendance')
    .select('scanned_at, attendance_status')
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });

  if (error) throw new Error(error.message || 'Attendance insights could not be loaded.');

  const records = data ?? [];
  const monthlyActivity = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return {
      key,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      count: records.filter((record) => {
        const scanned = new Date(record.scanned_at);
        return Number.isFinite(scanned.getTime()) &&
          scanned.getFullYear() === date.getFullYear() &&
          scanned.getMonth() === date.getMonth();
      }).length,
    };
  });

  return {
    total: records.length,
    present: records.filter((record) => record.attendance_status === 'present').length,
    late: records.filter((record) => record.attendance_status === 'late').length,
    recovered: records.filter((record) => record.attendance_status === 'recovered').length,
    monthlyActivity,
  };
}

export async function getTeacherProfileOverview(
  teacherId: string
): Promise<TeacherProfileOverview> {
  await verifyUserId(teacherId);
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title')
    .eq('created_by', teacherId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (eventError) throw new Error(eventError.message || 'Your events could not be loaded.');
  const ownedEvents = events ?? [];
  if (ownedEvents.length === 0) return { eventCount: 0, scanCount: 0, events: [] };

  const { data: attendance, error: attendanceError } = await supabase
    .from('attendance')
    .select('event_id')
    .in('event_id', ownedEvents.map((event) => event.id));

  if (attendanceError) throw new Error(attendanceError.message || 'Attendance totals could not be loaded.');
  const counts = new Map<string, number>();
  (attendance ?? []).forEach((row) => counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1));
  const summaries = ownedEvents.map((event) => ({
    eventId: event.id,
    eventCode: event.event_code,
    title: event.title,
    attendeeCount: counts.get(event.id) ?? 0,
  }));

  return {
    eventCount: summaries.length,
    scanCount: summaries.reduce((total, event) => total + event.attendeeCount, 0),
    events: summaries,
  };
}

export async function getTeacherEventAttendance(
  teacherId: string
): Promise<TeacherEventAttendance[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, start_time, end_time')
    .eq('created_by', teacherId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (eventError || !events) return [];

  const eventIds = events.map((e: any) => e.id);

  if (eventIds.length === 0) return [];

  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, event_id, attendance_status')
    .in('event_id', eventIds)
    .order('scanned_at', { ascending: false });

  if (attError || !attendance) return [];

  const studentIds = [...new Set(attendance.map((a: any) => a.student_id))];

  const { data: profilesData } =
    studentIds.length > 0
      ? await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', studentIds)
      : { data: null };

  const profilesById = new Map(
    (profilesData ?? []).map((p: any) => [p.id, p])
  );

  return events.map((e: any) => {
    const rows = attendance.filter((a: any) => a.event_id === e.id);

    return {
      eventId: e.id,
      eventCode: e.event_code,
      title: e.title,
      startTime: e.start_time,
      endTime: e.end_time,
      attendeeCount: rows.length,
      attendees: rows.map((a: any) => ({
        studentId: a.student_id,
        studentName: profilesById.get(a.student_id)?.full_name ?? null,
        scannedAt: a.scanned_at,
        status: a.attendance_status,
      })),
    };
  });
}

export async function getTeacherEventSummary(
  teacherId: string
): Promise<TeacherEventSummary[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title')
    .eq('created_by', teacherId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (eventError || !events) return [];

  const eventIds = events.map((e: any) => e.id);
  if (eventIds.length === 0) return [];

  const { data: attRows, error: attError } = await supabase
    .from('attendance')
    .select('event_id')
    .in('event_id', eventIds);

  if (attError || !attRows) return [];

  const counts: Record<string, number> = {};
  attRows.forEach((r: any) => {
    counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
  });

  return events.map((e: any) => ({
    eventId: e.id,
    eventCode: e.event_code,
    title: e.title,
    attendeeCount: counts[e.id] ?? 0,
  }));
}
