import EntranceView from '@/components/EntranceView';
import { COLORS as SYNCRA_COLORS, RADIUS, SPACE } from '@/constants/colors';
import { TYPOGRAPHY } from '@/constants/typography';
import { useAuth } from '@/lib/auth';
import { buildQRPayload } from '@/lib/qr';
import {
  checkAdministratorAccess,
  closeAdminEvent,
  correctAdminAttendance,
  decideAdminTeacherRequest,
  grantAdminMembership,
  getAdminOverview,
  getAdminReport,
  listAdminAudit,
  listAdminAttendance,
  listAdminEvents,
  listAdminMembers,
  listAdminTeacherRequests,
  listAdminUsers,
  saveAdminEvent,
  revokeAdminMembership,
  setAdminEventArchived,
  setManagedUserRole,
  type AdminAttendance,
  type AdminAuditEntry,
  type AdminEvent,
  type AdminMember,
  type AdminOverview,
  type AdminReport,
  type AdminSection,
  type AdminTeacherRequest,
  type AdminUser,
  type ManagedRole,
} from '@/lib/admin';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

const SECTIONS: { id: AdminSection; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'overview', label: 'Overview', icon: 'grid-outline' },
  { id: 'teacherRequests', label: 'Teacher Requests', icon: 'school-outline' },
  { id: 'users', label: 'Users', icon: 'people-outline' },
  { id: 'events', label: 'Events', icon: 'calendar-outline' },
  { id: 'attendance', label: 'Attendance', icon: 'checkmark-done-outline' },
  { id: 'audit', label: 'Audit Log', icon: 'time-outline' },
  { id: 'adminAccess', label: 'Admin Access', icon: 'shield-outline' },
];

const ADMIN_THEME = {
  background: '#0C0A12',
  sidebar: '#08070D',
  surface: '#171322',
  surfaceRaised: '#201A30',
  border: '#30283F',
  text: '#F7F4FF',
  muted: '#A49CB5',
  accent: '#9A6BFF',
  accentStrong: '#7650D8',
  accentTint: 'rgba(154,107,255,0.15)',
  cyan: '#58C9E8',
  success: '#52D5A0',
  warning: '#F4B454',
  danger: '#FF718B',
};

const COLORS = {
  background: ADMIN_THEME.background,
  glassStrong: ADMIN_THEME.surface,
  glassBorder: ADMIN_THEME.border,
  primary: ADMIN_THEME.accent,
  primarySoft: ADMIN_THEME.accentStrong,
  primaryTint: ADMIN_THEME.accentTint,
  champagne: ADMIN_THEME.cyan,
  textPrimary: ADMIN_THEME.text,
  textSecondary: ADMIN_THEME.muted,
  textMuted: ADMIN_THEME.muted,
  success: ADMIN_THEME.success,
  warning: ADMIN_THEME.warning,
  danger: ADMIN_THEME.danger,
} as const;

export default function AdminScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const requestedSection = Array.isArray(params.section) ? params.section[0] : params.section;
  const { width } = useWindowDimensions();
  const isDesktop = width >= 960;
  const isNarrow = width < 360;
  const insets = useSafeAreaInsets();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [section, setSection] = useState<AdminSection>(() => (
    SECTIONS.find((item) => item.id === requestedSection)?.id ?? 'overview'
  ));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [attendance, setAttendance] = useState<AdminAttendance[]>([]);
  const [report, setReport] = useState<AdminReport | null>(null);
  const [teacherRequests, setTeacherRequests] = useState<AdminTeacherRequest[]>([]);
  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([]);
  const [expandedAuditEntries, setExpandedAuditEntries] = useState<Record<string, boolean>>({});
  const [visibleAuditActorIds, setVisibleAuditActorIds] = useState<Record<string, boolean>>({});
  const [adminMembers, setAdminMembers] = useState<AdminMember[]>([]);
  const [adminUserId, setAdminUserId] = useState('');
  const [requestStatusFilter, setRequestStatusFilter] = useState('pending');
  const [requestDecision, setRequestDecision] = useState<{ item: AdminTeacherRequest; decision: 'approved' | 'declined' | 'cancelled' } | null>(null);
  const [requestDecisionReason, setRequestDecisionReason] = useState('');
  const [search, setSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [eventFilter, setEventFilter] = useState('');
  const [eventEditingId, setEventEditingId] = useState<string | null>(null);
  const [detailsEventId, setDetailsEventId] = useState<string | null>(null);
  const [showDetailsQr, setShowDetailsQr] = useState(false);
  const [eventCodeDraft, setEventCodeDraft] = useState('');
  const [eventTitleDraft, setEventTitleDraft] = useState('');
  const [eventStartDraft, setEventStartDraft] = useState('');
  const [eventEndDraft, setEventEndDraft] = useState('');
  const [eventVenueDraft, setEventVenueDraft] = useState('');
  const [eventDescriptionDraft, setEventDescriptionDraft] = useState('');
  const [eventSettingsDraft, setEventSettingsDraft] = useState({
    gracePeriodMinutes: 0,
    lateReasonEnabled: false,
    zoneEnabled: false,
    zoneLat: null as number | null,
    zoneLon: null as number | null,
    zoneRadiusM: 100,
  });

  useEffect(() => {
    const next = SECTIONS.find((item) => item.id === requestedSection);
    if (next && next.id !== section) {
      setSection(next.id);
      setPage(0);
    }
  }, [requestedSection]);
  const [statusFilter, setStatusFilter] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reportEventFilter, setReportEventFilter] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [correction, setCorrection] = useState<AdminAttendance | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState<AdminAttendance['attendance_status']>('present');
  const [correctionLateReason, setCorrectionLateReason] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingSection, setLoadingSection] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventScrollRef = useRef<ScrollView>(null);
  const eventFormY = useRef(0);
  const detailsEvent = events.find((event) => event.id === detailsEventId) ?? null;

  const loadSection = useCallback(async (
    activeSection: AdminSection,
    query = search,
    activePage = page,
    activeRequestStatus = requestStatusFilter,
  ) => {
    setLoadingSection(true);
    setError(null);
    try {
      if (activeSection === 'users') {
        const result = await listAdminUsers(query, activePage, userRoleFilter);
        setUsers(result.items);
        setHasMore(result.has_more);
      }
      if (activeSection === 'events') {
        const result = await listAdminEvents(activePage);
        setEvents(result.items);
        setHasMore(result.has_more);
      }
      if (activeSection === 'attendance') {
        const result = await listAdminAttendance({
          eventId: eventFilter,
          status: statusFilter,
          studentId: studentFilter,
          from: dateFrom,
          to: dateTo,
          page: activePage,
        });
        setAttendance(result.items);
        setHasMore(result.has_more);
      }
      if (activeSection === 'overview') {
        const [nextReport, nextEvents, nextRequests, nextAudit] = await Promise.all([
          getAdminReport({
            eventId: reportEventFilter,
            from: reportFrom,
            to: reportTo,
          }),
          listAdminEvents(0),
          listAdminTeacherRequests('pending', 0),
          listAdminAudit('', 0),
        ]);
        setReport(nextReport);
        setEvents(nextEvents.items);
        setTeacherRequests(nextRequests.items);
        setAuditEntries(nextAudit.items);
        setHasMore(false);
      }
      if (activeSection === 'teacherRequests') {
        const result = await listAdminTeacherRequests(activeRequestStatus, activePage);
        setTeacherRequests(result.items);
        setHasMore(result.has_more);
      }
      if (activeSection === 'audit') {
        const result = await listAdminAudit('', activePage);
        setAuditEntries(result.items);
        setHasMore(result.has_more);
      }
      if (activeSection === 'adminAccess') {
        const result = await listAdminMembers(activePage);
        setAdminMembers(result.items);
        setHasMore(result.has_more);
      }
      setOverview(await getAdminOverview());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Administrator data could not be loaded.');
    } finally {
      setLoadingSection(false);
    }
  }, [
    dateFrom,
    dateTo,
    eventFilter,
    page,
    reportEventFilter,
    reportFrom,
    reportTo,
    requestStatusFilter,
    search,
    statusFilter,
    studentFilter,
    userRoleFilter,
  ]);

  const verifyAndLoad = useCallback(async () => {
    if (!user) {
      setChecking(false);
      setAuthorized(false);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const isAdmin = await checkAdministratorAccess();
      setAuthorized(isAdmin);
      if (isAdmin) await loadSection(section);
    } catch (accessError) {
      setAuthorized(false);
      setError(accessError instanceof Error ? accessError.message : 'Administrator access could not be verified.');
    } finally {
      setChecking(false);
    }
  }, [loadSection, section, user]);

  useFocusEffect(useCallback(() => { void verifyAndLoad(); }, [verifyAndLoad]));

  const perform = async (action: () => Promise<void>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage);
      let stillAuthorized: boolean;
      try {
        stillAuthorized = await checkAdministratorAccess();
      } catch (accessError) {
        setAuthorized(false);
        throw accessError;
      }
      setAuthorized(stillAuthorized);
      if (!stillAuthorized) {
        setError('Administrator membership is no longer active for this account.');
        return;
      }
      await loadSection(section);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The administrator action failed.');
    } finally {
      setBusy(false);
    }
  };

  const beginCorrection = (item: AdminAttendance) => {
    setCorrection(item);
    setCorrectionStatus(item.attendance_status);
    setCorrectionLateReason(item.late_reason ?? '');
    setCorrectionReason('');
    setError(null);
    setMessage(null);
  };

  const saveCorrection = async () => {
    if (!correction || correctionReason.trim().length < 3) {
      setError('Enter a correction reason of at least 3 characters.');
      return;
    }
    await perform(async () => {
      await correctAdminAttendance(
        correction.id,
        correctionStatus,
        correctionLateReason.trim() || null,
        correctionReason,
      );
      setCorrection(null);
    }, 'Attendance correction recorded with an audit entry.');
  };

  const selectSection = (next: AdminSection) => {
    setSection(next);
    setMobileNavOpen(false);
    setPage(0);
    setMessage(null);
    setError(null);
    void loadSection(next, search, 0);
  };
  const changePage = (next: number) => {
    setPage(next);
    void loadSection(section, search, next);
  };
  const confirmUserRole = (item: AdminUser, role: ManagedRole) => {
    Alert.alert('Change user role?', `Set ${item.full_name || item.email} to ${role}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void perform(() => setManagedUserRole(item.id, role), `User role set to ${role}.`) },
    ]);
  };
  const saveRequestDecision = async () => {
    if (!requestDecision) return;
    if (requestDecision.decision !== 'approved' && requestDecisionReason.trim().length < 3) {
      setError('Enter a decision reason of at least 3 characters.');
      return;
    }
    await perform(async () => {
      await decideAdminTeacherRequest(
        requestDecision.item.id,
        requestDecision.decision,
        requestDecision.decision === 'approved' ? null : requestDecisionReason.trim(),
      );
      setRequestDecision(null);
      setRequestDecisionReason('');
    }, `Teacher request ${requestDecision.decision}.`);
  };
  const confirmAdminGrant = () => {
    const userId = adminUserId.trim();
    if (!userId) {
      setError('Enter the verified Supabase Auth user UUID to grant administrator membership.');
      return;
    }
    Alert.alert('Grant administrator access?', `Grant access to account ${userId}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Grant', onPress: () => void perform(async () => {
        await grantAdminMembership(userId);
        setAdminUserId('');
      }, 'Administrator membership granted.') },
    ]);
  };
  const confirmAdminRevoke = (member: AdminMember) => {
    Alert.alert('Revoke administrator access?', `Revoke access from ${member.full_name || member.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => void perform(
        () => revokeAdminMembership(member.user_id),
        'Administrator membership revoked.',
      ) },
    ]);
  };
  const beginEventEdit = (item: AdminEvent) => {
    setEventEditingId(item.id);
    setEventCodeDraft(item.event_code);
    setEventTitleDraft(item.title);
    setEventStartDraft(item.start_time ?? '');
    setEventEndDraft(item.end_time ?? '');
    setEventVenueDraft(item.venue ?? '');
    setEventDescriptionDraft(item.description ?? '');
    setEventSettingsDraft({
      gracePeriodMinutes: item.grace_period_minutes,
      lateReasonEnabled: item.late_reason_enabled,
      zoneEnabled: item.zone_enabled,
      zoneLat: item.zone_lat,
      zoneLon: item.zone_lon,
      zoneRadiusM: item.zone_radius_m,
    });
    eventScrollRef.current?.scrollTo({ y: eventFormY.current, animated: true });
  };
  const clearEventDraft = () => {
    setEventEditingId(null);
    setEventCodeDraft('');
    setEventTitleDraft('');
    setEventStartDraft('');
    setEventEndDraft('');
    setEventVenueDraft('');
    setEventDescriptionDraft('');
    setEventSettingsDraft({
      gracePeriodMinutes: 0,
      lateReasonEnabled: false,
      zoneEnabled: false,
      zoneLat: null,
      zoneLon: null,
      zoneRadiusM: 100,
    });
  };
  const saveEventFromAdmin = async () => {
    const start = Date.parse(eventStartDraft);
    const end = Date.parse(eventEndDraft);
    if (!eventCodeDraft.trim() || !eventTitleDraft.trim() ||
      (!eventEditingId && (!eventVenueDraft.trim() || !eventDescriptionDraft.trim()))) {
      setError(eventEditingId
        ? 'Event code and name are required.'
        : 'Event code, name, venue, and description are required.');
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setError('Enter valid event start and end dates, with the end after the start.');
      return;
    }
    await perform(async () => {
      await saveAdminEvent({
        eventCode: eventCodeDraft,
        title: eventTitleDraft,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        venue: eventVenueDraft,
        description: eventDescriptionDraft,
        eventStatus: events.find((event) => event.id === eventEditingId)?.event_status ?? 'active',
        ...eventSettingsDraft,
      }, eventEditingId ?? undefined);
      clearEventDraft();
    }, eventEditingId ? 'Event details updated.' : 'Event created.');
  };
  const confirmAdminCloseEvent = (item: AdminEvent) => {
    Alert.alert('Close this event?', `New attendance scans for "${item.title}" will be blocked.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close event', style: 'destructive', onPress: () => void perform(
        () => closeAdminEvent(item.id),
        'Event closed. New attendance scans are blocked.',
      ) },
    ]);
  };

  if (checking) {
    return <CenterState icon="shield-checkmark-outline" text="Verifying administrator access..." loading />;
  }

  if (!authorized) {
    return (
      <View style={styles.screen}>
        <View style={styles.deniedCard}>
          <View style={styles.lockIcon}><Ionicons name="lock-closed-outline" size={25} color={COLORS.primary} /></View>
          <Text style={styles.title}>Administrator access</Text>
          <Text style={styles.subtitle}>{error ?? 'This account is not authorized to use the administrator dashboard.'}</Text>
          <Text style={styles.hint}>Access is confirmed by the database, not by profile metadata.</Text>
          {error && <Pressable style={styles.primaryButton} onPress={() => void verifyAndLoad()}><Text style={styles.primaryButtonText}>Retry access check</Text></Pressable>}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      {isDesktop && (
        <View style={styles.sidebar}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}><Ionicons name="sync" size={21} color="#FFFFFF" /></View>
            <View>
              <Text style={styles.brandName}>SYNCRA</Text>
              <Text style={styles.brandCaption}>ADMIN CONSOLE</Text>
            </View>
          </View>
          <Text style={styles.sidebarCaption}>WORKSPACE</Text>
          <View style={styles.sidebarNav}>
            {SECTIONS.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: section === item.id }}
                onPress={() => selectSection(item.id)}
                style={[styles.sidebarButton, section === item.id && styles.sidebarButtonActive]}
              >
                <Ionicons name={item.icon} size={19} color={section === item.id ? '#FFFFFF' : ADMIN_THEME.muted} />
                <Text style={[styles.sidebarButtonText, section === item.id && styles.sidebarButtonTextActive]}>{item.label}</Text>
                {item.id === 'teacherRequests' && overview && overview.pending_teacher_request_count > 0 && (
                  <Text style={styles.sidebarBadge}>{overview.pending_teacher_request_count}</Text>
                )}
              </Pressable>
            ))}
          </View>
          <View style={styles.sidebarFooter}>
            <View style={styles.adminIdentity}>
              <View style={styles.identityAvatar}><Ionicons name="shield-checkmark" size={17} color={ADMIN_THEME.accent} /></View>
              <View style={styles.identityCopy}>
                <Text numberOfLines={1} style={styles.identityName}>Administrator</Text>
                <Text numberOfLines={1} style={styles.identityEmail}>{user?.email ?? 'Verified account'}</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open account and sign out"
              onPress={() => router.push('/(tabs)/profile')}
              style={styles.accountButton}
            >
              <Ionicons name="person-circle-outline" size={18} color={ADMIN_THEME.muted} />
              <Text style={styles.accountButtonText}>Account settings</Text>
              <Ionicons name="chevron-forward" size={15} color={ADMIN_THEME.muted} />
            </Pressable>
          </View>
        </View>
      )}
      <View style={styles.workspace}>
      {!isDesktop && (
        <View style={[styles.mobileBrand, { paddingTop: insets.top }]}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}><Ionicons name="sync" size={19} color="#FFFFFF" /></View>
            <View>
              <Text style={styles.brandName}>SYNCRA</Text>
              <Text style={styles.brandCaption}>ADMIN CONSOLE</Text>
            </View>
          </View>
          <View style={styles.mobileHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open account and sign out"
              onPress={() => router.push('/(tabs)/profile')}
              style={styles.headerIcon}
            >
              <Ionicons name="person-circle-outline" size={23} color={ADMIN_THEME.accent} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open admin navigation"
              accessibilityState={{ expanded: mobileNavOpen }}
              onPress={() => setMobileNavOpen(true)}
              style={styles.headerIcon}
            >
              <Ionicons name="menu" size={23} color={ADMIN_THEME.accent} />
            </Pressable>
          </View>
        </View>
      )}
      <ScrollView
        ref={eventScrollRef}
        style={styles.mainScroll}
        contentContainerStyle={[
          styles.content,
          isDesktop && styles.desktopContent,
          !isDesktop && styles.mobileContent,
          !isDesktop && { paddingBottom: insets.bottom + 126 },
          isNarrow && styles.narrowContent,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <EntranceView>
          <View style={[styles.header, !isDesktop && styles.mobilePageHeader]}>
            <View>
              <Text style={styles.eyebrow}>SYNCRA / ADMINISTRATION</Text>
              <Text style={styles.title}>{sectionTitle(section)}</Text>
              <Text style={styles.pageSubtitle}>{sectionSubtitle(section)}</Text>
            </View>
            <View style={[styles.headerActions, !isDesktop && styles.mobilePageActions]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Open account notifications" onPress={() => router.push('/(tabs)/profile')} style={styles.headerIcon}><Ionicons name="notifications-outline" size={20} color={ADMIN_THEME.accent} /></Pressable>
              <View style={styles.verifiedPill}><View style={styles.verifiedDot} /><Text style={styles.verifiedText}>Verified admin</Text></View>
            </View>
          </View>
        </EntranceView>

        {section === 'overview' && overview && <View style={styles.summaryGrid}>
          <Summary value={overview.student_count} label="Students" icon="people-outline" mobile={!isDesktop} narrow={isNarrow} />
          <Summary value={overview.teacher_count} label="Teachers" icon="school-outline" mobile={!isDesktop} narrow={isNarrow} />
          <Summary value={overview.event_count} label="Events" icon="calendar-outline" mobile={!isDesktop} narrow={isNarrow} />
          <Summary value={overview.attendance_count} label="Attendance records" icon="checkmark-done-outline" mobile={!isDesktop} narrow={isNarrow} />
        </View>}

        {error && <><Notice tone="error" text={error} /><Pressable style={styles.outlineButton} onPress={() => void loadSection(section)}><Text style={styles.outlineButtonText}>Retry loading</Text></Pressable></>}
        {message && <Notice tone="success" text={message} />}
        {loadingSection && <View style={styles.busy}><ActivityIndicator color={COLORS.primary} /><Text style={styles.helper}>Loading administrator records...</Text></View>}

        {section === 'users' && <View style={[styles.card, !isDesktop && styles.mobileCard]}>
          <Text style={styles.cardTitle}>User management</Text>
          <Text style={styles.helper}>Change app roles only. Administrator membership is managed separately by a trusted database owner.</Text>
          <View style={[styles.searchRow, isNarrow && styles.stackedRow]}>
            <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Search name or email" placeholderTextColor={COLORS.textMuted} />
            <Pressable style={styles.searchButton} onPress={() => { setPage(0); void loadSection('users', search, 0); }}><Ionicons name="search" size={19} color="#FFFFFF" /></Pressable>
          </View>
          <View style={styles.filterRow}>
            {['', 'student', 'teacher'].map((role) => (
              <Pressable key={role || 'all'} onPress={() => {
                setUserRoleFilter(role);
                setPage(0);
                void listAdminUsers(search, 0, role).then((result) => {
                  setUsers(result.items);
                  setHasMore(result.has_more);
                  setError(null);
                }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'User list could not be loaded.'));
              }} style={[styles.filterPill, userRoleFilter === role && styles.filterPillActive]}>
                <Text style={[styles.filterText, userRoleFilter === role && styles.filterTextActive]}>{role || 'All roles'}</Text>
              </Pressable>
            ))}
          </View>
          {users.length === 0 ? <Empty text="No users found." /> : users.map((item) => (
            <View key={item.id} style={[styles.listRow, !isDesktop && styles.stackedListRow]}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{item.full_name || 'Unnamed account'}</Text>
                <Text style={styles.rowMeta}>{item.email}</Text>
                <Text style={styles.rowMeta}>ID: {item.id}</Text>
              </View>
              <View style={[styles.roleActions, !isDesktop && styles.mobileRoleActions]}>
                {(['student', 'teacher'] as ManagedRole[]).map((role) => (
                  <Pressable key={role} disabled={busy || item.role === role} onPress={() => confirmUserRole(item, role)} style={[styles.rolePill, item.role === role && styles.rolePillActive]}>
                    <Text style={[styles.rolePillText, item.role === role && styles.rolePillTextActive]}>{role}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <Pagination page={page} hasMore={hasMore} onChange={changePage} />
        </View>}

        {section === 'events' && <View onLayout={(event) => { eventFormY.current = event.nativeEvent.layout.y; }} style={[styles.card, !isDesktop && styles.mobileCard]}>
          <Text style={styles.cardTitle}>Event management</Text>
          <Text style={styles.helper}>Create or edit events and close check-in when needed. Changing an event code requires replacing its existing printed QR codes.</Text>
          <TextInput style={styles.input} value={eventCodeDraft} onChangeText={setEventCodeDraft} placeholder="Unique event code" placeholderTextColor={COLORS.textMuted} autoCapitalize="characters" />
          <TextInput style={styles.input} value={eventTitleDraft} onChangeText={setEventTitleDraft} placeholder="Event name" placeholderTextColor={COLORS.textMuted} />
          <TextInput style={styles.input} value={eventStartDraft} onChangeText={setEventStartDraft} placeholder="Start (ISO date/time)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          <TextInput style={styles.input} value={eventEndDraft} onChangeText={setEventEndDraft} placeholder="End (ISO date/time)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          <TextInput style={styles.input} value={eventVenueDraft} onChangeText={setEventVenueDraft} placeholder="Venue" placeholderTextColor={COLORS.textMuted} />
          <TextInput style={[styles.input, styles.reasonInput]} value={eventDescriptionDraft} onChangeText={setEventDescriptionDraft} placeholder="Description" placeholderTextColor={COLORS.textMuted} multiline maxLength={5000} />
          <View style={[styles.actionRow, !isDesktop && styles.mobileActionRow]}>
            {eventEditingId && <Pressable style={styles.outlineButton} onPress={clearEventDraft}><Text style={styles.outlineButtonText}>Cancel edit</Text></Pressable>}
            <Pressable disabled={busy} style={styles.primaryButton} onPress={() => void saveEventFromAdmin()}><Text style={styles.primaryButtonText}>{busy ? 'Saving...' : eventEditingId ? 'Save event' : 'Create event'}</Text></Pressable>
          </View>
          {events.length === 0 ? <Empty text="No events found." /> : events.map((item) => (
            <View key={item.id} style={[styles.listRow, !isDesktop && styles.stackedListRow]}>
              <View style={styles.eventDetailsCopy}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowMeta}>{item.event_code} · Created {formatDate(item.created_at)}</Text>
                <Text style={styles.rowMeta}>{eventDisplayStatus(item)} · {item.venue || 'Venue unavailable'}</Text>
                <Text style={styles.rowMeta}>{formatDate(item.start_time)} – {formatDate(item.end_time)}</Text>
                {item.description && <Text style={styles.rowMeta}>{item.description}</Text>}
                <Text style={styles.rowMeta}>Owner: {item.created_by ?? 'Unavailable'}</Text>
                <Text style={[styles.stateTag, item.archived_at || item.event_status === 'closed' ? styles.stateArchived : styles.stateActive]}>{item.archived_at ? 'Archived' : eventDisplayStatus(item)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View details for ${item.title}`}
                  onPress={() => {
                    setDetailsEventId(item.id);
                    setShowDetailsQr(false);
                  }}
                  style={({ pressed }) => [styles.viewDetailsButton, pressed && styles.viewDetailsButtonPressed]}
                >
                  <Ionicons name="eye-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.viewDetailsButtonText}>View Details</Text>
                </Pressable>
              </View>
              <View style={[styles.eventActions, !isDesktop && styles.mobileEventActions]}>
                {!item.archived_at && <Pressable disabled={busy} onPress={() => beginEventEdit(item)} style={styles.iconAction}><Ionicons name="create-outline" size={18} color={COLORS.primary} /></Pressable>}
                {!item.archived_at && item.event_status !== 'closed' && <Pressable disabled={busy} onPress={() => confirmAdminCloseEvent(item)} style={styles.iconAction}><Ionicons name="lock-closed-outline" size={18} color={COLORS.warning} /></Pressable>}
                <Pressable disabled={busy} onPress={() => void perform(() => setAdminEventArchived(item.id, !item.archived_at), item.archived_at ? 'Event restored.' : 'Event archived.')} style={styles.iconAction}>
                  <Ionicons name={item.archived_at ? 'refresh-outline' : 'archive-outline'} size={19} color={COLORS.primary} />
                </Pressable>
              </View>
            </View>
          ))}
          <Pagination page={page} hasMore={hasMore} onChange={changePage} />
        </View>}

        {section === 'overview' && <View style={[styles.card, !isDesktop && styles.mobileCard]}>
          <Text style={styles.cardTitle}>Quick access</Text>
          <View style={styles.shortcutGrid}>
            {([
              ['users', 'Users', 'people-outline'],
              ['events', 'Events', 'calendar-outline'],
              ['teacherRequests', 'Teacher Requests', 'school-outline'],
              ['attendance', 'Attendance', 'checkmark-done-outline'],
              ['audit', 'Audit Log', 'time-outline'],
            ] as const).map(([target, label, icon]) => (
              <Pressable key={target} onPress={() => selectSection(target)} style={[styles.shortcutCard, !isDesktop && styles.mobileShortcutCard, isNarrow && styles.singleColumnShortcut]}>
                <View style={styles.shortcutIcon}><Ionicons name={icon} size={19} color={ADMIN_THEME.accent} /></View>
                <Text style={styles.shortcutLabel}>{label}</Text>
                <Ionicons name="arrow-forward" size={15} color={ADMIN_THEME.muted} />
              </Pressable>
            ))}
          </View>
        </View>}

        {section === 'overview' && <View style={[styles.dashboardColumns, !isDesktop && styles.stackedDashboardColumns]}>
          <View style={[styles.card, styles.dashboardPanel, !isDesktop && styles.mobileCard, !isDesktop && styles.mobileDashboardPanel]}>
            <View style={styles.panelHeader}>
              <View><Text style={styles.cardTitle}>Teacher requests</Text><Text style={styles.helper}>Pending review</Text></View>
              <Pressable onPress={() => selectSection('teacherRequests')} style={styles.panelLink}><Text style={styles.panelLinkText}>View all</Text><Ionicons name="arrow-forward" size={14} color={ADMIN_THEME.accent} /></Pressable>
            </View>
            {teacherRequests.length === 0 ? <Empty text="No pending teacher requests." /> : teacherRequests.slice(0, 4).map((item) => (
              <Pressable key={item.id} onPress={() => selectSection('teacherRequests')} style={styles.dashboardRow}>
                <View style={styles.requestAvatar}><Ionicons name="school-outline" size={17} color={ADMIN_THEME.accent} /></View>
                <View style={styles.dashboardRowCopy}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{item.student_name || item.student_email || item.student_id}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>{item.student_email ?? item.student_id}</Text>
                </View>
                <Text style={styles.dashboardDate}>{formatRelativeDate(item.requested_at)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.card, styles.dashboardPanel, !isDesktop && styles.mobileCard, !isDesktop && styles.mobileDashboardPanel]}>
            <View style={styles.panelHeader}>
              <View><Text style={styles.cardTitle}>Recent activity</Text><Text style={styles.helper}>Latest administrative audit entries</Text></View>
              <Pressable onPress={() => selectSection('audit')} style={styles.panelLink}><Text style={styles.panelLinkText}>Audit log</Text><Ionicons name="arrow-forward" size={14} color={ADMIN_THEME.accent} /></Pressable>
            </View>
            {auditEntries.length === 0 ? <Empty text="No administrative activity recorded." /> : auditEntries.slice(0, 4).map((item) => (
              <Pressable key={item.id} onPress={() => selectSection('audit')} style={styles.dashboardRow}>
                <View style={styles.activityIcon}><Ionicons name="pulse-outline" size={17} color={ADMIN_THEME.cyan} /></View>
                <View style={styles.dashboardRowCopy}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{formatAuditAction(item.action)}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>Actor {findAuditActorName(item.actor_id, users, adminMembers) || shortenIdentifier(item.actor_id) || 'Unknown'} · {item.subject_id ?? 'No subject ID'}</Text>
                </View>
                <Text style={styles.dashboardDate}>{formatRelativeDate(item.created_at)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.card, styles.dashboardWidePanel, !isDesktop && styles.mobileCard, !isDesktop && styles.mobileDashboardPanel]}>
            <View style={styles.panelHeader}>
              <View><Text style={styles.cardTitle}>Recently created events</Text><Text style={styles.helper}>Creator IDs are shown as supplied by the admin event service.</Text></View>
              <Pressable onPress={() => selectSection('events')} style={styles.panelLink}><Text style={styles.panelLinkText}>Manage events</Text><Ionicons name="arrow-forward" size={14} color={ADMIN_THEME.accent} /></Pressable>
            </View>
            {events.length === 0 ? <Empty text="No events available." /> : events.slice(0, 5).map((item) => (
              <Pressable key={item.id} onPress={() => selectSection('events')} style={[styles.eventSummaryRow, !isDesktop && styles.stackedEventSummaryRow]}>
                <View style={styles.eventSummaryMain}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>{item.event_code} · Creator ID: {item.created_by ?? 'Unavailable'}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>{formatDate(item.start_time)} · {eventDisplayStatus(item)}</Text>
                </View>
                <Text style={[styles.stateTag, item.archived_at || item.event_status === 'closed' ? styles.stateArchived : styles.stateActive]}>{item.archived_at ? 'Archived' : eventDisplayStatus(item)}</Text>
              </Pressable>
            ))}
          </View>
        </View>}

        {section === 'overview' && <View style={[styles.card, !isDesktop && styles.mobileCard]}>
          <Text style={styles.cardTitle}>System overview and reports</Text>
          <Text style={styles.helper}>Report data is queried from saved attendance records. No attendance rate is shown because this database has no eligible-student roster denominator.</Text>
          <TextInput style={styles.input} value={reportEventFilter} onChangeText={setReportEventFilter} placeholder="Optional event UUID" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          <View style={[styles.actionRow, !isDesktop && styles.stackedRow]}>
            <TextInput style={[styles.input, styles.filterDateInput]} value={reportFrom} onChangeText={setReportFrom} placeholder="From (ISO date/time)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
            <TextInput style={[styles.input, styles.filterDateInput]} value={reportTo} onChangeText={setReportTo} placeholder="To (ISO date/time)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          </View>
          <Pressable style={styles.outlineButton} onPress={() => {
            const from = reportFrom.trim() ? Date.parse(reportFrom) : null;
            const to = reportTo.trim() ? Date.parse(reportTo) : null;
            if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from >= to)) {
              setError('Enter valid report dates with the start earlier than the end.');
              return;
            }
            void loadSection('overview', search, 0);
          }}><Text style={styles.outlineButtonText}>Apply report filters</Text></Pressable>
          {report ? <>
            <Text style={styles.sectionCaption}>Attendance by status</Text>
            {Object.entries(report.status_counts).map(([status, count]) => <View key={status} style={styles.reportRow}><Text style={styles.rowTitle}>{status}</Text><Text style={styles.reportValue}>{count}</Text></View>)}
            <Text style={styles.sectionCaption}>Event attendance summaries</Text>
            {report.event_summaries.length === 0 ? <Empty text="No event attendance matches this report." /> : report.event_summaries.map((item) => (
              <View key={item.event_id} style={styles.reportEntry}>
                <Text style={styles.rowTitle}>{item.event_title}</Text>
                <Text style={styles.rowMeta}>{item.event_code} · {item.attendance_count} attendance records</Text>
                {Object.entries(item.status_counts).map(([status, count]) => <Text key={status} style={styles.rowMeta}>{status}: {count}</Text>)}
              </View>
            ))}
            <Text style={styles.sectionCaption}>Recent attendance activity</Text>
            {report.recent_attendance.length === 0 ? <Empty text="No recent attendance in this range." /> : report.recent_attendance.map((item) => (
              <View key={item.id} style={styles.reportEntry}>
                <Text style={styles.rowTitle}>{item.event_title || item.event_code || item.event_id}</Text>
                <Text style={styles.rowMeta}>{item.student_name || 'Student'} · {item.attendance_status} · {formatDate(item.scanned_at)}</Text>
              </View>
            ))}
            <Text style={styles.sectionCaption}>Recent attendance corrections</Text>
            {report.recent_corrections.length === 0 ? <Empty text="No attendance corrections recorded." /> : report.recent_corrections.map((item) => (
              <View key={item.id} style={styles.reportEntry}>
                <Text style={styles.rowMeta}>{formatDate(item.corrected_at)} · Actor {item.actor_id}</Text>
                <Text style={styles.rowTitle}>Attendance {item.attendance_id}</Text>
                <Text style={styles.rowMeta}>{item.reason}</Text>
                <Text style={styles.rowMeta}>Before: {JSON.stringify(item.before_record)}</Text>
                <Text style={styles.rowMeta}>After: {JSON.stringify(item.after_record)}</Text>
              </View>
            ))}
          </> : <Empty text="Reports are not available yet." />}
        </View>}

        {section === 'teacherRequests' && <View style={[styles.card, !isDesktop && styles.mobileCard]}>
          <Text style={styles.cardTitle}>Teacher access requests</Text>
          <View style={styles.filterRow}>
            {['pending', 'approved', 'declined', 'withdrawn', 'cancelled'].map((status) => (
              <Pressable key={status} onPress={() => {
                setRequestStatusFilter(status);
                setPage(0);
                void loadSection('teacherRequests', search, 0, status);
              }} style={[styles.filterPill, requestStatusFilter === status && styles.filterPillActive]}>
                <Text style={[styles.filterText, requestStatusFilter === status && styles.filterTextActive]}>{status}</Text>
              </Pressable>
            ))}
          </View>
          {teacherRequests.length === 0 ? <Empty text="No requests match this status." /> : teacherRequests.map((item) => (
            <View key={item.id} style={styles.recordCard}>
              <Text style={styles.rowTitle}>{item.student_name || item.student_email || item.student_id}</Text>
              <Text style={styles.rowMeta}>{item.student_email ?? item.student_id} · Submitted {formatDate(item.requested_at)}</Text>
              <Text style={styles.helper}>{item.reason}</Text>
              <Text style={styles.stateTag}>{item.status}</Text>
              {item.decision_reason && <Text style={styles.rowMeta}>Decision note: {item.decision_reason}</Text>}
              {item.status === 'pending' && requestDecision?.item.id === item.id ? (
                <View style={styles.correctionForm}>
                  <Text style={styles.helper}>{requestDecision.decision === 'approved' ? 'Confirm approving this teacher request?' : `A ${requestDecision.decision} reason is required.`}</Text>
                  {requestDecision.decision !== 'approved' && <TextInput style={[styles.input, styles.reasonInput]} value={requestDecisionReason} onChangeText={setRequestDecisionReason} placeholder={`Required ${requestDecision.decision} reason`} placeholderTextColor={COLORS.textMuted} multiline maxLength={500} />}
                  <View style={[styles.actionRow, !isDesktop && styles.mobileActionRow]}>
                    <Pressable style={styles.outlineButton} onPress={() => { setRequestDecision(null); setRequestDecisionReason(''); }}><Text style={styles.outlineButtonText}>Cancel</Text></Pressable>
                    <Pressable disabled={busy} style={styles.primaryButton} onPress={() => void saveRequestDecision()}><Text style={styles.primaryButtonText}>Confirm {requestDecision.decision}</Text></Pressable>
                  </View>
                </View>
              ) : item.status === 'pending' && (
                <View style={[styles.actionRow, !isDesktop && styles.mobileActionRow]}>
                  <Pressable disabled={busy} style={styles.outlineButton} onPress={() => { setRequestDecision({ item, decision: 'declined' }); setRequestDecisionReason(''); }}>
                    <Text style={styles.outlineButtonText}>Decline</Text>
                  </Pressable>
                  <Pressable disabled={busy} style={styles.outlineButton} onPress={() => { setRequestDecision({ item, decision: 'cancelled' }); setRequestDecisionReason(''); }}>
                    <Text style={styles.outlineButtonText}>Cancel request</Text>
                  </Pressable>
                  <Pressable disabled={busy} style={styles.primaryButton} onPress={() => { setRequestDecision({ item, decision: 'approved' }); setRequestDecisionReason(''); }}>
                    <Text style={styles.primaryButtonText}>Review approval</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          <Pagination page={page} hasMore={hasMore} onChange={changePage} />
        </View>}

        {section === 'attendance' && <View style={[styles.card, !isDesktop && styles.mobileCard]}>
          <Text style={styles.cardTitle}>Overall attendance</Text>
          <TextInput style={styles.input} value={eventFilter} onChangeText={setEventFilter} placeholder="Filter by event ID (optional)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          <TextInput style={styles.input} value={studentFilter} onChangeText={setStudentFilter} placeholder="Filter by student UUID (optional)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          <View style={[styles.actionRow, !isDesktop && styles.stackedRow]}>
            <TextInput style={[styles.input, styles.filterDateInput]} value={dateFrom} onChangeText={setDateFrom} placeholder="From (ISO date/time)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
            <TextInput style={[styles.input, styles.filterDateInput]} value={dateTo} onChangeText={setDateTo} placeholder="To (ISO date/time)" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          </View>
          <View style={styles.filterRow}>
            {['', 'present', 'late', 'recovered'].map((status) => (
              <Pressable key={status || 'all'} onPress={() => setStatusFilter(status)} style={[styles.filterPill, statusFilter === status && styles.filterPillActive]}>
                <Text style={[styles.filterText, statusFilter === status && styles.filterTextActive]}>{status || 'All'}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.outlineButton} onPress={() => {
            const from = dateFrom.trim() ? Date.parse(dateFrom) : null;
            const to = dateTo.trim() ? Date.parse(dateTo) : null;
            if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from >= to)) {
              setError('Enter valid attendance dates with the start earlier than the end.');
              return;
            }
            setPage(0);
            void loadSection('attendance', search, 0);
          }}><Text style={styles.outlineButtonText}>Apply filters</Text></Pressable>
          {attendance.length === 0 ? <Empty text="No attendance records match these filters." /> : attendance.map((item) => (
            <View key={item.id} style={styles.recordCard}>
              <View style={styles.recordHeading}>
                <View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.event_title || item.event_code || item.event_id}</Text><Text style={styles.rowMeta}>{item.student_name || item.student_id} · {formatDate(item.scanned_at)}</Text></View>
                <Text style={styles.stateTag}>{item.attendance_status}</Text>
              </View>
              {item.late_reason && <Text style={styles.rowMeta}>Reason: {item.late_reason}</Text>}
              <Pressable style={styles.outlineButton} onPress={() => beginCorrection(item)}><Text style={styles.outlineButtonText}>Correct record</Text></Pressable>
              {correction?.id === item.id && <View style={styles.correctionForm}>
                <Text style={styles.helper}>Set corrected status</Text>
                <View style={styles.filterRow}>
                  {(['present', 'late', 'recovered'] as const).map((status) => (
                    <Pressable key={status} onPress={() => setCorrectionStatus(status)} style={[styles.filterPill, correctionStatus === status && styles.filterPillActive]}><Text style={[styles.filterText, correctionStatus === status && styles.filterTextActive]}>{status}</Text></Pressable>
                  ))}
                </View>
                <TextInput style={styles.input} value={correctionLateReason} onChangeText={setCorrectionLateReason} placeholder="Late reason (optional)" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={[styles.input, styles.reasonInput]} value={correctionReason} onChangeText={setCorrectionReason} placeholder="Required audit reason" placeholderTextColor={COLORS.textMuted} multiline maxLength={1000} />
                <View style={[styles.actionRow, !isDesktop && styles.mobileActionRow]}>
                  <Pressable style={styles.outlineButton} onPress={() => setCorrection(null)}><Text style={styles.outlineButtonText}>Cancel</Text></Pressable>
                  <Pressable disabled={busy} style={styles.primaryButton} onPress={() => void saveCorrection()}><Text style={styles.primaryButtonText}>{busy ? 'Saving...' : 'Save correction'}</Text></Pressable>
                </View>
              </View>}
            </View>
          ))}
          <Pagination page={page} hasMore={hasMore} onChange={changePage} />
        </View>}

        {section === 'audit' && <View style={[styles.card, styles.auditCard, !isDesktop && styles.mobileCard]}>
          <Text style={styles.auditCardTitle}>Protected audit history</Text>
          <Text style={styles.auditIntro}>A protected record of administrative and account activity.</Text>
          {auditEntries.length === 0 ? (
            <View style={styles.auditEmpty}>
              <Ionicons name="file-tray-outline" size={20} color={SYNCRA_COLORS.textMuted} />
              <Text style={styles.auditMeta}>No audit entries are available.</Text>
            </View>
          ) : auditEntries.map((item) => {
            const actorName = findAuditActorName(item.actor_id, users, adminMembers);
            const actorId = typeof item.actor_id === 'string' ? item.actor_id : '';
            const subjectId = typeof item.subject_id === 'string' ? item.subject_id : '';
            const createdAt = typeof item.created_at === 'string' ? item.created_at : null;
            const showActorId = visibleAuditActorIds[item.id] === true;
            const showTechnicalDetails = expandedAuditEntries[item.id] === true;
            const actionLabel = formatAuditAction(item.action);
            const afterRecord = readAuditRecord(item.after_record);
            const beforeRecord = readAuditRecord(item.before_record);
            const reason = getAuditText(item.reason)
              ?? getAuditText(afterRecord?.reason)
              ?? getAuditText(beforeRecord?.reason);
            const status = getAuditStatus(afterRecord?.status)
              ?? getAuditStatus(beforeRecord?.status);
            const isTeacherRequest = typeof item.action === 'string' && item.action.startsWith('teacher_request_');

            return (
              <View key={item.id} style={styles.auditEntry}>
                <View style={styles.auditEntryHeading}>
                  <View style={styles.auditTitleCopy}>
                    <Text style={styles.auditAction}>{actionLabel}</Text>
                    <Text style={styles.auditMeta}>{formatDate(createdAt)}</Text>
                  </View>
                  {status && (
                    <View style={[styles.auditStatus, auditStatusStyle(status)]}>
                      <Text style={[styles.auditStatusText, auditStatusTextStyle(status)]}>{status}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.auditDetailRow}>
                  <Ionicons name="person-outline" size={15} color={SYNCRA_COLORS.textMuted} />
                  <Text style={styles.auditMeta}>{actorName ? `By ${actorName}` : 'Actor'}</Text>
                  {actorId ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${showActorId ? 'Hide' : 'View'} full actor ID`}
                      onPress={() => setVisibleAuditActorIds((current) => ({ ...current, [item.id]: !current[item.id] }))}
                    >
                      <Text selectable style={styles.auditActorId}>{showActorId ? actorId : shortenIdentifier(actorId)}</Text>
                    </Pressable>
                  ) : <Text style={styles.auditMeta}>Unknown</Text>}
                </View>

                {subjectId && (
                  <View style={styles.auditDetailRow}>
                    <Ionicons name={isTeacherRequest ? 'school-outline' : 'link-outline'} size={15} color={SYNCRA_COLORS.textMuted} />
                    <Text style={styles.auditMeta}>{isTeacherRequest ? 'Request' : 'Related record'}</Text>
                    <Text selectable style={styles.auditIdentifier}>{subjectId}</Text>
                  </View>
                )}
                {reason && <Text style={styles.auditReason}><Text style={styles.auditReasonLabel}>Reason: </Text>{reason}</Text>}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showTechnicalDetails }}
                  onPress={() => setExpandedAuditEntries((current) => ({ ...current, [item.id]: !current[item.id] }))}
                  style={styles.auditDetailsToggle}
                >
                  <Ionicons name={showTechnicalDetails ? 'chevron-up' : 'code-slash-outline'} size={15} color={SYNCRA_COLORS.primary} />
                  <Text style={styles.auditDetailsToggleText}>{showTechnicalDetails ? 'Hide technical details' : 'View technical details'}</Text>
                </Pressable>

                {showTechnicalDetails && (
                  <View style={styles.auditTechnicalDetails}>
                    <Text style={styles.auditSnapshotLabel}>Audit record ID</Text>
                    <Text selectable style={styles.auditSnapshotValue}>{item.id}</Text>
                    {item.before_record != null && (
                      <>
                        <Text style={styles.auditSnapshotLabel}>Before</Text>
                        <Text selectable style={styles.auditSnapshotValue}>{formatAuditSnapshot(item.before_record)}</Text>
                      </>
                    )}
                    {item.after_record != null && (
                      <>
                        <Text style={styles.auditSnapshotLabel}>After</Text>
                        <Text selectable style={styles.auditSnapshotValue}>{formatAuditSnapshot(item.after_record)}</Text>
                      </>
                    )}
                    {item.before_record == null && item.after_record == null && (
                      <Text style={styles.auditMeta}>No before or after snapshots are available.</Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
          <Pagination page={page} hasMore={hasMore} onChange={changePage} light />
        </View>}

        {section === 'adminAccess' && <View style={[styles.card, !isDesktop && styles.mobileCard]}>
          <Text style={styles.cardTitle}>Administrator membership</Text>
          <Text style={styles.helper}>Grant access only to a verified account UUID. Backend operations must serialize changes and prevent removal of the last active administrator.</Text>
          <TextInput style={styles.input} value={adminUserId} onChangeText={setAdminUserId} placeholder="Verified Supabase Auth user UUID" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" autoCorrect={false} />
          <Pressable disabled={busy} style={styles.primaryButton} onPress={confirmAdminGrant}><Text style={styles.primaryButtonText}>Grant administrator access</Text></Pressable>
          <Text style={styles.sectionCaption}>Current administrators</Text>
          {adminMembers.length === 0 ? <Empty text="No administrator memberships found." /> : adminMembers.map((member) => (
            <View key={member.user_id} style={[styles.listRow, !isDesktop && styles.stackedListRow]}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{member.full_name || member.email}</Text>
                <Text style={styles.rowMeta}>{member.email} · {member.user_id}</Text>
                <Text style={styles.rowMeta}>Granted {formatDate(member.granted_at)}</Text>
              </View>
              <Pressable disabled={busy} onPress={() => confirmAdminRevoke(member)} style={styles.iconAction}>
                <Ionicons name="remove-circle-outline" size={19} color={COLORS.danger} />
              </Pressable>
            </View>
          ))}
          <Pagination page={page} hasMore={hasMore} onChange={changePage} />
        </View>}

        {busy && <View style={styles.busy}><ActivityIndicator color={COLORS.primary} /><Text style={styles.helper}>Saving administrator change...</Text></View>}
        <Text style={styles.footer}>Every management action is verified by database authorization.</Text>
      </ScrollView>
      </View>
      <Modal
        visible={mobileNavOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMobileNavOpen(false)}
      >
        <View style={styles.mobileMenuBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close admin navigation"
            onPress={() => setMobileNavOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.mobileMenu, { paddingTop: insets.top + SPACE.md, paddingBottom: insets.bottom + SPACE.md }]}>
            <View style={styles.mobileMenuHeader}>
              <View>
                <Text style={styles.brandName}>SYNCRA</Text>
                <Text style={styles.brandCaption}>ADMIN CONSOLE</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close admin navigation"
                onPress={() => setMobileNavOpen(false)}
                style={styles.headerIcon}
              >
                <Ionicons name="close" size={22} color={ADMIN_THEME.accent} />
              </Pressable>
            </View>
            <Text style={styles.sidebarCaption}>WORKSPACE</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {SECTIONS.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: section === item.id }}
                  onPress={() => selectSection(item.id)}
                  style={[styles.sidebarButton, styles.mobileMenuButton, section === item.id && styles.sidebarButtonActive]}
                >
                  <Ionicons name={item.icon} size={19} color={section === item.id ? '#FFFFFF' : ADMIN_THEME.muted} />
                  <Text style={[styles.sidebarButtonText, section === item.id && styles.sidebarButtonTextActive]}>{item.label}</Text>
                  {item.id === 'teacherRequests' && overview && overview.pending_teacher_request_count > 0 && (
                    <Text style={styles.sidebarBadge}>{overview.pending_teacher_request_count}</Text>
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMobileNavOpen(false);
                router.push('/(tabs)/profile');
              }}
              style={styles.accountButton}
            >
              <Ionicons name="person-circle-outline" size={18} color={ADMIN_THEME.muted} />
              <Text style={styles.accountButtonText}>Account settings</Text>
              <Ionicons name="chevron-forward" size={15} color={ADMIN_THEME.muted} />
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={detailsEvent !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setDetailsEventId(null);
          setShowDetailsQr(false);
        }}
      >
        <View style={[styles.modalBackdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: isNarrow ? 12 : SPACE.lg }]}>
          <ScrollView contentContainerStyle={styles.modalScrollContent}>
            {detailsEvent && (
              <View style={styles.detailsCard}>
                <View style={styles.detailsHeader}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.sectionCaption}>EVENT DETAILS</Text>
                    <Text style={styles.detailsTitle}>{detailsEvent.title}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close event details"
                    onPress={() => {
                      setDetailsEventId(null);
                      setShowDetailsQr(false);
                    }}
                    style={styles.modalCloseButton}
                  >
                    <Ionicons name="close" size={20} color={COLORS.textPrimary} />
                  </Pressable>
                </View>
                <Text style={styles.detailsLabel}>Event code</Text>
                <Text style={styles.detailsValue}>{detailsEvent.event_code}</Text>
                <Text style={styles.detailsLabel}>Date and start</Text>
                <Text style={styles.detailsValue}>{formatDate(detailsEvent.start_time)}</Text>
                <Text style={styles.detailsLabel}>End</Text>
                <Text style={styles.detailsValue}>{formatDate(detailsEvent.end_time)}</Text>
                <Text style={styles.detailsLabel}>Venue</Text>
                <Text style={styles.detailsValue}>{detailsEvent.venue?.trim() || 'Not provided'}</Text>
                <Text style={styles.detailsLabel}>Description</Text>
                <Text style={styles.detailsValue}>{detailsEvent.description?.trim() || 'No description provided.'}</Text>
                <Text style={styles.detailsLabel}>Status</Text>
                <Text style={styles.detailsValue}>{detailsEvent.archived_at ? 'Archived' : eventDisplayStatus(detailsEvent)}</Text>
                <View style={styles.detailsActions}>
                  {!detailsEvent.archived_at && (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.detailsActionButton}
                      onPress={() => setShowDetailsQr((visible) => !visible)}
                    >
                      <Ionicons name="qr-code-outline" size={17} color="#FFFFFF" />
                      <Text style={styles.detailsActionText}>{showDetailsQr ? 'Hide QR Code' : 'View QR Code'}</Text>
                    </Pressable>
                  )}
                  {!detailsEvent.archived_at && (
                    <Pressable
                      accessibilityRole="button"
                      style={[styles.detailsActionButton, styles.detailsSecondaryButton]}
                      onPress={() => {
                        beginEventEdit(detailsEvent);
                        setDetailsEventId(null);
                        setShowDetailsQr(false);
                      }}
                    >
                      <Ionicons name="create-outline" size={17} color={COLORS.primary} />
                      <Text style={[styles.detailsActionText, styles.detailsSecondaryText]}>Edit event</Text>
                    </Pressable>
                  )}
                </View>
                {showDetailsQr && !detailsEvent.archived_at && (
                  <View style={styles.detailsQrContainer}>
                    <View style={styles.qrBox}>
                      <QRCode
                        value={buildQRPayload({
                          eventId: detailsEvent.event_code,
                          title: detailsEvent.title,
                          start: detailsEvent.start_time ?? undefined,
                          end: detailsEvent.end_time ?? undefined,
                        })}
                        size={220}
                      />
                    </View>
                    <Text style={styles.detailsQrEventTitle}>{detailsEvent.title}</Text>
                    <Text style={styles.detailsQrEventCode}>Event code: {detailsEvent.event_code}</Text>
                    <Text style={styles.detailsQrInstruction}>Scan this QR code with the Scan tab.</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function CenterState({ icon, text, loading = false }: { icon: keyof typeof Ionicons.glyphMap; text: string; loading?: boolean }) {
  return <View style={styles.center}><View style={styles.deniedCard}>{loading ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name={icon} size={25} color={COLORS.primary} />}<Text style={styles.subtitle}>{text}</Text></View></View>;
}

function Summary({ value, label, icon, mobile, narrow }: { value: number; label: string; icon: keyof typeof Ionicons.glyphMap; mobile: boolean; narrow: boolean }) {
  return <View style={[styles.summaryCard, mobile && styles.mobileSummaryCard, narrow && styles.singleColumnSummaryCard]}><Ionicons name={icon} size={18} color={COLORS.primary} /><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function Empty({ text }: { text: string }) {
  return <View style={styles.empty}><Ionicons name="file-tray-outline" size={20} color={COLORS.textMuted} /><Text style={styles.helper}>{text}</Text></View>;
}

function Notice({ tone, text }: { tone: 'error' | 'success'; text: string }) {
  return <View style={[styles.notice, tone === 'error' ? styles.noticeError : styles.noticeSuccess]}><Text style={styles.noticeText}>{text}</Text></View>;
}

function Pagination({ page, hasMore, onChange, light = false }: { page: number; hasMore: boolean; onChange: (page: number) => void; light?: boolean }) {
  if (page === 0 && !hasMore) return null;
  return (
    <View style={[styles.pagination, light && styles.auditPagination]}>
      <Pressable disabled={page === 0} onPress={() => onChange(page - 1)} style={[styles.pageButton, light && styles.auditPageButton, page === 0 && styles.pageButtonDisabled]}>
        <Text style={[styles.outlineButtonText, light && styles.auditPageButtonText]}>Previous</Text>
      </Pressable>
      <Text style={[styles.helper, light && styles.auditMeta]}>Page {page + 1}</Text>
      <Pressable disabled={!hasMore} onPress={() => onChange(page + 1)} style={[styles.pageButton, light && styles.auditPageButton, !hasMore && styles.pageButtonDisabled]}>
        <Text style={[styles.outlineButtonText, light && styles.auditPageButtonText]}>Next</Text>
      </Pressable>
    </View>
  );
}

function formatDate(value: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

function eventDisplayStatus(event: AdminEvent): 'Active' | 'Upcoming' | 'Closed' {
  if (event.event_status === 'closed') return 'Closed';
  const now = Date.now();
  const end = event.end_time ? Date.parse(event.end_time) : Number.NaN;
  if (Number.isFinite(end) && end <= now) return 'Closed';
  const start = event.start_time ? Date.parse(event.start_time) : Number.NaN;
  return Number.isFinite(start) && start > now ? 'Upcoming' : 'Active';
}

function sectionTitle(section: AdminSection) {
  return SECTIONS.find((item) => item.id === section)?.label ?? 'Overview';
}

function sectionSubtitle(section: AdminSection) {
  const descriptions: Record<AdminSection, string> = {
    overview: 'A live view of people, events, and campus activity.',
    teacherRequests: 'Review and manage teacher access requests.',
    users: 'Browse student and teacher accounts and manage app roles.',
    events: 'Review ownership, schedules, and supported event actions.',
    attendance: 'Inspect attendance records and audit corrections.',
    audit: 'Review protected administrative activity.',
    adminAccess: 'Manage administrator membership.',
  };
  return descriptions[section];
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  attendance_correction: 'Attendance Corrected',
  event_archived: 'Event Archived',
  event_closed: 'Event Closed',
  event_created: 'Event Created',
  event_restored: 'Event Restored',
  event_updated: 'Event Updated',
  initial_admin_membership_granted: 'Initial Administrator Access Granted',
  admin_membership_granted: 'Administrator Access Granted',
  admin_membership_revoked: 'Administrator Access Revoked',
  teacher_request_approved: 'Teacher Access Request Approved',
  teacher_request_cancelled: 'Teacher Access Request Cancelled',
  teacher_request_declined: 'Teacher Access Request Rejected',
  teacher_request_rejected: 'Teacher Access Request Rejected',
  teacher_request_submitted: 'Teacher Access Request Submitted',
  teacher_request_withdrawn: 'Teacher Access Request Withdrawn',
};

function formatAuditAction(action: unknown): string {
  if (typeof action !== 'string' || !action.trim()) return 'Administrative activity';
  const normalized = action.trim();
  if (Object.prototype.hasOwnProperty.call(AUDIT_ACTION_LABELS, normalized)) {
    return AUDIT_ACTION_LABELS[normalized];
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isAuditRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAuditRecord(value: unknown): Record<string, unknown> | null {
  return isAuditRecord(value) ? value : null;
}

function getAuditText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type AuditStatus = 'Pending' | 'Approved' | 'Rejected' | 'Withdrawn' | 'Cancelled';

function getAuditStatus(value: unknown): AuditStatus | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase()) {
    case 'pending': return 'Pending';
    case 'approved': return 'Approved';
    case 'declined':
    case 'rejected': return 'Rejected';
    case 'withdrawn': return 'Withdrawn';
    case 'cancelled':
    case 'canceled': return 'Cancelled';
    default: return null;
  }
}

function auditStatusStyle(status: AuditStatus) {
  switch (status) {
    case 'Pending': return styles.auditStatusPending;
    case 'Approved': return styles.auditStatusApproved;
    case 'Rejected': return styles.auditStatusRejected;
    case 'Withdrawn':
    case 'Cancelled': return styles.auditStatusNeutral;
  }
}

function auditStatusTextStyle(status: AuditStatus) {
  switch (status) {
    case 'Pending': return styles.auditStatusPendingText;
    case 'Approved': return styles.auditStatusApprovedText;
    case 'Rejected': return styles.auditStatusRejectedText;
    case 'Withdrawn':
    case 'Cancelled': return styles.auditStatusNeutralText;
  }
}

function findAuditActorName(actorId: unknown, users: AdminUser[], members: AdminMember[]): string | null {
  if (typeof actorId !== 'string' || !actorId) return null;
  return users.find((actor) => actor.id === actorId)?.full_name?.trim()
    || members.find((actor) => actor.user_id === actorId)?.full_name?.trim()
    || null;
}

function shortenIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatAuditSnapshot(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return 'Snapshot could not be formatted.';
  }
}

function formatRelativeDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  const deltaMinutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (deltaMinutes < 1) return 'Just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  shell: { flex: 1, flexDirection: 'row', backgroundColor: ADMIN_THEME.background },
  sidebar: { width: 258, backgroundColor: ADMIN_THEME.sidebar, borderRightWidth: 1, borderRightColor: ADMIN_THEME.border, paddingHorizontal: 18, paddingTop: 28, paddingBottom: 18 },
  workspace: { flex: 1, minWidth: 0, backgroundColor: ADMIN_THEME.background },
  mobileBrand: { minHeight: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.md, paddingBottom: SPACE.sm, borderBottomWidth: 1, borderBottomColor: ADMIN_THEME.border },
  mobileHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mobileMenuBackdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(4,3,8,0.68)' },
  mobileMenu: { width: '84%', maxWidth: 360, backgroundColor: ADMIN_THEME.sidebar, paddingHorizontal: SPACE.md, borderRightWidth: 1, borderRightColor: ADMIN_THEME.border },
  mobileMenuHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: SPACE.md, borderBottomWidth: 1, borderBottomColor: ADMIN_THEME.border },
  mobileMenuButton: { minHeight: 54, marginBottom: 4 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: ADMIN_THEME.accentStrong },
  brandName: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 18, letterSpacing: 1.2, color: ADMIN_THEME.text },
  brandCaption: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 10, letterSpacing: 1.5, color: ADMIN_THEME.muted, marginTop: 2 },
  sidebarCaption: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 11, letterSpacing: 1.4, color: ADMIN_THEME.muted, marginTop: 42, marginBottom: 12, paddingHorizontal: 9 },
  sidebarNav: { gap: 5 },
  sidebarButton: { minHeight: 47, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 11, borderRadius: 12 },
  sidebarButtonActive: { backgroundColor: ADMIN_THEME.surfaceRaised },
  sidebarButtonText: { flex: 1, fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 14, color: ADMIN_THEME.muted },
  sidebarButtonTextActive: { color: ADMIN_THEME.text },
  sidebarBadge: { color: '#FFFFFF', backgroundColor: ADMIN_THEME.accentStrong, overflow: 'hidden', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2, fontSize: 11, fontFamily: TYPOGRAPHY.semiboldFontFamily },
  sidebarFooter: { marginTop: 'auto', borderTopWidth: 1, borderTopColor: ADMIN_THEME.border, paddingTop: 17 },
  adminIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15 },
  identityAvatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: ADMIN_THEME.accentTint },
  identityCopy: { flex: 1, minWidth: 0 },
  identityName: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 13, color: ADMIN_THEME.text },
  identityEmail: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, color: ADMIN_THEME.muted, marginTop: 2 },
  accountButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  accountButtonText: { flex: 1, fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 12, color: ADMIN_THEME.muted },
  mainScroll: { flex: 1 },
  desktopContent: { maxWidth: 1300, paddingTop: 34, paddingHorizontal: 38 },
  content: { padding: SPACE.lg, paddingBottom: 60, width: '100%', maxWidth: 900, alignSelf: 'center' },
  mobileContent: { padding: SPACE.sm },
  narrowContent: { paddingHorizontal: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg },
  mobilePageHeader: { flexDirection: 'column', alignItems: 'stretch', gap: SPACE.sm },
  mobilePageActions: { flexWrap: 'wrap', justifyContent: 'flex-end', alignSelf: 'flex-end' },
  pageSubtitle: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 21, color: COLORS.textSecondary, marginTop: 4 },
  verifiedPill: { minHeight: 33, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: 20, paddingHorizontal: 11, backgroundColor: COLORS.glassStrong },
  verifiedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ADMIN_THEME.success },
  verifiedText: { fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 12, color: COLORS.textSecondary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { ...TYPOGRAPHY.label, fontSize: 14, lineHeight: 20, color: COLORS.champagne, fontFamily: TYPOGRAPHY.semiboldFontFamily },
  title: { ...TYPOGRAPHY.screenTitle, color: COLORS.textPrimary, fontFamily: TYPOGRAPHY.displayFontFamily, marginTop: 5 },
  subtitle: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 16, lineHeight: 24, color: COLORS.textSecondary, textAlign: 'center', marginTop: 12 },
  headerIcon: { width: 46, height: 46, borderRadius: 16, backgroundColor: COLORS.glassStrong, borderColor: COLORS.glassBorder, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 13, marginBottom: SPACE.md },
  summaryCard: { flexGrow: 1, flexBasis: '22%', minWidth: 150, backgroundColor: COLORS.glassStrong, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.glassBorder, padding: 17 },
  mobileSummaryCard: { flexBasis: '47%', minWidth: 0, padding: 12 },
  singleColumnSummaryCard: { flexBasis: '100%' },
  summaryValue: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 27, color: COLORS.textPrimary, marginTop: 11 },
  summaryLabel: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 19, color: COLORS.textSecondary, marginTop: 2 },
  card: { backgroundColor: COLORS.glassStrong, borderRadius: RADIUS.xl, padding: SPACE.lg, borderWidth: 1, borderColor: COLORS.glassBorder, marginBottom: SPACE.md },
  mobileCard: { padding: SPACE.md, borderRadius: RADIUS.lg },
  cardTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 21, color: COLORS.textPrimary, marginBottom: 10 },
  helper: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 15, lineHeight: 23, color: COLORS.textSecondary, flexShrink: 1 },
  searchRow: { flexDirection: 'row', gap: 8, marginVertical: 13 },
  input: { minHeight: 50, flex: 1, minWidth: 0, borderRadius: 13, backgroundColor: ADMIN_THEME.surfaceRaised, borderWidth: 1, borderColor: COLORS.glassBorder, paddingHorizontal: 12, color: COLORS.textPrimary, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 15, marginTop: 8 },
  filterDateInput: { minWidth: 0 },
  searchButton: { marginTop: 8, width: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 13, borderTopWidth: 1, borderTopColor: COLORS.glassBorder },
  stackedListRow: { flexDirection: 'column' },
  rowCopy: { flex: 1, gap: 3 },
  eventDetailsCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 16, lineHeight: 23, color: COLORS.textPrimary },
  rowMeta: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 21, color: COLORS.textSecondary, flexShrink: 1 },
  roleActions: { gap: 5 },
  mobileRoleActions: { flexDirection: 'row', flexWrap: 'wrap' },
  rolePill: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  rolePillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rolePillText: { fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 14, color: COLORS.textPrimary },
  rolePillTextActive: { color: '#FFFFFF' },
  iconAction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 10, borderRadius: 12, backgroundColor: COLORS.primaryTint },
  eventActions: { alignItems: 'center', gap: 5 },
  mobileEventActions: { flexDirection: 'row', alignSelf: 'flex-end' },
  viewDetailsButton: { minHeight: 50, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: SPACE.sm, paddingHorizontal: SPACE.md, borderRadius: 14, backgroundColor: COLORS.primary, borderWidth: 1, borderColor: COLORS.primarySoft },
  viewDetailsButtonPressed: { opacity: 0.86 },
  viewDetailsButtonText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 16, color: '#FFFFFF' },
  modalBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(12,18,35,0.62)', padding: SPACE.lg },
  modalScrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: SPACE.lg },
  detailsCard: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: SPACE.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.glassStrong, borderWidth: 1, borderColor: COLORS.glassBorder },
  detailsHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACE.md },
  detailsTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 21, lineHeight: 27, color: COLORS.textPrimary, marginTop: 4 },
  modalCloseButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center' },
  detailsLabel: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, color: COLORS.textSecondary, marginTop: SPACE.sm },
  detailsValue: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 16, lineHeight: 24, color: COLORS.textPrimary, marginTop: 3, flexShrink: 1 },
  detailsActions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.lg },
  detailsActionButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: SPACE.md, borderRadius: 14, backgroundColor: COLORS.primary },
  detailsActionText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, color: '#FFFFFF' },
  detailsSecondaryButton: { backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.glassBorder },
  detailsSecondaryText: { color: COLORS.primary },
  detailsQrContainer: { alignItems: 'center', marginTop: SPACE.lg },
  qrBox: { backgroundColor: '#FFFFFF', padding: SPACE.md, borderRadius: 24, borderWidth: 1, borderColor: COLORS.glassBorder },
  detailsQrEventTitle: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 18, lineHeight: 25, color: COLORS.textPrimary, textAlign: 'center', marginTop: SPACE.sm },
  detailsQrEventCode: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 16, color: COLORS.textSecondary, textAlign: 'center', marginTop: 4 },
  detailsQrInstruction: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 16, color: COLORS.textPrimary, textAlign: 'center', lineHeight: 24, marginTop: SPACE.md },
  stateTag: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 9, paddingVertical: 7, paddingHorizontal: 10, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 14, color: COLORS.primary, backgroundColor: COLORS.primaryTint, marginTop: 5 },
  stateArchived: { color: COLORS.textSecondary, backgroundColor: COLORS.glassStrong },
  stateActive: { color: COLORS.success },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 10 },
  filterPill: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 12 },
  filterPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 14, color: COLORS.textPrimary },
  filterTextActive: { color: '#FFFFFF' },
  outlineButton: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14, marginTop: 9 },
  outlineButtonText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, color: COLORS.primary },
  recordCard: { paddingVertical: 13, borderTopWidth: 1, borderTopColor: COLORS.glassBorder },
  recordHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  correctionForm: { paddingTop: 10, gap: 4 },
  reasonInput: { minHeight: 74, textAlignVertical: 'top', paddingTop: 10 },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
  mobileActionRow: { flexWrap: 'wrap', justifyContent: 'flex-start' },
  stackedRow: { flexDirection: 'column' },
  primaryButton: { minHeight: 48, justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, marginTop: 9 },
  primaryButtonText: { color: '#FFFFFF', fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15 },
  sectionCaption: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, color: COLORS.primary, marginTop: 12, marginBottom: 7 },
  reportRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.glassBorder },
  reportValue: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 15, color: COLORS.textPrimary },
  reportEntry: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.glassBorder, gap: 3 },
  auditCard: { backgroundColor: SYNCRA_COLORS.glassStrong, borderColor: SYNCRA_COLORS.glassBorder },
  auditCardTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 20, lineHeight: 26, color: SYNCRA_COLORS.textPrimary },
  auditIntro: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, lineHeight: 19, color: SYNCRA_COLORS.textSecondary, marginBottom: 5 },
  auditEntry: { marginTop: 10, padding: 13, borderRadius: 18, backgroundColor: SYNCRA_COLORS.surface, borderWidth: 1, borderColor: SYNCRA_COLORS.glassBorder, gap: 7 },
  auditEntryHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  auditTitleCopy: { flex: 1, minWidth: 0, gap: 2 },
  auditAction: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 15, lineHeight: 21, color: SYNCRA_COLORS.textPrimary },
  auditMeta: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 12, lineHeight: 17, color: SYNCRA_COLORS.textSecondary, flexShrink: 1 },
  auditDetailRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  auditActorId: { fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 12, color: SYNCRA_COLORS.primary },
  auditIdentifier: { flexShrink: 1, fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 12, lineHeight: 17, color: SYNCRA_COLORS.textPrimary },
  auditReason: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, lineHeight: 19, color: SYNCRA_COLORS.textPrimary },
  auditReasonLabel: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: SYNCRA_COLORS.textSecondary },
  auditStatus: { borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  auditStatusText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 11, lineHeight: 15 },
  auditStatusPending: { backgroundColor: 'rgba(183,123,50,0.10)', borderColor: 'rgba(183,123,50,0.24)' },
  auditStatusPendingText: { color: SYNCRA_COLORS.warning },
  auditStatusApproved: { backgroundColor: 'rgba(37,136,117,0.10)', borderColor: 'rgba(37,136,117,0.22)' },
  auditStatusApprovedText: { color: SYNCRA_COLORS.success },
  auditStatusRejected: { backgroundColor: 'rgba(201,79,101,0.10)', borderColor: 'rgba(201,79,101,0.22)' },
  auditStatusRejectedText: { color: SYNCRA_COLORS.danger },
  auditStatusNeutral: { backgroundColor: SYNCRA_COLORS.backgroundDeep, borderColor: SYNCRA_COLORS.glassBorder },
  auditStatusNeutralText: { color: SYNCRA_COLORS.textSecondary },
  auditDetailsToggle: { minHeight: 34, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  auditDetailsToggleText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 12, color: SYNCRA_COLORS.primary },
  auditTechnicalDetails: { padding: 10, borderRadius: 13, backgroundColor: SYNCRA_COLORS.backgroundDeep, gap: 5 },
  auditSnapshotLabel: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 12, color: SYNCRA_COLORS.textPrimary, marginTop: 4 },
  auditSnapshotValue: { flexShrink: 1, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, lineHeight: 16, color: SYNCRA_COLORS.textSecondary },
  auditEmpty: { minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 12 },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.glassBorder, paddingTop: 10, marginTop: 8 },
  auditPagination: { borderTopColor: SYNCRA_COLORS.glassBorder },
  pageButton: { borderWidth: 1, borderColor: COLORS.primary, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 10 },
  auditPageButton: { borderColor: SYNCRA_COLORS.primary },
  auditPageButtonText: { color: SYNCRA_COLORS.primary },
  pageButtonDisabled: { opacity: 0.38 },
  empty: { minHeight: 70, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 12 },
  notice: { borderRadius: 13, padding: 11, marginBottom: 10, borderWidth: 1 },
  noticeError: { backgroundColor: 'rgba(201,79,101,0.10)', borderColor: 'rgba(201,79,101,0.24)' },
  noticeSuccess: { backgroundColor: 'rgba(40,150,110,0.10)', borderColor: 'rgba(40,150,110,0.22)' },
  noticeText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 15, lineHeight: 23, color: COLORS.textPrimary },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 9, justifyContent: 'center', paddingVertical: 12 },
  footer: { textAlign: 'center', fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 21, color: COLORS.textSecondary, paddingTop: 9 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, padding: SPACE.lg },
  deniedCard: { alignItems: 'center', justifyContent: 'center', padding: SPACE.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.glassStrong, borderWidth: 1, borderColor: COLORS.glassBorder },
  lockIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center' },
  hint: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 14, lineHeight: 21, color: COLORS.textSecondary, textAlign: 'center', marginTop: 10 },
  dashboardColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' },
  dashboardPanel: { flexGrow: 1, flexBasis: 390, marginBottom: 0 },
  dashboardWidePanel: { flexBasis: '100%', marginBottom: 0 },
  stackedDashboardColumns: { flexDirection: 'column' },
  mobileDashboardPanel: { width: '100%', flexGrow: 0, flexBasis: 'auto' },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 9 },
  panelLink: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5 },
  panelLinkText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 12, color: ADMIN_THEME.accent },
  dashboardRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.glassBorder },
  dashboardRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  requestAvatar: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ADMIN_THEME.accentTint },
  activityIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(88,201,232,0.12)' },
  dashboardDate: { fontFamily: TYPOGRAPHY.mediumFontFamily, fontSize: 11, color: ADMIN_THEME.muted },
  eventSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.glassBorder },
  stackedEventSummaryRow: { flexDirection: 'column', alignItems: 'flex-start' },
  eventSummaryMain: { flex: 1, minWidth: 0, gap: 4 },
  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: SPACE.md },
  shortcutCard: { minHeight: 64, flexGrow: 1, flexBasis: 160, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: 14, paddingHorizontal: 12, backgroundColor: COLORS.glassStrong },
  mobileShortcutCard: { flexBasis: '47%', minWidth: 0 },
  singleColumnShortcut: { flexBasis: '100%' },
  shortcutIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: ADMIN_THEME.accentTint },
  shortcutLabel: { flex: 1, fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 13, color: COLORS.textPrimary },
});
