import AmbientBackground from '@/components/AmbientBackground';
import { COLORS, SPACE } from '@/constants/colors';
import { TYPOGRAPHY } from '@/constants/typography';
import { useAuth } from '@/lib/auth';
import { checkAdministratorAccess } from '@/lib/admin';
import { getMyNotifications, markMyNotificationRead, type InAppNotification } from '@/lib/accessWorkflow';
import { getProfile } from '@/lib/profiles';
import { getRecoveryRequests, reviewAttendanceRecovery, type RecoveryRequest } from '@/lib/smartFeatures';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EntranceView from '@/components/EntranceView';

type ScreenState = 'loading' | 'ready' | 'denied' | 'error';

export default function NotificationsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyNotificationId, setBusyNotificationId] = useState<string | null>(null);
  const [teacherMode, setTeacherMode] = useState(false);
  const [recoveryRequests, setRecoveryRequests] = useState<RecoveryRequest[]>([]);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    setScreenState('loading');
    setNotifications([]);
    setRecoveryRequests([]);
    setTeacherMode(false);
    setError(null);
    if (!user) {
      setScreenState('denied');
      return;
    }
    try {
      const isAdministrator = await checkAdministratorAccess();
      if (isAdministrator) {
        setScreenState('denied');
        return;
      }
      const profile = await getProfile(user.id);
      if (!profile) {
        setScreenState('denied');
        return;
      }
      if (profile.role === 'teacher') {
        setTeacherMode(true);
        setRecoveryRequests(await getRecoveryRequests('teacher', user.id));
        setScreenState('ready');
        return;
      }
      setNotifications(await getMyNotifications());
      setScreenState('ready');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Notifications could not be loaded.');
      setScreenState('error');
    }
  }, [user]);

  const handleReviewRecovery = async (request: RecoveryRequest, decision: 'approved' | 'rejected') => {
    setBusyRequestId(request.id);
    setError(null);
    try {
      const result = await reviewAttendanceRecovery(request.id, decision);
      if (!result.success) {
        setError(result.message);
        return;
      }
      if (!user) throw new Error('Your session could not be verified. Please sign in again.');
      setRecoveryRequests(await getRecoveryRequests('teacher', user.id));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The recovery request could not be reviewed.');
    } finally {
      setBusyRequestId(null);
    }
  };

  useFocusEffect(useCallback(() => {
    void (async () => {
      await loadNotifications();
    })();
  }, [loadNotifications]));

  const handleMarkRead = async (notificationId: string) => {
    setBusyNotificationId(notificationId);
    setError(null);
    try {
      await markMyNotificationRead(notificationId);
      setNotifications((current) => current.map((notification) => (
        notification.id === notificationId
          ? { ...notification, read_at: new Date().toISOString() }
          : notification
      )));
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : 'The notification could not be updated.');
    } finally {
      setBusyNotificationId(null);
    }
  };

  return (
    <View style={styles.container}>
      <AmbientBackground graphicSide="right" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, SPACE.lg), paddingBottom: Math.max(insets.bottom, 16) + 112 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{teacherMode ? 'TEACHER WORKSPACE' : 'ACCOUNT UPDATES'}</Text>
            <Text style={styles.title}>{teacherMode ? 'Recovery Requests' : 'Notifications'}</Text>
            <Text style={styles.subtitle}>{teacherMode ? 'Review attendance requests for your events.' : 'Your latest SYNCRA account updates.'}</Text>
          </View>
          <View style={styles.headerIcon}><Ionicons name={teacherMode ? 'document-text-outline' : 'notifications-outline'} size={21} color={COLORS.primary} /></View>
        </View>

        {screenState === 'loading' ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.stateText}>{teacherMode ? 'Loading recovery requests...' : 'Loading your notifications...'}</Text>
          </View>
        ) : screenState === 'error' ? (
          <View style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={24} color={COLORS.danger} />
            <Text accessibilityRole="alert" style={styles.stateText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => { void loadNotifications(); }} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : screenState === 'denied' ? (
          <View style={styles.stateCard}>
            <Ionicons name="shield-outline" size={24} color={COLORS.textMuted} />
            <Text style={styles.stateText}>Notifications are not available for this account.</Text>
          </View>
        ) : teacherMode && recoveryRequests.length === 0 ? (
          <View style={styles.stateCard}>
            <View style={styles.emptyIcon}><Ionicons name="checkmark-done-outline" size={22} color={COLORS.primary} /></View>
            <Text style={styles.emptyTitle}>No requests to review</Text>
            <Text style={styles.stateText}>Attendance recovery requests for your events will appear here.</Text>
          </View>
        ) : teacherMode ? (
          <View style={styles.list}>
            {recoveryRequests.map((request, index) => (
              <EntranceView key={request.id} delay={Math.min(index * 55, 300)}>
              <View style={styles.notificationCard}>
                <View style={styles.notificationHeader}>
                  <View style={styles.notificationIcon}><Ionicons name="person-outline" size={17} color={COLORS.primary} /></View>
                  <View style={styles.notificationCopy}>
                    <Text style={styles.notificationTitle}>{request.studentName || 'Student'}</Text>
                    <Text style={styles.timestamp}>{request.eventTitle || request.eventCode || 'Event'} · {new Date(request.requestedAt).toLocaleString()}</Text>
                  </View>
                </View>
                <Text style={styles.body}>{request.reason}</Text>
                <Text style={styles.requestStatus}>{request.status.toUpperCase()}</Text>
                {request.reviewedAt && <Text style={styles.timestamp}>Reviewed {new Date(request.reviewedAt).toLocaleString()}{request.reviewNote ? ` · ${request.reviewNote}` : ''}</Text>}
                {request.status === 'pending' && (
                  <View style={styles.requestActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Reject recovery request from ${request.studentName || 'student'}`}
                      disabled={busyRequestId === request.id}
                      onPress={() => { void handleReviewRecovery(request, 'rejected'); }}
                      style={({ pressed }) => [styles.reviewButton, styles.rejectButton, busyRequestId === request.id && styles.disabledButton, pressed && styles.pressed]}
                    >
                      {busyRequestId === request.id ? <ActivityIndicator size="small" color={COLORS.danger} /> : <><Ionicons name="close" size={17} color={COLORS.danger} /><Text style={styles.rejectText}>Reject</Text></>}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Approve recovery request from ${request.studentName || 'student'}`}
                      disabled={busyRequestId === request.id}
                      onPress={() => { void handleReviewRecovery(request, 'approved'); }}
                      style={({ pressed }) => [styles.reviewButton, styles.approveButton, busyRequestId === request.id && styles.disabledButton, pressed && styles.pressed]}
                    >
                      {busyRequestId === request.id
                        ? <ActivityIndicator size="small" color={COLORS.success} />
                        : <><Ionicons name="checkmark" size={17} color={COLORS.success} /><Text style={styles.approveText}>Approve</Text></>}
                    </Pressable>
                  </View>
                )}
              </View>
              </EntranceView>
            ))}
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.stateCard}>
            <View style={styles.emptyIcon}><Ionicons name="notifications-off-outline" size={22} color={COLORS.primary} /></View>
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.stateText}>New account updates will appear here.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {notifications.map((notification, index) => (
              <EntranceView key={notification.id} delay={Math.min(index * 55, 300)}>
              <View style={styles.notificationCard}>
                <View style={styles.notificationHeader}>
                  <View style={styles.notificationIcon}>
                    <Ionicons name="notifications-outline" size={17} color={COLORS.primary} />
                  </View>
                  <View style={styles.notificationCopy}>
                    <Text style={styles.notificationTitle}>{notification.title}</Text>
                    <Text style={styles.timestamp}>{new Date(notification.created_at).toLocaleString()}</Text>
                  </View>
                  {!notification.read_at && <View accessibilityLabel="Unread" style={styles.unreadDot} />}
                </View>
                <Text style={styles.body}>{notification.body}</Text>
                {!notification.read_at && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyNotificationId === notification.id}
                    onPress={() => { void handleMarkRead(notification.id); }}
                    style={({ pressed }) => [styles.markReadButton, pressed && styles.pressed]}
                  >
                    {busyNotificationId === notification.id
                      ? <ActivityIndicator size="small" color={COLORS.primary} />
                      : <Text style={styles.markReadText}>Mark as read</Text>}
                  </Pressable>
                )}
              </View>
              </EntranceView>
            ))}
          </View>
        )}
        {error && screenState === 'ready' && <Text accessibilityRole="alert" style={styles.inlineError}>{error}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flexGrow: 1, paddingHorizontal: SPACE.lg, width: '100%', maxWidth: 620, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.lg },
  headerCopy: { flex: 1, paddingRight: 12 },
  eyebrow: { ...TYPOGRAPHY.label, fontSize: 12, fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.champagne },
  title: { ...TYPOGRAPHY.screenTitle, fontFamily: TYPOGRAPHY.displayFontFamily, color: COLORS.textPrimary, marginTop: 3 },
  subtitle: { fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 5 },
  headerIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.glassStrong, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.champagneBorder },
  stateCard: { minHeight: 150, padding: SPACE.lg, borderRadius: 24, backgroundColor: COLORS.glassStrong, borderWidth: 1, borderColor: COLORS.glassBorder, alignItems: 'center', justifyContent: 'center', gap: 11 },
  stateText: { maxWidth: 400, textAlign: 'center', fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 21, color: COLORS.textSecondary },
  retryButton: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 14, backgroundColor: COLORS.primaryTint },
  retryText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 13 },
  emptyIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, color: COLORS.textPrimary, fontSize: 17 },
  list: { gap: 11 },
  notificationCard: { padding: SPACE.lg, borderRadius: 22, backgroundColor: COLORS.glassStrong, borderWidth: 1, borderColor: COLORS.glassBorder, shadowColor: COLORS.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  notificationHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notificationIcon: { width: 36, height: 36, borderRadius: 13, backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center' },
  notificationCopy: { flex: 1 },
  notificationTitle: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  timestamp: { fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.primary },
  body: { fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 13 },
  markReadButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginTop: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: COLORS.primaryTint },
  markReadText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 12 },
  requestStatus: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.textSecondary, fontSize: 11, letterSpacing: 0.5, marginTop: 10 },
  requestActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  reviewButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1 },
  rejectButton: { backgroundColor: 'rgba(201,79,101,0.10)', borderColor: 'rgba(201,79,101,0.24)' },
  approveButton: { backgroundColor: 'rgba(37,136,117,0.10)', borderColor: 'rgba(37,136,117,0.24)' },
  rejectText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.danger, fontSize: 12 },
  approveText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.success, fontSize: 12 },
  disabledButton: { opacity: 0.55 },
  inlineError: { marginTop: 10, fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.danger, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
