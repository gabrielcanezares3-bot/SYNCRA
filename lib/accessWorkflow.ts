import { supabase } from './supabase';

export type TeacherRequestStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'withdrawn'
  | 'cancelled';

export type TeacherAccessRequest = {
  id: string;
  reason: string;
  status: TeacherRequestStatus;
  requested_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
  decision_reason: string | null;
};

export type InAppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseItems<T>(value: unknown): T[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('The access service returned an invalid response.');
  }
  return value.items as T[];
}

export async function getMyTeacherAccessRequests(): Promise<TeacherAccessRequest[]> {
  const { data, error } = await supabase.rpc('gcscan_get_my_teacher_access_requests');
  if (error) throw new Error(error.message || 'Teacher access requests could not be loaded.');
  return parseItems<TeacherAccessRequest>(data);
}

export async function submitTeacherAccessRequest(reason: string): Promise<void> {
  const cleanedReason = reason.trim();
  if (cleanedReason.length < 3) throw new Error('Please provide a reason of at least 3 characters.');
  const { data, error } = await supabase.rpc('gcscan_submit_teacher_access_request', {
    p_reason: cleanedReason,
  });
  if (error) throw new Error(error.message || 'Teacher access request could not be submitted.');
  if (!isUuid(data)) {
    throw new Error('The server did not confirm the teacher access request.');
  }
}

export async function withdrawTeacherAccessRequest(requestId: string): Promise<void> {
  const { data, error } = await supabase.rpc('gcscan_withdraw_teacher_access_request', {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message || 'Teacher access request could not be withdrawn.');
  if (data !== true) throw new Error('The request was not pending and could not be withdrawn.');
}

export async function getMyNotifications(): Promise<InAppNotification[]> {
  const { data, error } = await supabase.rpc('gcscan_get_my_notifications', {
    p_offset: 0,
  });
  if (error) throw new Error(error.message || 'Notifications could not be loaded.');
  return parseItems<InAppNotification>(data);
}

export async function markMyNotificationRead(notificationId: string): Promise<void> {
  const { data, error } = await supabase.rpc('gcscan_mark_my_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw new Error(error.message || 'Notification could not be marked as read.');
  if (data !== true) throw new Error('The notification could not be updated.');
}
