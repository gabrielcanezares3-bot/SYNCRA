import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { COLORS } from '@/constants/colors';
import { TYPOGRAPHY } from '@/constants/typography';
import { checkAdministratorAccess } from '@/lib/admin';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

function TabIcon({ focused, color, name }: { focused: boolean; color: string; name: keyof typeof Ionicons.glyphMap }) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(focused ? 1 : 0);
      return;
    }
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      tension: 190,
      friction: 14,
      useNativeDriver: true,
    }).start();
  }, [focused, progress, reduceMotion]);

  return (
    <Animated.View style={[styles.tabIcon, { transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }]}>
      <Animated.View pointerEvents="none" style={[styles.activeTrack, { opacity: progress, transform: [{ scaleX: progress }] }]} />
      <Ionicons name={name} color={focused ? '#FFFFFF' : color} size={20} />
      <Animated.View style={[styles.activeDot, { opacity: progress, transform: [{ scale: progress }] }]} />
    </Animated.View>
  );
}

function ScanTabButton({
  onPress,
  accessibilityState,
  compact = false,
  narrow = false,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPress?: (e: any) => void;
  accessibilityState?: { selected?: boolean };
  compact?: boolean;
  narrow?: boolean;
}) {
  const focused = accessibilityState?.selected === true;
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel="Scan"
      onPress={onPress}
      onPressIn={() => {
        if (reduceMotion) return;
        scale.value = withSpring(0.97, { damping: 14, stiffness: 260 });
      }}
      onPressOut={() => {
        if (reduceMotion) {
          scale.value = 1;
          return;
        }
        scale.value = withSpring(1, { damping: 13, stiffness: 220 });
      }}
      style={[styles.scanWrap, compact && styles.scanWrapCompact, pressStyle]}
    >
      <View style={[styles.scanGlow, compact && styles.scanGlowCompact, narrow && styles.scanGlowNarrow, focused && styles.scanGlowActive]} pointerEvents="none" />
      <View style={[styles.scanFab, compact && styles.scanFabCompact, narrow && styles.scanFabNarrow, focused && styles.scanFabActive]}>
        <Ionicons name={focused ? 'scan' : 'scan-outline'} size={compact ? 22 : 28} color="#FFFFFF" />
      </View>
      <Text style={[styles.scanLabel, compact && styles.scanLabelCompact, focused && styles.scanLabelActive]}>SCAN</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  tabBarSurface: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  tabIcon: {
    width: 48,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTrack: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.46)',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  activeDot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  scanWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  scanWrapCompact: { paddingTop: 4 },
  scanGlow: {
    position: 'absolute',
    top: -6,
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: COLORS.primaryTint,
  },
  scanGlowCompact: { top: 0, width: 60, height: 60, borderRadius: 30 },
  scanGlowNarrow: { width: 52, height: 52, borderRadius: 26 },
  scanGlowActive: {
    backgroundColor: COLORS.primaryTint,
  },
  scanFab: {
    marginTop: -30,
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  scanFabCompact: { marginTop: -10, width: 54, height: 54, borderRadius: 27, borderWidth: 1.5 },
  scanFabNarrow: { width: 48, height: 48, borderRadius: 24 },
  scanFabActive: {
    backgroundColor: COLORS.primaryDeep,
    borderColor: '#FFFFFF',
    shadowOpacity: 0.24,
  },
  scanLabel: {
    fontFamily: TYPOGRAPHY.mediumFontFamily,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 1.1,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  scanLabelCompact: { fontSize: 9, letterSpacing: 0.6, marginTop: 1 },
  scanLabelActive: { color: COLORS.primary },
});

export default function TabLayout() {
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<Role | null>(null);
  const [isAdministrator, setIsAdministrator] = useState<boolean | null>(null);
  const isStudentNavigation = isAdministrator === false && role === 'student';
  const isTeacherNavigation = isAdministrator === false && role === 'teacher';

  useEffect(() => {
    if (!session) return;

    let active = true;
    setRole(null);
    setIsAdministrator(null);
    const refreshAccess = () => {
      Promise.allSettled([
        getProfile(session.user.id),
        checkAdministratorAccess(),
      ]).then(([profileResult, adminResult]) => {
        if (!active) return;
        setRole(profileResult.status === 'fulfilled' ? profileResult.value?.role ?? null : null);
        setIsAdministrator(adminResult.status === 'fulfilled' ? adminResult.value : null);
      });
    };
    refreshAccess();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAccess();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [session]);

  const tabOrder = isTeacherNavigation
    ? ['index', 'teacher', 'history', 'notifications', 'profile', 'scan'] as const
    : ['index', 'history', 'scan', 'profile', 'notifications', 'teacher'] as const;

  const renderTab = (name: (typeof tabOrder)[number]) => {
    switch (name) {
      case 'index':
        return <Tabs.Screen key={name} name="index" options={{ title: 'Home' }} />;
      case 'teacher':
        return <Tabs.Screen key={name} name="teacher" options={{ title: isTeacherNavigation ? 'Events' : 'Teacher', href: isTeacherNavigation ? undefined : null }} />;
      case 'history':
        return <Tabs.Screen key={name} name="history" options={{ title: isTeacherNavigation ? 'Attendance' : 'History', href: isAdministrator ? null : undefined }} />;
      case 'scan':
        return (
          <Tabs.Screen
            key={name}
            name="scan"
            options={isAdministrator || isTeacherNavigation
              ? { title: 'Scan', href: null }
              : {
                  title: 'Scan',
                  tabBarButton: (props) => (
                    <ScanTabButton onPress={props.onPress} accessibilityState={props.accessibilityState} compact={isStudentNavigation && width < 400} narrow={isStudentNavigation && width < 350} />
                  ),
                }}
          />
        );
      case 'profile':
        return <Tabs.Screen key={name} name="profile" options={{ title: 'Profile' }} />;
      case 'notifications':
        return (
          <Tabs.Screen
            key={name}
            name="notifications"
            options={{
              title: isTeacherNavigation ? 'Requests' : 'Notifications',
              tabBarAccessibilityLabel: isTeacherNavigation ? 'Recovery requests' : 'Notifications',
              tabBarLabel: isStudentNavigation
                ? ({ color }) => (
                    <Text
                      numberOfLines={2}
                      style={{
                        width: '100%',
                        color,
                        fontFamily: TYPOGRAPHY.mediumFontFamily,
                        fontSize: 8,
                        lineHeight: 9,
                        textAlign: 'center',
                      }}
                    >
                      {width < 350 ? 'Notifi\ncations' : 'Notifications'}
                    </Text>
                  )
                : undefined,
              href: isStudentNavigation || isTeacherNavigation ? undefined : null,
            }}
          />
        );
    }
  };

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: COLORS.background },
        tabBarBackground: () => <View style={styles.tabBarSurface} />,
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: Math.max(insets.bottom, 8) + 8,
          height: 86,
          borderRadius: 26,
          backgroundColor: 'transparent',
          borderWidth: 0,
          borderTopWidth: 0,
          paddingTop: 9,
          paddingBottom: 10,
          paddingHorizontal: 10,
          elevation: 12,
          shadowColor: COLORS.shadow,
          shadowOpacity: 0.12,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          display: isAdministrator === null ? 'none' : 'flex',
        },
        tabBarActiveTintColor: COLORS.textPrimary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarLabelStyle: {
          fontFamily: TYPOGRAPHY.mediumFontFamily,
          fontSize: isStudentNavigation
            ? route.name === 'notifications' ? width < 350 ? 7 : 8 : 10
            : isTeacherNavigation ? width < 400 ? 9 : 11
            : 14,
          letterSpacing: isStudentNavigation
            ? route.name === 'notifications' ? width < 350 ? -0.5 : -0.3 : 0
            : isTeacherNavigation ? 0
            : 0.2,
          marginTop: isStudentNavigation || isTeacherNavigation ? 1 : 3,
        },
        tabBarItemStyle: {
          borderRadius: 24,
          marginHorizontal: isStudentNavigation || isTeacherNavigation ? 0 : 2,
          paddingVertical: 2,
        },
        tabBarIcon: ({ color, focused }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            index: focused ? 'home' : 'home-outline',
            history: focused ? 'time' : 'time-outline',
            profile: focused ? 'person' : 'person-outline',
            notifications: focused ? 'notifications' : 'notifications-outline',
            teacher: focused ? 'school' : 'school-outline',
            admin: focused ? 'shield-checkmark' : 'shield-checkmark-outline',
          };
          if (route.name === 'scan') return null;
          return (
            <TabIcon focused={focused} color={color} name={icons[route.name] ?? 'ellipse-outline'} />
          );
        },
      })}
    >
      {tabOrder.map(renderTab)}
      <Tabs.Screen name="admin" options={{ title: 'Admin', href: isAdministrator ? undefined : null }} />
    </Tabs>
  );
}
