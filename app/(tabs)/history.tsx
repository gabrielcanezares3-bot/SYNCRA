import AmbientBackground from '@/components/AmbientBackground';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS, RADIUS, SPACE } from '@/constants/colors';
import EntranceView from '@/components/EntranceView';
import { TYPOGRAPHY } from '@/constants/typography';
import { useAuth } from '@/lib/auth';
import { clearVisibleAttendanceHistory, getVisibleAttendanceHistory, getTeacherEventAttendance, type AttendanceRecord, type TeacherEventAttendance } from '@/lib/attendance';
import { getProfile, type Role } from '@/lib/profiles';

export default function HistoryScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const listBottomPadding = Math.max(116, Math.max(insets.bottom, 8) + 110);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [studentRecords, setStudentRecords] = useState<AttendanceRecord[]>([]);
  const [teacherEvents, setTeacherEvents] = useState<TeacherEventAttendance[]>([]);
  const [historyWasCleared, setHistoryWasCleared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lateCount = studentRecords.filter((record) => record.status === 'late').length;
  const teacherScanCount = teacherEvents.reduce((total, event) => total + event.attendeeCount, 0);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoadError(null);
    try {
      const profile = await getProfile(user.id);
      if (!profile) throw new Error('Your profile could not be found.');
      const currentRole = profile.role;
      setRole(currentRole);
      if (currentRole === 'teacher') {
        setTeacherEvents(await getTeacherEventAttendance(user.id));
        setStudentRecords([]);
        setHistoryWasCleared(false);
      } else {
        const history = await getVisibleAttendanceHistory(user.id);
        setStudentRecords(history.records);
        setHistoryWasCleared(history.wasCleared);
        setTeacherEvents([]);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Attendance history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const handleClearHistory = async () => {
    if (!user || role !== 'student' || studentRecords.length === 0 || clearingHistory) return;
    setClearingHistory(true);
    setClearError(null);
    try {
      await clearVisibleAttendanceHistory(user.id);
      setStudentRecords([]);
      setHistoryWasCleared(true);
      setConfirmClear(false);
    } catch (error) {
      setClearError(error instanceof Error ? error.message : 'Your history could not be cleared.');
    } finally {
      setClearingHistory(false);
    }
  };

  return (
    <View style={styles.container}>
      <AmbientBackground graphicSide="left" />
      <View style={styles.content}>
        <View style={styles.pageHeader}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{role === 'teacher' ? 'TEACHER VIEW' : 'MY ACTIVITY'}</Text>
            <Text style={styles.title}>Attendance history</Text>
          </View>
          {role === 'student' ? (
            <Pressable style={styles.headerIcon} onPress={() => router.push('/recovery')} accessibilityRole="button">
              <Ionicons name="document-text-outline" size={20} color={COLORS.champagne} />
            </Pressable>
          ) : (
            <View style={styles.headerIcon}><Ionicons name="time-outline" size={21} color={COLORS.champagne} /></View>
          )}
        </View>
        {role === 'student' && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: loading || studentRecords.length === 0 }}
            disabled={loading || studentRecords.length === 0}
            onPress={() => { setClearError(null); setConfirmClear(true); }}
            style={({ pressed }) => [styles.clearHistoryButton, (loading || studentRecords.length === 0) && styles.clearHistoryDisabled, pressed && styles.clearHistoryPressed]}
          >
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
            <Text style={styles.clearHistoryText}>Clear History</Text>
          </Pressable>
        )}

        {!loading && role && (
          <EntranceView>
            <View style={[styles.summaryPanel, role === 'teacher' && styles.summaryPanelTeacher]}>
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryEyebrow}>{role === 'teacher' ? 'YOUR EVENTS' : 'YOUR CHECK-INS'}</Text>
                <Text style={styles.summaryTitle}>{role === 'teacher' ? 'A live record of your classes.' : 'Every day you showed up.'}</Text>
                <Text style={styles.summaryCaption}>{role === 'teacher' ? 'Attendance, all in one place.' : 'Your campus story, one scan at a time.'}</Text>
              </View>
              <View style={styles.summaryNumbers}>
                <View style={styles.summaryNumberBlock}>
                  <Text style={styles.summaryNumber}>{role === 'teacher' ? teacherEvents.length : studentRecords.length}</Text>
                  <Text style={styles.summaryNumberLabel}>{role === 'teacher' ? 'events' : 'check-ins'}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryNumberBlock}>
                  <Text style={styles.summaryNumber}>{role === 'teacher' ? teacherScanCount : lateCount}</Text>
                  <Text style={styles.summaryNumberLabel}>{role === 'teacher' ? 'scans' : 'late'}</Text>
                </View>
              </View>
              <View style={styles.summaryDecoration}><Ionicons name={role === 'teacher' ? 'calendar-clear-outline' : 'checkmark-done-outline'} size={21} color="rgba(255,255,255,0.90)" /></View>
            </View>
          </EntranceView>
        )}

        {loading ? (
          <View style={styles.loadingState}><ActivityIndicator size="small" color={COLORS.primary} /><Text style={styles.loadingText}>Loading your records...</Text></View>
        ) : loadError ? (
          <EmptyState icon="alert-circle-outline">{loadError}</EmptyState>
        ) : role === 'teacher' ? (
          teacherEvents.length === 0 ? <EmptyState icon="calendar-outline">No events yet. Create an event from the Teacher tab.</EmptyState> : (
            <FlatList
              data={teacherEvents}
              keyExtractor={(item) => item.eventId}
              contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => (
                <EntranceView delay={Math.min(index * 55, 330)}>
                  <View style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={styles.eventIcon}><Ionicons name="calendar-outline" size={19} color={COLORS.champagne} /></View>
                      <View style={styles.eventCopy}><Text style={styles.eventTitle}>{item.title}</Text><Text style={styles.meta}>{item.eventCode}</Text></View>
                      <View style={styles.countBadge}><Text style={styles.countText}>{item.attendeeCount}</Text><Text style={styles.countLabel}>scans</Text></View>
                    </View>
                    {item.startTime && <Text style={styles.date}>{formatDate(item.startTime)}</Text>}
                    {item.attendees.length === 0 ? <Text style={styles.emptyInline}>No attendees yet.</Text> : (
                      <View style={styles.attendeeList}>
                        {item.attendees.map((attendee) => (
                          <View key={attendee.studentId} style={styles.attendeeRow}>
                            <View style={styles.personDot}><Ionicons name="person" size={12} color={COLORS.champagneDeep} /></View>
                            <Text style={styles.attendeeName}>{attendee.studentName || shortId(attendee.studentId)}</Text>
                            <Text style={styles.attendeeTime}>{formatDate(attendee.scannedAt)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </EntranceView>
              )}
            />
          )
        ) : (
          studentRecords.length === 0 ? <EmptyState icon={historyWasCleared ? 'eye-off-outline' : 'scan-outline'}>{historyWasCleared ? 'Your personal history is clear. Official attendance records and teacher reports remain unchanged.' : 'No attendance yet. Your completed QR check-ins will appear here.'}</EmptyState> : (
            <FlatList
              data={studentRecords}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => (
                <EntranceView delay={Math.min(index * 55, 330)}>
                  <View style={styles.studentTimelineRow}>
                    <View style={styles.dateRail}>
                      <Text style={styles.dateMonth}>{monthLabel(item.scannedAt)}</Text>
                      <Text style={styles.dateDay}>{dayLabel(item.scannedAt)}</Text>
                      <View style={styles.railLine} />
                    </View>
                    <View style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={[styles.eventIcon, item.status === 'late' ? styles.lateIcon : item.status === 'recovered' ? styles.recoveredIcon : styles.successIcon]}><Ionicons name={item.status === 'late' ? 'time' : item.status === 'recovered' ? 'refresh' : 'checkmark'} size={19} color={item.status === 'late' ? COLORS.warning : item.status === 'recovered' ? COLORS.primary : COLORS.success} /></View>
                      <View style={styles.eventCopy}><Text style={styles.eventTitle}>{item.eventTitle}</Text><Text style={styles.meta}>{item.eventId}</Text></View>
                      <View style={[styles.presentBadge, item.status === 'late' && styles.lateBadge, item.status === 'recovered' && styles.recoveredBadge]}><Text style={[styles.presentText, item.status === 'late' && styles.lateText, item.status === 'recovered' && styles.recoveredText]}>{item.status === 'late' ? 'Late' : item.status === 'recovered' ? 'Recovered' : 'Present'}</Text></View>
                    </View>
                    <Text style={styles.date}>{formatDate(item.scannedAt)}</Text>
                    {item.lateReason && <Text style={styles.reason}>Reason: {item.lateReason}</Text>}
                    </View>
                  </View>
                </EntranceView>
              )}
            />
          )
        )}
      </View>
      <Modal
        visible={confirmClear}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!clearingHistory) setConfirmClear(false); }}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityRole="alert" style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Ionicons name="eye-off-outline" size={23} color={COLORS.danger} /></View>
            <Text style={styles.confirmTitle}>Clear your history?</Text>
            <Text style={styles.confirmText}>This hides your attendance entries from your personal History view on this device. Official attendance records and teacher reports will not be changed.</Text>
            {clearError && <Text accessibilityRole="alert" style={styles.confirmError}>{clearError}</Text>}
            <View style={styles.confirmActions}>
              <Pressable accessibilityRole="button" disabled={clearingHistory} onPress={() => setConfirmClear(false)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={clearingHistory} onPress={handleClearHistory} style={[styles.confirmClearButton, clearingHistory && styles.clearHistoryDisabled]}>
                {clearingHistory ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.confirmClearText}>Clear History</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}
function monthLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
}
function dayLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : String(date.getDate()).padStart(2, '0');
}
function shortId(value: string | null | undefined) { if (!value) return 'Unknown student'; return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`; }
function EmptyState({ children, icon }: { children: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><Ionicons name={icon} size={23} color={COLORS.primary} /></View><Text style={styles.emptyTitle}>Nothing here yet</Text><Text style={styles.emptyText}>{children}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.lg },
  eyebrow: { ...TYPOGRAPHY.label, fontSize: 14, lineHeight: 20, fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.champagne },
  headerCopy: { flex: 1 },
  title: { ...TYPOGRAPHY.screenTitle, fontFamily: TYPOGRAPHY.displayFontFamily, color: COLORS.textPrimary, marginTop: 3 },
  headerIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.glassStrong, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.champagneBorder },
  clearHistoryButton: { alignSelf: 'flex-end', minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 15, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(201,79,101,0.35)', marginTop: -8, marginBottom: 13 },
  clearHistoryDisabled: { opacity: 0.45 },
  clearHistoryPressed: { transform: [{ scale: 0.97 }] },
  clearHistoryText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, color: COLORS.danger },
  summaryPanel: { minHeight: 176, borderRadius: 26, backgroundColor: COLORS.primary, padding: 17, marginBottom: 17, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryPanelTeacher: { backgroundColor: '#443EB4' },
  summaryCopy: { flex: 1, paddingRight: 7 },
  summaryEyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: '#FFFFFF', fontSize: 14, letterSpacing: 0.2 },
  summaryTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, color: '#FFFFFF', fontSize: 20, lineHeight: 27, marginTop: 7 },
  summaryCaption: { fontFamily: TYPOGRAPHY.fontFamily, color: '#FFFFFF', fontSize: 14, lineHeight: 20, marginTop: 5 },
  summaryNumbers: { minWidth: 96, minHeight: 112, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.42)', alignItems: 'center', justifyContent: 'center', gap: 5 },
  summaryNumberBlock: { alignItems: 'center' },
  summaryNumber: { fontFamily: TYPOGRAPHY.numberFontFamily, fontSize: 19, lineHeight: 22, color: '#FFFFFF' },
  summaryNumberLabel: { fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 14, color: '#FFFFFF' },
  summaryDivider: { width: 48, height: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  summaryDecoration: { position: 'absolute', right: 12, top: 11, width: 32, height: 32, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  loadingState: { alignItems: 'center', paddingVertical: SPACE.section },
  loadingText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 16, color: COLORS.textSecondary, marginTop: SPACE.sm },
  list: { paddingBottom: 116, flexGrow: 1 },
  studentTimelineRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: SPACE.sm },
  dateRail: { width: 43, alignItems: 'center', paddingTop: 15, marginRight: 8 },
  dateMonth: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 14, letterSpacing: 0.1, color: COLORS.primary },
  dateDay: { fontFamily: TYPOGRAPHY.numberFontFamily, fontSize: 16, color: COLORS.textPrimary, marginTop: 1 },
  railLine: { width: 1, flex: 1, minHeight: 18, backgroundColor: '#D8DFF0', marginTop: 5 },
  card: { flex: 1, backgroundColor: COLORS.glassStrong, borderRadius: 23, padding: 15, marginBottom: 0, borderWidth: 1, borderColor: COLORS.glassBorder, shadowColor: COLORS.shadow, shadowOpacity: 0.11, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  eventIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(217,185,138,0.12)', borderWidth: 1, borderColor: COLORS.champagneBorder, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  successIcon: { backgroundColor: 'rgba(61,220,151,0.14)' },
  lateIcon: { backgroundColor: 'rgba(255,194,75,0.14)' },
  recoveredIcon: { backgroundColor: COLORS.primaryTint },
  eventCopy: { flex: 1 },
  eventTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 16, color: COLORS.textPrimary },
  meta: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 21, color: COLORS.textSecondary, marginTop: 3 },
  countBadge: { minWidth: 58, height: 48, borderRadius: 24, backgroundColor: COLORS.champagneSoft, borderWidth: 1, borderColor: COLORS.champagneBorder, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: TYPOGRAPHY.numberFontFamily, fontSize: 16, color: COLORS.champagne },
  countLabel: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 14, color: COLORS.textPrimary },
  presentBadge: { paddingHorizontal: 10, minHeight: 38, borderRadius: RADIUS.pill, backgroundColor: 'rgba(61,220,151,0.14)', borderWidth: 1, borderColor: 'rgba(61,220,151,0.35)', alignItems: 'center', justifyContent: 'center' },
  presentText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 14, color: COLORS.success },
  lateBadge: { backgroundColor: 'rgba(255,194,75,0.14)', borderColor: 'rgba(255,194,75,0.28)' },
  recoveredBadge: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.glassBorder },
  lateText: { color: COLORS.warning },
  recoveredText: { color: COLORS.primarySoft },
  date: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 15, lineHeight: 22, color: COLORS.textSecondary, marginTop: 12 },
  reason: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 21, color: COLORS.textSecondary, marginTop: 5 },
  attendeeList: { marginTop: 13, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 5 },
  attendeeRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(127,143,255,0.10)' },
  personDot: { width: 27, height: 27, borderRadius: 10, backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.glassBorder, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  attendeeName: { flex: 1, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, lineHeight: 21, color: COLORS.textPrimary },
  attendeeTime: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, color: COLORS.textSecondary },
  emptyInline: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 15, color: COLORS.textSecondary, marginTop: 13 },
  emptyState: { backgroundColor: COLORS.glassStrong, borderRadius: RADIUS.xl, padding: SPACE.xl, alignItems: 'center', borderWidth: 1, borderColor: COLORS.glassBorder, marginTop: SPACE.sm },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.champagneSoft, borderWidth: 1, borderColor: COLORS.champagneBorder, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.md },
  emptyTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 20, color: COLORS.textPrimary },
  emptyText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 16, lineHeight: 24, color: COLORS.textSecondary, textAlign: 'center', marginTop: 6 },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.lg, backgroundColor: 'rgba(17,31,68,0.42)' },
  confirmCard: { width: '100%', maxWidth: 380, borderRadius: 26, padding: 22, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.glassBorder, alignItems: 'center' },
  confirmIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: 'rgba(201,79,101,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  confirmTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 19, color: COLORS.textPrimary, textAlign: 'center' },
  confirmText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 16, lineHeight: 24, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 },
  confirmError: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 15, lineHeight: 22, color: COLORS.danger, textAlign: 'center', marginTop: 12 },
  confirmActions: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelButton: { flex: 1, minHeight: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primaryTint },
  cancelButtonText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, color: COLORS.textPrimary },
  confirmClearButton: { flex: 1, minHeight: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.danger },
  confirmClearText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, color: '#FFFFFF' },
});
