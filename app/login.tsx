import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import AmbientBackground from '@/components/AmbientBackground';
import AppButton from '@/components/AppButton';
import EntranceView from '@/components/EntranceView';
import { COLORS, RADIUS, SPACE } from '@/constants/colors';
import { TYPOGRAPHY } from '@/constants/typography';
import { signIn } from '@/lib/auth';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const compactLayout = windowHeight <= 700;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const logoGlow = useRef(new Animated.Value(0)).current;
  const emailFocusProgress = useRef(new Animated.Value(0)).current;
  const passwordFocusProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    let animation: Animated.CompositeAnimation | undefined;
    const setMotion = (reduced: boolean) => {
      animation?.stop();
      if (reduced) {
        logoGlow.setValue(0);
        return;
      }
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(logoGlow, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(logoGlow, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      );
      animation.start();
    };
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (mounted) setMotion(reduced);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setMotion);
    return () => {
      mounted = false;
      animation?.stop();
      subscription.remove();
    };
  }, [logoGlow]);

  const handleLogin = async () => {
    setError(null); setLoading(true);
    try {
      const { error: authError } = await signIn(email.trim(), password);
      if (authError) setError(authError.message);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Unexpected error'); }
    finally { setLoading(false); }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <AmbientBackground variant="compact" graphicSide="right" />
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <EntranceView>
            <View style={styles.brandBar}>
              <Animated.View style={[styles.brandIcon, { transform: [{ scale: logoGlow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }] }]}>
                <Ionicons name="scan-outline" size={21} color="#FFFFFF" />
              </Animated.View>
              <View>
                <Text style={styles.wordmark}>SYNCRA</Text>
                <Text style={styles.brandCaption}>CCTC CAMPUS ATTENDANCE SYSTEM</Text>
                <Text style={styles.brandTagline}>CAMPUS, IN SYNC</Text>
              </View>
              <View style={styles.brandSecure}><Ionicons name="shield-checkmark" size={16} color={COLORS.primary} /></View>
            </View>
          </EntranceView>

          <View style={styles.authPanel}>
          <EntranceView delay={70}>
            <View style={[styles.heroStage, { minHeight: compactLayout ? 190 : 226 }]}>
              <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
                <Defs>
                  <LinearGradient id="loginHero" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor="#2F65EC" />
                    <Stop offset="58%" stopColor="#3F62D9" />
                    <Stop offset="100%" stopColor="#7059D9" />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" rx="30" fill="url(#loginHero)" />
                <Circle cx="94%" cy="8%" r="76" fill="#FFFFFF" fillOpacity="0.08" />
                <Circle cx="100%" cy="95%" r="102" fill="#AFC1FF" fillOpacity="0.14" />
                <Circle cx="4%" cy="100%" r="72" fill="#61CFC5" fillOpacity="0.18" />
              </Svg>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>SMART ATTENDANCE, SIMPLIFIED</Text>
                <Text style={styles.heroTitle}>Your day.{'\n'}Already in sync.</Text>
                <Text style={styles.heroText}>A quicker way to show up, stay on track, and keep your campus life moving.</Text>
              </View>
              <View style={styles.heroOrbit}>
                <View style={styles.heroOrbitHalo} />
                <View style={styles.heroScanTile}>
                  <View style={[styles.heroCorner, styles.heroCornerTL]} />
                  <View style={[styles.heroCorner, styles.heroCornerTR]} />
                  <View style={[styles.heroCorner, styles.heroCornerBL]} />
                  <View style={[styles.heroCorner, styles.heroCornerBR]} />
                  <Ionicons name="qr-code" size={45} color="#FFFFFF" />
                </View>
                <View style={styles.heroCheck}><Ionicons name="checkmark" size={14} color={COLORS.primary} /></View>
              </View>
              <View style={styles.heroPill}><View style={styles.heroPillDot} /><Text style={styles.heroPillText}>FAST CHECK-IN</Text></View>
            </View>
          </EntranceView>

          <EntranceView delay={140}>
            <View style={styles.formCard}>
              <View style={styles.formHeadingRow}>
                <View>
                  <Text style={styles.formEyebrow}>WELCOME BACK</Text>
                  <Text style={styles.formTitle}>Sign in to SYNCRA</Text>
                </View>
                <View style={styles.formMark}><Ionicons name="arrow-down" size={18} color={COLORS.primary} /></View>
              </View>
              <Text style={styles.formSubtitle}>Use your school account to pick up where you left off.</Text>
              <Text style={styles.label}>SCHOOL EMAIL</Text>
              <View style={styles.inputShell}><Ionicons name="mail-outline" size={18} color={emailFocused ? COLORS.primary : COLORS.textMuted} /><TextInput onFocus={() => { setEmailFocused(true); Animated.timing(emailFocusProgress, { toValue: 1, duration: 180, useNativeDriver: true }).start(); }} onBlur={() => { setEmailFocused(false); Animated.timing(emailFocusProgress, { toValue: 0, duration: 180, useNativeDriver: true }).start(); }} style={styles.input} value={email} onChangeText={setEmail} placeholder="your.email@school.edu" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" keyboardType="email-address" editable={!loading} /><Animated.View pointerEvents="none" style={[styles.focusOutline, { opacity: emailFocusProgress }]} /></View>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.inputShell}><Ionicons name="lock-closed-outline" size={18} color={passwordFocused ? COLORS.primary : COLORS.textMuted} /><TextInput onFocus={() => { setPasswordFocused(true); Animated.timing(passwordFocusProgress, { toValue: 1, duration: 180, useNativeDriver: true }).start(); }} onBlur={() => { setPasswordFocused(false); Animated.timing(passwordFocusProgress, { toValue: 0, duration: 180, useNativeDriver: true }).start(); }} style={styles.input} value={password} onChangeText={setPassword} placeholder="Enter your password" placeholderTextColor={COLORS.textMuted} secureTextEntry editable={!loading} /></View>
              {error && <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={17} color={COLORS.danger} /><Text style={styles.error}>{error}</Text></View>}
              {loading ? <View style={styles.loader}><ActivityIndicator size="small" color={COLORS.primary} /></View> : <View style={styles.primaryAction}><AppButton theme="primary" title="Sign In" icon="arrow-forward-outline" onPress={handleLogin} /></View>}
              <View style={styles.formFoot}><Ionicons name="lock-closed" size={12} color={COLORS.textMuted} /><Text style={styles.formFootText}>Your account stays private and secure</Text></View>
            </View>
          </EntranceView>
          </View>
          <EntranceView delay={220}>
            <Link href="/register" style={styles.link}>New to SYNCRA? <Text style={styles.linkStrong}>Create an account</Text></Link>
          </EntranceView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 18 },
  brandBar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  brandIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 11, shadowColor: COLORS.primary, shadowOpacity: 0.22, shadowRadius: 11, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  wordmark: { fontFamily: TYPOGRAPHY.displayFontFamily, fontSize: 16, color: COLORS.textPrimary, letterSpacing: 1.2 },
  brandCaption: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 8, color: COLORS.textMuted, letterSpacing: 1.15, marginTop: 1 },
  brandTagline: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 7, color: COLORS.textMuted, letterSpacing: 0.9, marginTop: 1 },
  brandSecure: { marginLeft: 'auto', width: 38, height: 38, borderRadius: 14, backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center' },
  authPanel: { width: '100%', maxWidth: 540, alignSelf: 'center', marginBottom: 8, borderRadius: 30, overflow: 'hidden', backgroundColor: COLORS.glassStrong, borderWidth: 1, borderColor: '#FFFFFF', shadowColor: '#203A78', shadowOpacity: 0.13, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  heroStage: { borderRadius: 0, overflow: 'hidden', padding: 22, justifyContent: 'center', backgroundColor: COLORS.primary },
  heroCopy: { maxWidth: '68%', zIndex: 1 },
  heroEyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 8, color: 'rgba(255,255,255,0.76)', letterSpacing: 1.15, marginBottom: 12 },
  heroTitle: { fontFamily: TYPOGRAPHY.displayFontFamily, fontSize: 30, lineHeight: 34, color: '#FFFFFF', letterSpacing: -0.8 },
  heroText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, lineHeight: 16, color: 'rgba(255,255,255,0.78)', marginTop: 10, maxWidth: 200 },
  heroOrbit: { position: 'absolute', right: -13, top: 39, width: 142, height: 142, alignItems: 'center', justifyContent: 'center' },
  heroOrbitHalo: { position: 'absolute', width: 136, height: 136, borderRadius: 68, borderWidth: 1, borderColor: 'rgba(255,255,255,0.26)', backgroundColor: 'rgba(255,255,255,0.08)' },
  heroScanTile: { width: 92, height: 92, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.36)', alignItems: 'center', justifyContent: 'center' },
  heroCorner: { position: 'absolute', width: 16, height: 16, borderColor: '#FFFFFF' },
  heroCornerTL: { top: 12, left: 12, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 5 },
  heroCornerTR: { top: 12, right: 12, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 5 },
  heroCornerBL: { bottom: 12, left: 12, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 5 },
  heroCornerBR: { bottom: 12, right: 12, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 5 },
  heroCheck: { position: 'absolute', right: 14, top: 13, width: 29, height: 29, borderRadius: 15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  heroPill: { position: 'absolute', right: 17, bottom: 17, flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: 9, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.17)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  heroPillDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#7DE0C7', marginRight: 5 },
  heroPillText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 7, letterSpacing: 0.7, color: '#FFFFFF' },
  formCard: { marginHorizontal: 0, padding: 21, borderRadius: 0, backgroundColor: COLORS.glassStrong },
  formHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formEyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary, fontSize: 8, letterSpacing: 1.1, marginBottom: 3 },
  formMark: { width: 34, height: 34, borderRadius: 13, backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center' },
  formTitle: { fontFamily: TYPOGRAPHY.displayFontFamily, fontSize: 21, color: COLORS.textPrimary, letterSpacing: -0.35 },
  formSubtitle: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, lineHeight: 16, color: COLORS.textSecondary, marginTop: 5 },
  label: { ...TYPOGRAPHY.label, fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.textSecondary, marginTop: 18, marginBottom: 7, fontSize: 9, letterSpacing: 0.7 },
  inputShell: { minHeight: 54, borderRadius: 16, backgroundColor: '#F6F8FD', borderWidth: 1, borderColor: COLORS.pearlBorder, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', position: 'relative' },
  focusOutline: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.primary },
  input: { flex: 1, marginLeft: 9, paddingVertical: 0, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, color: COLORS.pearlText },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 17, padding: 12, borderRadius: 17, backgroundColor: 'rgba(201,79,101,0.10)', borderWidth: 1, borderColor: 'rgba(201,79,101,0.24)' },
  error: { flex: 1, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 12, lineHeight: 18, color: COLORS.danger },
  loader: { minHeight: 64, alignItems: 'center', justifyContent: 'center', marginTop: 17 },
  primaryAction: { marginTop: 17, marginBottom: 2 },
  formFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 9 },
  formFootText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 9, color: COLORS.textMuted },
  link: { alignSelf: 'center', fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, color: COLORS.textSecondary, textAlign: 'center', marginTop: 12, paddingVertical: 8 },
  linkStrong: { fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.primary },
});
