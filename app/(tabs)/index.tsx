import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import AmbientBackground from '@/components/AmbientBackground';
import EntranceView from '@/components/EntranceView';
import { useAuth } from '@/lib/auth';
import { getProfile } from '@/lib/profiles';
import { getEventsByTeacher, type CloudEvent } from '@/lib/events';
import { getTeacherProfileOverview, type TeacherProfileOverview } from '@/lib/attendance';
import { getRecoveryRequests } from '@/lib/smartFeatures';
import { COLORS, RADIUS } from '@/constants/colors';
import { TEACHER_COLORS } from '@/constants/teacherTheme';
import { TYPOGRAPHY } from '@/constants/typography';
import { checkAdministratorAccess, type AdminSection } from '@/lib/admin';

export default function Index() {
  const { user, session, loading: authLoading } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabContentBottom = Math.max(126, Math.max(insets.bottom, 8) + 110);
  const entrance = useRef(new Animated.Value(0)).current;
  const scanPulse = useRef(new Animated.Value(0)).current;
  const scanLine = useRef(new Animated.Value(0)).current;
  const scanScale = useRef(new Animated.Value(1)).current;
  const accessCheckId = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [homeAccess, setHomeAccess] = useState<'checking' | 'administrator' | 'teacher' | 'standard' | 'error'>('checking');
  const [accessError, setAccessError] = useState<string | null>(null);

  const metadataName = user?.user_metadata?.full_name;
  const firstName = typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim().split(/\s+/)[0]
    : null;
  const avatarInitial = firstName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'G';

  const verifyHomeAccess = useCallback(async () => {
    const checkId = ++accessCheckId.current;
    setHomeAccess('checking');
    setAccessError(null);
    if (authLoading) return;
    if (!session) {
      setHomeAccess('standard');
      return;
    }
    try {
      const isAdministrator = await checkAdministratorAccess();
      if (isAdministrator) {
        if (accessCheckId.current === checkId) setHomeAccess('administrator');
        return;
      }
      const profile = await getProfile(session.user.id);
      if (!profile) throw new Error('Your profile could not be found.');
      if (accessCheckId.current === checkId) setHomeAccess(profile.role === 'teacher' ? 'teacher' : 'standard');
    } catch (error) {
      if (accessCheckId.current !== checkId) return;
      setHomeAccess('error');
      setAccessError(error instanceof Error ? error.message : 'Account access could not be verified.');
    }
  }, [authLoading, session]);

  useFocusEffect(useCallback(() => {
    void verifyHomeAccess();
    return () => { accessCheckId.current += 1; };
  }, [verifyHomeAccess]));

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (mounted) setReduceMotion(reduced);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      scanPulse.setValue(1);
      scanLine.setValue(0.5);
      return;
    }
    Animated.spring(entrance, { toValue: 1, tension: 48, friction: 9, useNativeDriver: true }).start();
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(scanPulse, { toValue: 1, duration: 1700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(scanPulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    const line = Animated.loop(Animated.sequence([
      Animated.timing(scanLine, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(scanLine, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    pulse.start();
    line.start();
    return () => {
      pulse.stop();
      line.stop();
      entrance.stopAnimation();
    };
  }, [entrance, reduceMotion, scanLine, scanPulse]);

  const openScanner = () => {
    Animated.sequence([
      Animated.spring(scanScale, { toValue: 0.94, friction: 5, tension: 220, useNativeDriver: true }),
      Animated.spring(scanScale, { toValue: 1, friction: 5, tension: 180, useNativeDriver: true }),
    ]).start();
    router.push('/scan');
  };

  const entranceY = entrance.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const pulseScale = scanPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const pulseOpacity = scanPulse.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 0.22, 0] });
  const lineY = scanLine.interpolate({ inputRange: [0, 1], outputRange: [-28, 28] });

  if (homeAccess === 'checking' || homeAccess === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <AmbientBackground graphicSide="right" />
        <View style={styles.accessState}>
          {homeAccess === 'checking' ? (
            <>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.accessStateText}>Verifying account access...</Text>
            </>
          ) : (
            <>
              <Ionicons name="shield-outline" size={28} color={COLORS.danger} />
              <Text accessibilityRole="alert" style={styles.accessStateText}>{accessError}</Text>
              <Pressable accessibilityRole="button" onPress={() => { void verifyHomeAccess(); }} style={styles.accessRetry}>
                <Text style={styles.accessRetryText}>Retry verification</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (homeAccess === 'administrator') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <AmbientBackground graphicSide="right" />
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabContentBottom }]} showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.topBar}>
              <View style={styles.greeting}>
                <Text style={styles.eyebrow}>SYNCRA · ADMINISTRATION</Text>
                <Text style={styles.greetingTitle}>{firstName ? `Welcome, ${firstName}` : 'Welcome, Administrator'}</Text>
                <Text style={styles.greetingDate}>Your campus at a glance</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Open administrator profile" onPress={() => router.push('/profile')} style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
                <Text style={styles.avatarText}>{avatarInitial}</Text>
                <View style={styles.avatarStatus} />
              </Pressable>
            </View>

            <View style={styles.adminWelcomeCard}>
              <View style={styles.adminWelcomeIcon}><Ionicons name="shield-checkmark-outline" size={21} color="#FFFFFF" /></View>
              <Text style={styles.adminWelcomeEyebrow}>ADMIN ACCESS VERIFIED</Text>
              <Text style={styles.adminWelcomeTitle}>Manage your campus with confidence.</Text>
              <Text style={styles.adminWelcomeText}>Review people, events, attendance, and administrative activity from one place.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/admin')} style={({ pressed }) => [styles.adminConsoleButton, pressed && styles.actionPressed]}>
                <Text style={styles.adminConsoleButtonText}>Open Admin Console</Text>
                <Ionicons name="arrow-forward" size={17} color={COLORS.primary} />
              </Pressable>
            </View>

            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>ADMIN WORKSPACE</Text>
                <Text style={styles.sectionTitle}>Management shortcuts</Text>
              </View>
              <Ionicons name="grid-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={[styles.adminShortcutGrid, width < 360 && styles.adminShortcutGridNarrow]}>
              {ADMIN_HOME_SHORTCUTS.map((shortcut) => (
                <Pressable
                  key={shortcut.section}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/(tabs)/admin', params: { section: shortcut.section } })}
                  style={({ pressed }) => [styles.adminShortcut, pressed && styles.pressed]}
                >
                  <View style={[styles.adminShortcutIcon, { backgroundColor: shortcut.tint }]}>
                    <Ionicons name={shortcut.icon} size={19} color={shortcut.color} />
                  </View>
                  <Text style={styles.adminShortcutTitle}>{shortcut.title}</Text>
                  <Text style={styles.adminShortcutSubtitle}>{shortcut.subtitle}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (homeAccess === 'teacher') {
    return <TeacherHomeDashboard userId={session?.user.id ?? ''} firstName={firstName} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AmbientBackground graphicSide="right" />
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabContentBottom }]}
        style={{ opacity: entrance, transform: [{ translateY: entranceY }] }}
      >
        <View style={styles.content}>
          <EntranceView>
            <View style={styles.topBar}>
              <View style={styles.greeting}>
                <Text style={styles.eyebrow}>SYNCRA · CCTC ATTENDANCE</Text>
                <Text style={styles.greetingTitle}>{firstName ? `Hi, ${firstName}` : 'Welcome back'}</Text>
                <Text style={styles.greetingDate}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => router.push('/profile')} style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
                <Text style={styles.avatarText}>{avatarInitial}</Text>
                <View style={styles.avatarStatus} />
              </Pressable>
            </View>
          </EntranceView>

          <EntranceView delay={70}>
            <View style={styles.hero}>
              <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
                <Defs>
                  <LinearGradient id="homeHeroGradient" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor="#315FE8" />
                    <Stop offset="55%" stopColor="#3965DD" />
                    <Stop offset="100%" stopColor="#675ED5" />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" rx="30" fill="url(#homeHeroGradient)" />
                <Circle cx="100%" cy="8%" r="100" fill="#FFFFFF" fillOpacity="0.08" />
                <Circle cx="97%" cy="100%" r="130" fill="#A6B9FF" fillOpacity="0.15" />
                <Circle cx="-2%" cy="100%" r="70" fill="#67D2C8" fillOpacity="0.20" />
              </Svg>
              <View style={styles.heroCopy}>
                <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>YOUR DAY, IN SYNC</Text></View>
                <Text style={styles.heroTitle}>Show up.{'\n'}We’ll handle the rest.</Text>
                <Text style={styles.heroSubtitle}>Check in to class with a quick scan and keep your attendance together.</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Open QR scanner" onPress={openScanner} style={({ pressed }) => [styles.primaryAction, pressed && styles.actionPressed]}>
                  <Ionicons name="scan-outline" size={19} color={COLORS.primary} />
                  <Text style={styles.primaryActionText}>Scan to check in</Text>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.primary} />
                </Pressable>
              </View>
              <Animated.View pointerEvents="none" style={[styles.qrHalo, { opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]} />
              <Animated.View pointerEvents="none" style={[styles.qrOrbit, { transform: [{ scale: scanScale }, { rotate: '8deg' }] }]}>
                <View style={styles.qrTile}>
                  <View style={[styles.qrCorner, styles.qrTL]} />
                  <View style={[styles.qrCorner, styles.qrTR]} />
                  <View style={[styles.qrCorner, styles.qrBL]} />
                  <View style={[styles.qrCorner, styles.qrBR]} />
                  <Ionicons name="qr-code" size={43} color="#FFFFFF" />
                  <Animated.View style={[styles.scanLine, { transform: [{ translateY: lineY }] }]} />
                </View>
              </Animated.View>
              <View style={styles.qrFloatingBadge}><Ionicons name="checkmark" size={13} color={COLORS.primary} /></View>
              <View style={styles.heroSparkle}><Ionicons name="sparkles" size={14} color="#FFFFFF" /></View>
            </View>
          </EntranceView>

          <EntranceView delay={140}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionEyebrow}>KEEP THINGS MOVING</Text>
                <Text style={styles.sectionTitle}>Your campus shortcuts</Text>
              </View>
              <Ionicons name="arrow-down" size={17} color={COLORS.primary} />
            </View>
            <View style={styles.shortcutRow}>
              <Pressable accessibilityRole="button" onPress={() => router.push('/history')} style={({ pressed }) => [styles.historyShortcut, pressed && styles.pressed]}>
                <View style={styles.shortcutTop}><View style={styles.shortcutIconBlue}><Ionicons name="time-outline" size={20} color={COLORS.primary} /></View><Ionicons name="arrow-forward" size={17} color={COLORS.primary} /></View>
                <Text style={styles.shortcutTitle}>Attendance</Text>
                <Text style={styles.shortcutSubtitle}>See your check-in history</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={({ pressed }) => [styles.profileShortcut, pressed && styles.pressed]}>
                <View style={styles.shortcutTop}><View style={styles.shortcutIconViolet}><Ionicons name="person-outline" size={20} color="#6D62C9" /></View><Ionicons name="arrow-forward" size={17} color="#6D62C9" /></View>
                <Text style={styles.shortcutTitle}>Your account</Text>
                <Text style={styles.shortcutSubtitle}>Keep your details up to date</Text>
              </Pressable>
            </View>
          </EntranceView>

          <EntranceView delay={210}>
            <View style={styles.tipStrip}>
              <View style={styles.tipIcon}><Ionicons name="bulb-outline" size={18} color="#258B84" /></View>
              <View style={styles.tipCopy}><Text style={styles.tipTitle}>A little scan tip</Text><Text style={styles.tipText}>Hold your camera steady and keep the QR inside the frame.</Text></View>
              <View style={styles.tipArrow}><Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} /></View>
            </View>
          </EntranceView>
        </View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

type TeacherDashboardData = {
  events: CloudEvent[];
  overview: TeacherProfileOverview;
  pendingRequests: number;
};

function TeacherHomeDashboard({ userId, firstName }: { userId: string; firstName: string | null }) {
  const insets = useSafeAreaInsets();
  const dashboardRequestId = useRef(0);
  const [data, setData] = useState<TeacherDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    const requestId = ++dashboardRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const [events, overview, requests] = await Promise.all([
        getEventsByTeacher(userId),
        getTeacherProfileOverview(userId),
        getRecoveryRequests('teacher', userId),
      ]);
      if (dashboardRequestId.current !== requestId) return;
      setData({
        events,
        overview,
        pendingRequests: requests.filter((request) => request.status === 'pending').length,
      });
    } catch (loadError) {
      if (dashboardRequestId.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : 'Teacher dashboard data could not be loaded.');
      }
    } finally {
      if (dashboardRequestId.current === requestId) setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    void loadDashboard();
    return () => { dashboardRequestId.current += 1; };
  }, [loadDashboard]));

  const now = new Date();
  const todayEvents = (data?.events ?? []).filter((event) => {
    if (!event.start_time) return false;
    const start = new Date(event.start_time);
    return start.getFullYear() === now.getFullYear()
      && start.getMonth() === now.getMonth()
      && start.getDate() === now.getDate();
  });
  const activeEvents = (data?.events ?? []).filter((event) => event.event_status !== 'closed').length;
  const closedEvents = (data?.events ?? []).filter((event) => event.event_status === 'closed').length;
  const upcomingEvents = (data?.events ?? [])
    .filter((event): event is CloudEvent & { start_time: string } => (
      event.event_status !== 'closed'
      && typeof event.start_time === 'string'
      && (
        new Date(event.start_time) >= now
        || (
          new Date(event.start_time).getFullYear() === now.getFullYear()
          && new Date(event.start_time).getMonth() === now.getMonth()
          && new Date(event.start_time).getDate() === now.getDate()
        )
      )
    ))
    .sort((first, second) => new Date(first.start_time).getTime() - new Date(second.start_time).getTime())
    .slice(0, 3);
  const shortcuts = [
    { title: 'Create event', caption: 'Set up a class session', icon: 'add-circle-outline' as const, route: '/teacher' },
    { title: 'Manage events', caption: `${activeEvents} active`, icon: 'calendar-outline' as const, route: '/teacher' },
    { title: 'Attendance', caption: `${data?.overview.scanCount ?? 0} recorded check-ins`, icon: 'people-outline' as const, route: '/history' },
    { title: 'Recovery requests', caption: `${data?.pendingRequests ?? 0} pending review`, icon: 'document-text-outline' as const, route: '/notifications' },
  ];

  return (
    <SafeAreaView style={styles.teacherHomeContainer} edges={['top']}>
      <AmbientBackground graphicSide="right" />
      <ScrollView contentContainerStyle={[styles.teacherHomeContent, { paddingBottom: Math.max(132, Math.max(insets.bottom, 8) + 110) }]} showsVerticalScrollIndicator={false}>
        <View style={styles.teacherHomeHeader}>
          <View style={styles.teacherHomeHeaderCopy}>
            <Text style={styles.teacherHomeEyebrow}>SYNCRA · TEACHER WORKSPACE</Text>
            <Text style={styles.teacherHomeTitle}>{firstName ? `Welcome, ${firstName}` : 'Welcome back'}</Text>
            <Text style={styles.teacherHomeSubtitle}>Your classes and attendance, in sync.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open teacher profile" onPress={() => router.push('/profile')} style={styles.teacherHomeAvatar}>
            <Ionicons name="school-outline" size={22} color={TEACHER_COLORS.primary} />
          </Pressable>
        </View>

        <View style={styles.teacherHomeHero}>
          <View style={styles.teacherHomeHeroIcon}><Ionicons name="sparkles-outline" size={20} color={TEACHER_COLORS.primary} /></View>
          <Text style={styles.teacherHomeHeroLabel}>TODAY AT A GLANCE</Text>
          <Text style={styles.teacherHomeHeroTitle}>
            {todayEvents.length ? `${todayEvents.length} event${todayEvents.length === 1 ? '' : 's'} scheduled today` : 'Ready for your next class?'}
          </Text>
          <Text style={styles.teacherHomeHeroText}>Manage your events, follow attendance, and review student requests from your workspace.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/teacher')} style={({ pressed }) => [styles.teacherHomePrimaryButton, pressed && styles.pressed]}>
            <Text style={styles.teacherHomePrimaryText}>Open Events</Text>
            <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.teacherHomeState}>
            <ActivityIndicator color={TEACHER_COLORS.primary} />
            <Text style={styles.teacherHomeStateText}>Loading your teaching activity...</Text>
          </View>
        ) : error ? (
          <View style={styles.teacherHomeState}>
            <Ionicons name="alert-circle-outline" size={22} color={COLORS.danger} />
            <Text accessibilityRole="alert" style={styles.teacherHomeStateText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => { void loadDashboard(); }} style={styles.teacherHomeRetry}>
              <Text style={styles.teacherHomeRetryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.teacherHomeMetrics}>
              <TeacherMetric label="Active events" value={String(activeEvents)} icon="radio-button-on-outline" />
              <TeacherMetric label="Closed events" value={String(closedEvents)} icon="lock-closed-outline" />
              <TeacherMetric label="Attendance" value={String(data?.overview.scanCount ?? 0)} icon="people-outline" />
              <TeacherMetric label="To review" value={String(data?.pendingRequests ?? 0)} icon="document-text-outline" />
            </View>

            <View style={styles.teacherHomeSectionHeading}>
              <View><Text style={styles.teacherHomeSectionEyebrow}>UP NEXT</Text><Text style={styles.teacherHomeSectionTitle}>Teaching schedule</Text></View>
              <Pressable accessibilityRole="button" onPress={() => router.push('/teacher')}><Text style={styles.teacherHomeSeeAll}>All events</Text></Pressable>
            </View>
            <View style={styles.teacherHomeCard}>
              {upcomingEvents.length ? upcomingEvents.map((event, index) => (
                <View key={event.id} style={[styles.teacherHomeEvent, index > 0 && styles.teacherHomeEventDivider]}>
                  <View style={styles.teacherHomeEventIcon}><Ionicons name="calendar-outline" size={17} color={TEACHER_COLORS.primary} /></View>
                  <View style={styles.teacherHomeEventCopy}>
                    <Text style={styles.teacherHomeEventTitle}>{event.title}</Text>
                    <Text style={styles.teacherHomeEventMeta}>{event.start_time ? new Date(event.start_time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'} · {event.venue || 'Venue unavailable'}</Text>
                  </View>
                  <View style={styles.teacherHomeBadge}><Text style={styles.teacherHomeBadgeText}>Upcoming</Text></View>
                </View>
              )) : (
                <View style={styles.teacherHomeEmpty}>
                  <Ionicons name="calendar-clear-outline" size={21} color={TEACHER_COLORS.textMuted} />
                  <Text style={styles.teacherHomeEmptyText}>No upcoming events. Create one when you’re ready.</Text>
                </View>
              )}
            </View>

            <View style={styles.teacherHomeSectionHeading}>
              <View><Text style={styles.teacherHomeSectionEyebrow}>QUICK ACCESS</Text><Text style={styles.teacherHomeSectionTitle}>Your workspace</Text></View>
            </View>
            <View style={styles.teacherHomeShortcuts}>
              {shortcuts.map((shortcut) => (
                <Pressable key={shortcut.title} accessibilityRole="button" onPress={() => router.push(shortcut.route)} style={({ pressed }) => [styles.teacherHomeShortcut, pressed && styles.pressed]}>
                  <View style={styles.teacherHomeShortcutIcon}><Ionicons name={shortcut.icon} size={19} color={TEACHER_COLORS.primary} /></View>
                  <Text style={styles.teacherHomeShortcutTitle}>{shortcut.title}</Text>
                  <Text style={styles.teacherHomeShortcutCaption}>{shortcut.caption}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TeacherMetric({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.teacherHomeMetric}>
      <Ionicons name={icon} size={17} color={TEACHER_COLORS.cyan} />
      <Text style={styles.teacherHomeMetricValue}>{value}</Text>
      <Text style={styles.teacherHomeMetricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  accessState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  accessStateText: { maxWidth: 420, textAlign: 'center', fontFamily: TYPOGRAPHY.mediumFontFamily, color: COLORS.textSecondary, fontSize: 14, lineHeight: 21 },
  accessRetry: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 14, backgroundColor: COLORS.primaryTint },
  accessRetryText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 13 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 126 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  topBar: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  greeting: { flex: 1 },
  eyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 8, letterSpacing: 1.05 },
  greetingTitle: { fontFamily: TYPOGRAPHY.displayFontFamily, color: COLORS.textPrimary, fontSize: 24, lineHeight: 29, letterSpacing: -0.5, marginTop: 2 },
  greetingDate: { fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.textSecondary, fontSize: 10, marginTop: 1 },
  avatar: { width: 46, height: 46, borderRadius: 17, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.glassBorder, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.shadow, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  avatarText: { fontFamily: TYPOGRAPHY.displayFontFamily, color: COLORS.primary, fontSize: 17 },
  avatarStatus: { position: 'absolute', top: 1, right: 1, width: 9, height: 9, borderRadius: 5, backgroundColor: '#55C2A7', borderWidth: 2, borderColor: '#FFFFFF' },
  hero: { minHeight: 310, borderRadius: 30, padding: 20, justifyContent: 'center', overflow: 'hidden', backgroundColor: COLORS.primary, shadowColor: COLORS.primary, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  heroCopy: { width: '72%', zIndex: 1 },
  livePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', height: 25, paddingHorizontal: 9, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#78E1C5', marginRight: 6 },
  liveText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: '#FFFFFF', fontSize: 7, letterSpacing: 0.7 },
  heroTitle: { fontFamily: TYPOGRAPHY.displayFontFamily, color: '#FFFFFF', fontSize: 26, lineHeight: 30, letterSpacing: -0.65, marginTop: 12 },
  heroSubtitle: { fontFamily: TYPOGRAPHY.fontFamily, color: 'rgba(255,255,255,0.80)', fontSize: 10, lineHeight: 15, maxWidth: 220, marginTop: 8 },
  primaryAction: { alignSelf: 'flex-start', minHeight: 46, paddingHorizontal: 13, marginTop: 14, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#173989', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  primaryActionText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 11 },
  actionPressed: { transform: [{ scale: 0.97 }] },
  qrOrbit: { position: 'absolute', right: -18, top: 69, width: 144, height: 144, borderRadius: 54, alignItems: 'center', justifyContent: 'center' },
  qrHalo: { position: 'absolute', right: -6, top: 81, width: 122, height: 122, borderRadius: 45, borderWidth: 1, borderColor: 'rgba(255,255,255,0.64)' },
  qrTile: { width: 102, height: 102, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.17)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.36)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  qrCorner: { position: 'absolute', width: 19, height: 19, borderColor: '#FFFFFF' },
  qrTL: { top: 12, left: 12, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 6 },
  qrTR: { top: 12, right: 12, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 6 },
  qrBL: { bottom: 12, left: 12, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 6 },
  qrBR: { bottom: 12, right: 12, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 6 },
  scanLine: { position: 'absolute', left: 13, right: 13, height: 2, borderRadius: 2, backgroundColor: '#8BFFF1', shadowColor: '#8BFFF1', shadowOpacity: 0.8, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  qrFloatingBadge: { position: 'absolute', right: 16, top: 54, width: 29, height: 29, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '8deg' }] },
  heroSparkle: { position: 'absolute', right: 103, bottom: 37, width: 27, height: 27, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 11 },
  sectionEyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 8, letterSpacing: 0.9 },
  sectionTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, color: COLORS.textPrimary, fontSize: 16, marginTop: 2 },
  shortcutRow: { flexDirection: 'row', gap: 10 },
  historyShortcut: { flex: 1, minHeight: 120, borderRadius: 22, padding: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.glassBorder, shadowColor: COLORS.shadow, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  profileShortcut: { flex: 1, minHeight: 120, borderRadius: 22, padding: 14, backgroundColor: '#E7EAFE', borderWidth: 1, borderColor: '#DCE1FA' },
  shortcutTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  shortcutIconBlue: { width: 35, height: 35, borderRadius: 13, backgroundColor: '#EAF0FF', alignItems: 'center', justifyContent: 'center' },
  shortcutIconViolet: { width: 35, height: 35, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shortcutTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, color: COLORS.textPrimary, fontSize: 13 },
  shortcutSubtitle: { fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.textSecondary, fontSize: 9, marginTop: 3 },
  tipStrip: { minHeight: 72, marginTop: 13, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 20, backgroundColor: '#E4F3F2', borderWidth: 1, borderColor: '#D5ECEA', flexDirection: 'row', alignItems: 'center' },
  tipIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tipCopy: { flex: 1 },
  tipTitle: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 10, color: COLORS.textPrimary },
  tipText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 9, lineHeight: 13, color: COLORS.textSecondary, marginTop: 2 },
  tipArrow: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  adminWelcomeCard: { padding: 20, borderRadius: 26, backgroundColor: '#211A35', borderWidth: 1, borderColor: '#3A2C5A', shadowColor: '#46317C', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  adminWelcomeIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#7650D8', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  adminWelcomeEyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: '#B99CFF', fontSize: 9, letterSpacing: 1.05 },
  adminWelcomeTitle: { fontFamily: TYPOGRAPHY.displayFontFamily, color: '#F7F4FF', fontSize: 24, lineHeight: 29, letterSpacing: -0.45, marginTop: 7 },
  adminWelcomeText: { fontFamily: TYPOGRAPHY.fontFamily, color: '#C4BCD5', fontSize: 13, lineHeight: 19, marginTop: 8 },
  adminConsoleButton: { alignSelf: 'flex-start', minHeight: 44, marginTop: 17, paddingHorizontal: 14, borderRadius: 15, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10 },
  adminConsoleButtonText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 12 },
  adminShortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  adminShortcutGridNarrow: { flexDirection: 'column' },
  adminShortcut: { flexBasis: '48%', flexGrow: 1, minHeight: 116, padding: 14, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.glassBorder, shadowColor: COLORS.shadow, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  adminShortcutIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  adminShortcutTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, color: COLORS.textPrimary, fontSize: 13 },
  adminShortcutSubtitle: { fontFamily: TYPOGRAPHY.fontFamily, color: COLORS.textSecondary, fontSize: 10, lineHeight: 14, marginTop: 3 },
  pressed: { transform: [{ scale: 0.98 }] },
  teacherHomeContainer: { flex: 1, backgroundColor: TEACHER_COLORS.background },
  teacherHomeContent: { flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 132 },
  teacherHomeHeader: { minHeight: 74, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  teacherHomeHeaderCopy: { flex: 1, paddingRight: 12 },
  teacherHomeEyebrow: { color: TEACHER_COLORS.primary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 10, letterSpacing: 1.1 },
  teacherHomeTitle: { color: TEACHER_COLORS.textPrimary, fontFamily: TYPOGRAPHY.displayFontFamily, fontSize: 26, lineHeight: 32, marginTop: 4 },
  teacherHomeSubtitle: { color: TEACHER_COLORS.textSecondary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, marginTop: 4 },
  teacherHomeAvatar: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: TEACHER_COLORS.primaryTint, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder },
  teacherHomeHero: { padding: 20, borderRadius: 24, backgroundColor: TEACHER_COLORS.cardRaised, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder, overflow: 'hidden', shadowColor: TEACHER_COLORS.primary, shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  teacherHomeHeroIcon: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: TEACHER_COLORS.cyanSoft, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder, marginBottom: 15 },
  teacherHomeHeroLabel: { color: TEACHER_COLORS.primary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 10, letterSpacing: 1.1 },
  teacherHomeHeroTitle: { color: TEACHER_COLORS.textPrimary, fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 23, lineHeight: 29, marginTop: 6 },
  teacherHomeHeroText: { color: TEACHER_COLORS.textSecondary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, lineHeight: 20, marginTop: 7, maxWidth: 520 },
  teacherHomePrimaryButton: { minHeight: 48, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, marginTop: 16, borderRadius: 14, backgroundColor: TEACHER_COLORS.primary, borderWidth: 1, borderColor: TEACHER_COLORS.primarySoft, shadowColor: TEACHER_COLORS.primary, shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  teacherHomePrimaryText: { color: '#FFFFFF', fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 13 },
  teacherHomeState: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18, marginTop: 16, borderRadius: 24, backgroundColor: TEACHER_COLORS.glassStrong, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder },
  teacherHomeStateText: { color: TEACHER_COLORS.textSecondary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  teacherHomeRetry: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: 12, backgroundColor: TEACHER_COLORS.primaryTint, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder },
  teacherHomeRetryText: { color: TEACHER_COLORS.primary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 12 },
  teacherHomeMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14 },
  teacherHomeMetric: { width: '48%', flexGrow: 1, minHeight: 94, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 24, backgroundColor: TEACHER_COLORS.cyanSoft, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder },
  teacherHomeMetricValue: { color: TEACHER_COLORS.textPrimary, fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 23, marginTop: 7 },
  teacherHomeMetricLabel: { color: TEACHER_COLORS.textSecondary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, lineHeight: 15, marginTop: 1 },
  teacherHomeSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 23, marginBottom: 10 },
  teacherHomeSectionEyebrow: { color: TEACHER_COLORS.primary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 10, letterSpacing: 1.1 },
  teacherHomeSectionTitle: { color: TEACHER_COLORS.textPrimary, fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 18, marginTop: 3 },
  teacherHomeSeeAll: { color: TEACHER_COLORS.primary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 12 },
  teacherHomeCard: { paddingHorizontal: 14, borderRadius: 24, backgroundColor: TEACHER_COLORS.glassStrong, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder },
  teacherHomeEvent: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  teacherHomeEventDivider: { borderTopWidth: 1, borderTopColor: TEACHER_COLORS.border },
  teacherHomeEventIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: TEACHER_COLORS.primaryTint, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder },
  teacherHomeEventCopy: { flex: 1 },
  teacherHomeEventTitle: { color: TEACHER_COLORS.textPrimary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 13, lineHeight: 18 },
  teacherHomeEventMeta: { color: TEACHER_COLORS.textSecondary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, lineHeight: 16, marginTop: 3 },
  teacherHomeBadge: { minHeight: 24, paddingHorizontal: 9, borderRadius: RADIUS.pill, backgroundColor: TEACHER_COLORS.primaryTint, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder, alignItems: 'center', justifyContent: 'center' },
  teacherHomeBadgeText: { color: TEACHER_COLORS.primary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 11, letterSpacing: 0.15 },
  teacherHomeEmpty: { minHeight: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 13 },
  teacherHomeEmptyText: { flex: 1, color: TEACHER_COLORS.textSecondary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 12, lineHeight: 18 },
  teacherHomeShortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  teacherHomeShortcut: { width: '48%', minHeight: 120, padding: 13, borderRadius: 24, backgroundColor: TEACHER_COLORS.glassStrong, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder },
  teacherHomeShortcutIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: TEACHER_COLORS.cyanSoft, borderWidth: 1, borderColor: TEACHER_COLORS.glassBorder, marginBottom: 8 },
  teacherHomeShortcutTitle: { color: TEACHER_COLORS.textPrimary, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 13, lineHeight: 18 },
  teacherHomeShortcutCaption: { color: TEACHER_COLORS.textSecondary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, lineHeight: 16, marginTop: 3 },
});

const ADMIN_HOME_SHORTCUTS: {
  section: AdminSection;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  tint: string;
}[] = [
  { section: 'overview', title: 'Overview', subtitle: 'Campus summary and activity', icon: 'grid-outline', color: '#7055C7', tint: '#F0ECFF' },
  { section: 'users', title: 'Users', subtitle: 'Review student and teacher accounts', icon: 'people-outline', color: '#267FA0', tint: '#E7F7FC' },
  { section: 'teacherRequests', title: 'Teacher Requests', subtitle: 'Review access requests', icon: 'school-outline', color: '#C07A24', tint: '#FFF4E4' },
  { section: 'events', title: 'Events', subtitle: 'Manage campus events', icon: 'calendar-outline', color: '#398D70', tint: '#E9F8F1' },
  { section: 'attendance', title: 'Attendance', subtitle: 'Review attendance records', icon: 'checkmark-done-outline', color: '#3E6FCC', tint: '#EAF0FF' },
  { section: 'audit', title: 'Audit Log', subtitle: 'Inspect administrative history', icon: 'time-outline', color: '#A45478', tint: '#FCECF3' },
];
