import AmbientBackground from '@/components/AmbientBackground';
import AppButton from '@/components/AppButton';
import EntranceView from '@/components/EntranceView';
import { COLORS, RADIUS, SPACE } from '@/constants/colors';
import { TYPOGRAPHY } from '@/constants/typography';
import { useAuth } from '@/lib/auth';
import { getAttendanceHistory } from '@/lib/attendance';
import { type CloudEvent } from '@/lib/events';
import { getProfile } from '@/lib/profiles';
import { getRecoveryRequests, requestAttendanceRecovery, type RecoveryRequest } from '@/lib/smartFeatures';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function RecoveryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [requests, setRequests] = useState<RecoveryRequest[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CloudEvent | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const profile = await getProfile(user.id);
      if (!profile) throw new Error('Your profile could not be found.');
      if (profile.role !== 'student') {
        setEvents([]);
        setRequests([]);
        setLoadError('Attendance recovery requests are available only to student accounts.');
        return;
      }

      const [eventsResult, history, ownRequests] = await Promise.all([
        supabase.from('events').select('*').is('archived_at', null).order('start_time', { ascending: false }),
        getAttendanceHistory(user.id),
        getRecoveryRequests('student', user.id),
      ]);
      if (eventsResult.error) throw new Error(eventsResult.error.message || 'Eligible events could not be loaded.');
      const allEvents = (eventsResult.data ?? []) as CloudEvent[];
      const attended = new Set(history.map((item) => item.eventId));
      const pending = new Set(ownRequests.filter((item) => item.status === 'pending').map((item) => item.eventId));
      const now = Date.now();
      setEvents(allEvents.filter((event) => event.end_time && new Date(event.end_time).getTime() < now && !attended.has(event.event_code) && !pending.has(event.id)));
      setRequests(ownRequests);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Recovery information could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (!selectedEvent) { setMessage('Choose an ended event first.'); return; }
    if (reason.trim().length < 3) { setMessage('Please provide a short reason.'); return; }
    setSaving(true);
    setMessage(null);
    try {
      const result = await requestAttendanceRecovery(selectedEvent.id, reason);
      setMessage(result.message);
      if (result.success) { setSelectedEvent(null); setReason(''); await load(); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery request could not be submitted.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <AmbientBackground graphicSide="right" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <EntranceView>
        <View style={styles.header}>
          <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={COLORS.textPrimary} /></Pressable>
          <View style={styles.headerCopy}><Text style={styles.eyebrow}>ATTENDANCE RECOVERY</Text><Text style={styles.title}>Request a recovery</Text></View>
        </View>
        <Text style={styles.subtitle}>If you missed a scan, you can ask your teacher to review the event after it ends.</Text>
        </EntranceView>

        {loading ? <View style={styles.loading}><ActivityIndicator color={COLORS.primary} /><Text style={styles.loadingText}>Checking eligible events...</Text></View> : loadError ? (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.message}>{loadError}</Text>
            <AppButton title="Try again" theme="primary" icon="refresh-outline" onPress={() => void load()} />
          </View>
        ) : (
          <>
            <EntranceView delay={100}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Eligible events</Text>
              {events.length === 0 ? <Text style={styles.empty}>No ended event is currently eligible for recovery.</Text> : events.map((event) => (
                <Pressable key={event.id} onPress={() => { setSelectedEvent(event); setMessage(null); }} style={[styles.eventRow, selectedEvent?.id === event.id && styles.eventSelected]}>
                  <View style={styles.eventIcon}><Ionicons name="calendar-outline" size={18} color={COLORS.primary} /></View>
                  <View style={styles.eventCopy}><Text style={styles.eventTitle}>{event.title}</Text><Text style={styles.meta}>{event.event_code} · {formatDate(event.end_time)}</Text></View>
                  {selectedEvent?.id === event.id && <Ionicons name="checkmark-circle" size={20} color={COLORS.textOnPrimary} />}
                </Pressable>
              ))}
            </View>
            </EntranceView>

            {selectedEvent && <EntranceView delay={170}><View style={styles.card}>
              <Text style={styles.sectionTitle}>Why did you miss the scan?</Text>
              <TextInput value={reason} onChangeText={setReason} placeholder="Example: I was in a school activity." placeholderTextColor={COLORS.textMuted} multiline maxLength={1000} style={styles.textArea} />
              {message && <Text style={styles.message}>{message}</Text>}
              <AppButton title="Submit for review" theme="primary" icon="send-outline" onPress={submit} disabled={saving} />
            </View></EntranceView>}

            <EntranceView delay={240}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>My requests</Text>
              {requests.length === 0 ? <Text style={styles.empty}>No recovery requests yet.</Text> : requests.map((request) => (
                <View key={request.id} style={styles.requestRow}>
                  <View style={styles.requestCopy}><Text style={styles.eventTitle}>{request.eventTitle || request.eventCode || 'Event'}</Text><Text style={styles.reason}>{request.reason}</Text></View>
                  <View style={[styles.status, request.status === 'approved' && styles.statusApproved, request.status === 'rejected' && styles.statusRejected]}><Text style={styles.statusText}>{request.status}</Text></View>
                </View>
              ))}
            </View>
            </EntranceView>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function formatDate(value: string | null) { if (!value) return 'Date unavailable'; const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date unavailable' : d.toLocaleString(); }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACE.lg, paddingBottom: 116, width: '100%', maxWidth: 600, alignSelf: 'center', flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.md },
  back: { width: 44, height: 44, borderRadius: 16, backgroundColor: COLORS.glassStrong, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.champagneBorder, marginRight: 11 },
  headerCopy: { flex: 1 },
  eyebrow: { ...TYPOGRAPHY.label, fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.champagne },
  title: { ...TYPOGRAPHY.screenTitle, fontFamily: TYPOGRAPHY.displayFontFamily, color: COLORS.textPrimary, marginTop: 2 },
  subtitle: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, lineHeight: 20, color: COLORS.textSecondary, marginBottom: SPACE.lg },
  card: { backgroundColor: COLORS.glassStrong, borderRadius: RADIUS.xl, padding: SPACE.lg, borderWidth: 1, borderColor: COLORS.glassBorder, marginBottom: SPACE.md, shadowColor: COLORS.shadow, shadowOpacity: 0.10, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 2 },
  sectionTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 15, color: COLORS.textPrimary, marginBottom: 10 },
  eventRow: { minHeight: 68, borderRadius: 19, backgroundColor: COLORS.glassStrong, borderWidth: 1, borderColor: COLORS.glassBorder, padding: 11, flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  eventSelected: { borderColor: COLORS.champagneBorder, backgroundColor: COLORS.primary },
  eventIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.champagneSoft, borderWidth: 1, borderColor: COLORS.champagneBorder, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  eventCopy: { flex: 1 },
  eventTitle: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 12, color: COLORS.textPrimary },
  meta: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 9, color: COLORS.textSecondary, marginTop: 3 },
  textArea: { minHeight: 110, borderRadius: 20, backgroundColor: COLORS.pearlPanel, borderWidth: 1, borderColor: COLORS.pearlBorder, padding: 14, textAlignVertical: 'top', fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, color: COLORS.pearlText, marginBottom: 12 },
  message: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, lineHeight: 17, color: COLORS.champagne, marginBottom: 10 },
  requestRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  requestCopy: { flex: 1, paddingRight: 10 },
  reason: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, lineHeight: 15, color: COLORS.textSecondary, marginTop: 3 },
  status: { paddingHorizontal: 9, height: 27, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,194,75,0.14)', borderWidth: 1, borderColor: 'rgba(255,194,75,0.28)', alignItems: 'center', justifyContent: 'center' },
  statusApproved: { backgroundColor: 'rgba(61,220,151,0.14)', borderColor: 'rgba(61,220,151,0.28)' },
  statusRejected: { backgroundColor: 'rgba(255,122,155,0.14)', borderColor: 'rgba(255,122,155,0.28)' },
  statusText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 8, color: COLORS.textSecondary },
  empty: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 12, lineHeight: 18, color: COLORS.textSecondary },
  loading: { alignItems: 'center', paddingVertical: SPACE.section },
  loadingText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 12, color: COLORS.textSecondary, marginTop: SPACE.sm },
});
