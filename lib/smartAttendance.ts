import { supabase } from './supabase';
import type { TeacherEventAttendance } from './attendance';

export type LiveEvent = Omit<TeacherEventAttendance, 'attendees'> & {
  attendees: (TeacherEventAttendance['attendees'][number] & {
    lateReason: string | null;
  })[];
};

export type AttendanceInsight = {
  tone: 'neutral' | 'positive' | 'warning';
  title: string;
  detail: string;
};

export type AttendanceAnomaly = {
  studentId: string;
  studentName: string | null;
  scannedAt: string;
  reason: string;
};

export async function getLiveEventAttendance(
  teacherId: string,
  eventId: string
): Promise<LiveEvent | null> {
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, start_time, end_time')
    .eq('id', eventId)
    .eq('created_by', teacherId)
    .is('archived_at', null)
    .maybeSingle();

  if (eventError || !event) return null;

  const { data: attendance, error: attendanceError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, attendance_status, late_reason')
    .eq('event_id', eventId)
    .order('scanned_at', { ascending: false });

  if (attendanceError || !attendance) return null;

  const studentIds = [...new Set(attendance.map((row: any) => row.student_id))];

  const { data: profiles } =
    studentIds.length > 0
      ? await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', studentIds)
      : { data: [] };

  const names = new Map(
    (profiles ?? []).map((profile: any) => [profile.id, profile.full_name])
  );

  return {
    eventId: event.id,
    eventCode: event.event_code,
    title: event.title,
    startTime: event.start_time,
    endTime: event.end_time,
    attendeeCount: attendance.length,
    attendees: attendance.map((row: any) => ({
      studentId: row.student_id,
      studentName: names.get(row.student_id) ?? null,
      scannedAt: row.scanned_at,
      status: row.attendance_status ?? 'present',
      lateReason: row.late_reason ?? null,
    })),
  };
}

export async function getTeacherAttendanceInsights(
  teacherId: string
): Promise<AttendanceInsight[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, title, start_time')
    .eq('created_by', teacherId)
    .is('archived_at', null);

  if (eventError) throw new Error(eventError.message || 'Attendance insights could not be loaded.');
  if (!events) throw new Error('Attendance insights could not be loaded.');
  if (events.length < 2) return [];

  const eventIds = events.map((event: any) => event.id);
  const { data: attendance, error: attendanceError } = await supabase
    .from('attendance')
    .select('event_id, student_id, scanned_at')
    .in('event_id', eventIds);

  if (attendanceError) throw new Error(attendanceError.message || 'Attendance insights could not be loaded.');
  if (!attendance) throw new Error('Attendance insights could not be loaded.');
  if (attendance.length < 3) return [];

  const counts = new Map<string, number>();
  attendance.forEach((row: any) => {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  });

  const orderedEvents = [...events].sort(
    (a: any, b: any) =>
      new Date(a.start_time ?? 0).getTime() -
      new Date(b.start_time ?? 0).getTime()
  );

  const first = counts.get(orderedEvents[0].id) ?? 0;
  const last = counts.get(orderedEvents[orderedEvents.length - 1].id) ?? 0;

  const insights: AttendanceInsight[] = [
    {
      tone: 'neutral',
      title: `${attendance.length} attendance records`,
      detail: `Across ${events.length} events created by this teacher.`,
    },
  ];

  if (last > first) {
    insights.push({
      tone: 'positive',
      title: 'Recent attendance volume is higher',
      detail: `The latest event recorded ${last} scans compared with ${first} in the earliest event.`,
    });
  } else if (last < first) {
    insights.push({
      tone: 'warning',
      title: 'Recent attendance volume is lower',
      detail: `The latest event recorded ${last} scans compared with ${first} in the earliest event.`,
    });
  } else {
    insights.push({
      tone: 'neutral',
      title: 'Attendance volume is stable',
      detail: 'The earliest and latest events currently have the same number of scans.',
    });
  }

  const hourCounts = new Map<number, number>();
  attendance.forEach((row: any) => {
    const hour = new Date(row.scanned_at).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  });

  let busiestHour: number | null = null;
  let busiestCount = 0;
  hourCounts.forEach((count, hour) => {
    if (count > busiestCount) {
      busiestHour = hour;
      busiestCount = count;
    }
  });

  if (busiestHour !== null && busiestCount >= 2) {
    const hourLabel = `${String(busiestHour).padStart(2, '0')}:00`;
    insights.push({
      tone: 'neutral',
      title: 'Most active scan period',
      detail: `More scans were recorded around ${hourLabel} than any other hour in the available data.`,
    });
  }

  return insights;
}

export function detectAttendanceAnomalies(
  attendees: Pick<
    TeacherEventAttendance['attendees'][number],
    'studentId' | 'studentName' | 'scannedAt'
  >[]
): AttendanceAnomaly[] {
  const sorted = [...attendees].sort(
    (a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime()
  );

  const anomalies: AttendanceAnomaly[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (
      current.studentId === previous.studentId &&
      new Date(current.scannedAt).getTime() -
        new Date(previous.scannedAt).getTime() <=
        60_000
    ) {
      anomalies.push({
        studentId: current.studentId,
        studentName: current.studentName,
        scannedAt: current.scannedAt,
        reason: 'Multiple attendance records appeared within one minute.',
      });
    }
  }

  return anomalies;
}
