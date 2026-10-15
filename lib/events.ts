import { supabase } from './supabase';
import { normalizeAttendanceSettings } from './smartFeatures';

export type Event = {
  eventId: string;
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
};

export type CloudEvent = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  description: string | null;
  event_status: 'active' | 'closed';
  created_by: string | null;
  created_at: string;
  grace_period_minutes: number;
  zone_enabled: boolean;
  zone_lat: number | null;
  zone_lon: number | null;
  zone_radius_m: number;
  late_reason_enabled: boolean;
  archived_at: string | null;
};

export async function createEvent(
  event: Event
): Promise<{ error: string | null; eventId?: string }> {
  return saveEvent(event);
}

export async function saveEvent(
  event: Event,
  eventRecordId?: string
): Promise<{ error: string | null; eventId?: string }> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: 'You must be signed in to create an event.' };
  }

  const eventCode = event.eventId.trim();
  const title = event.title.trim();
  const settings = normalizeAttendanceSettings({
    gracePeriodMinutes: event.gracePeriodMinutes,
    lateReasonEnabled: event.lateReasonEnabled,
    zoneEnabled: event.zoneEnabled,
    zoneLat: event.zoneLat,
    zoneLon: event.zoneLon,
    zoneRadiusM: event.zoneRadiusM,
  });
  if (!eventCode || !title) {
    return { error: 'Event title and code are required.' };
  }

  if (!event.venue.trim() || !event.description.trim()) {
    return { error: 'Event venue and description are required.' };
  }

  const { data, error } = await supabase.rpc('gcscan_save_event', {
    p_event_id: eventRecordId ?? null,
    p_event_code: eventCode,
    p_title: title,
    p_start_time: event.start,
    p_end_time: event.end,
    p_venue: event.venue.trim(),
    p_description: event.description.trim(),
    p_event_status: event.eventStatus ?? 'active',
    p_grace_period_minutes: settings.gracePeriodMinutes,
    p_late_reason_enabled: settings.lateReasonEnabled,
    p_zone_enabled: settings.zoneEnabled,
    p_zone_lat: settings.zoneLat,
    p_zone_lon: settings.zoneLon,
    p_zone_radius_m: settings.zoneRadiusM,
  });
  if (error) return { error: error.message || 'Event could not be saved.' };
  if (typeof data !== 'string') return { error: 'The server did not confirm the saved event.' };

  return { error: null, eventId: data };
}

export async function closeEvent(eventId: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('gcscan_close_event', { p_event_id: eventId });
  if (error) return { success: false, message: error.message || 'Event could not be closed.' };
  if (data !== true) return { success: false, message: 'The event could not be found or is archived.' };
  return { success: true, message: 'Event closed. New attendance scans are blocked.' };
}

export async function getEventsByTeacher(
  teacherId: string
): Promise<CloudEvent[]> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user || user.id !== teacherId) {
    throw new Error('Your session could not be verified. Please sign in again.');
  }

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('created_by', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'Your events could not be loaded.');

  return (data ?? []) as CloudEvent[];
}

export async function getEventByCode(
  code: string
): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_code', code)
    .is('archived_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message || 'The event could not be verified.');
  if (!data) return null;

  return data as CloudEvent;
}


export async function getDeletedEventsByTeacher(teacherId: string): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('created_by', teacherId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (error) throw new Error(error.message || 'Recently deleted events could not be loaded.');
  return (data ?? []) as CloudEvent[];
}

export async function archiveEvent(eventId: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('gcscan_archive_event', { p_event_id: eventId });
  if (error) return { success: false, message: error.message || 'Event could not be moved to Recently Deleted.' };
  if (data === true) {
    return { success: true, message: 'Event moved to Recently Deleted for 15 days.' };
  }
  return {
    success: false,
    message: `Event was not archived (gcscan_archive_event returned ${String(data)}). The RPC did not provide a more specific reason.`,
  };
}

export async function restoreEvent(eventId: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('gcscan_restore_event', { p_event_id: eventId });
  if (error) return { success: false, message: error.message || 'Event could not be restored.' };
  return data ? { success: true, message: 'Event restored.' } : { success: false, message: 'This event is no longer recoverable.' };
}

export async function permanentlyDeleteEvent(eventId: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('gcscan_delete_event_permanently', { p_event_id: eventId });
  if (error) return { success: false, message: error.message || 'Event could not be permanently deleted.' };
  return data ? { success: true, message: 'Event permanently deleted.' } : { success: false, message: 'Event could not be permanently deleted.' };
}
