import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import AmbientBackground from '@/components/AmbientBackground';
import AppButton from '@/components/AppButton';
import EntranceView from '@/components/EntranceView';
import { COLORS, RADIUS, SPACE } from '@/constants/colors';
import { TYPOGRAPHY } from '@/constants/typography';
import { signUp } from '@/lib/auth';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const compactLayout = windowHeight <= 700;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setError(null);

    if (
      !fullName.trim() ||
      !email.trim() ||
      !password ||
      !confirmPassword
    ) {
      setError('All fields are required.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError(
        'Password must be at least 6 characters.'
      );
      return;
    }

    setLoading(true);

    try {
      const { data, error: authError } = await signUp(
        email.trim(),
        password,
        {
          full_name: fullName.trim(),
        }
      );

      if (authError) {
        setError(authError.message);
      } else if (data.session) {
        // Email confirmation disabled or already confirmed - session exists
      } else {
        // Email confirmation enabled - no session yet
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <AmbientBackground variant="compact" graphicSide="left" />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 32 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <EntranceView>
            <View style={styles.brandBar}>
              <View style={styles.brandIcon}><Ionicons name="scan-outline" size={21} color="#FFFFFF" /></View>
              <View><Text style={styles.wordmark}>SYNCRA</Text><Text style={styles.brandCaption}>CCTC CAMPUS ATTENDANCE SYSTEM</Text><Text style={styles.brandTagline}>CAMPUS, IN SYNC</Text></View>
              <View style={styles.stepBadge}><Ionicons name="shield-checkmark-outline" size={14} color={COLORS.primary} /><Text style={styles.stepText}>SECURE SIGN UP</Text></View>
            </View>
          </EntranceView>

          <View style={styles.authPanel}>
          <EntranceView delay={65}>
            <View style={[styles.heroStage, { minHeight: compactLayout ? 184 : 188 }]}>
              <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
                <Defs><LinearGradient id="registerHero" x1="0" y1="0" x2="1" y2="1"><Stop offset="0%" stopColor="#315FE8" /><Stop offset="62%" stopColor="#4B68D9" /><Stop offset="100%" stopColor="#9584E9" /></LinearGradient></Defs>
                <Rect width="100%" height="100%" rx="28" fill="url(#registerHero)" />
                <Circle cx="98%" cy="4%" r="76" fill="#FFFFFF" fillOpacity="0.10" />
                <Circle cx="4%" cy="108%" r="82" fill="#B7C8FF" fillOpacity="0.16" />
              </Svg>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>ONE ACCOUNT. YOUR CAMPUS.</Text>
                <Text style={styles.heroTitle}>Make showing up{'\n'}the easy part.</Text>
                <Text style={styles.heroText}>Set up your SYNCRA identity in a moment.</Text>
              </View>
              <View style={styles.heroBadge}><Ionicons name="sparkles" size={15} color="#FFFFFF" /><Text style={styles.heroBadgeText}>WELCOME ABOARD</Text></View>
              <View style={styles.heroStamp}><Ionicons name="checkmark-done" size={28} color="#FFFFFF" /></View>
            </View>
          </EntranceView>

          <EntranceView delay={120}>
          <View style={styles.formCard}>
            <Text style={styles.formEyebrow}>GET STARTED</Text>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>Create your SYNCRA student account, then add your campus details.</Text>

            {success ? (
              <View style={styles.successContainer}>
                <View style={styles.successIcon}><Ionicons name="mail-open-outline" size={24} color={COLORS.primary} /></View>
                <Text style={styles.successTitle}>Check your email!</Text>

                <Text style={styles.successText}>
                  We sent a confirmation link to {email}.
                  Click the link to verify your account,
                  then come back and sign in.
                </Text>

                <Link href="/login" style={styles.link}>
                  Back to Sign In
                </Link>
              </View>
            ) : (
              <View style={styles.form}>
                <Text style={styles.label}>
                  Full Name
                </Text>

                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Enter your full name"
                  placeholderTextColor={
                    COLORS.textSecondary
                  }
                  editable={!loading}
                />

                <Text style={styles.label}>
                  Email
                </Text>

                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your.email@school.edu"
                  placeholderTextColor={
                    COLORS.textSecondary
                  }
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!loading}
                />

                <Text style={styles.label}>
                  Password
                </Text>

                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 6 characters"
                  placeholderTextColor={
                    COLORS.textSecondary
                  }
                  secureTextEntry
                  editable={!loading}
                />

                <Text style={styles.label}>
                  Confirm Password
                </Text>

                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter your password"
                  placeholderTextColor={
                    COLORS.textSecondary
                  }
                  secureTextEntry
                  editable={!loading}
                />

                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.error}>
                      {error}
                    </Text>
                  </View>
                )}

                {loading ? (
                  <View style={[styles.loader, styles.primaryAction]}>
                    <ActivityIndicator
                      size="small"
                      color={COLORS.primary}
                    />
                  </View>
                ) : (
                  <View style={styles.primaryAction}>
                    <AppButton
                      theme="primary"
                      title="Sign Up"
                      icon="person-add-outline"
                      onPress={handleRegister}
                    />
                  </View>
                )}
              </View>
            )}
          </View>
          </EntranceView>
            </View>

            {!success && (
            <EntranceView delay={190}>
            <Link href="/login" style={styles.link}>
              Already have an account? Sign In
            </Link>
            </EntranceView>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 18 },
  brandBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  brandIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  wordmark: { fontFamily: TYPOGRAPHY.displayFontFamily, fontSize: 16, color: COLORS.textPrimary, letterSpacing: 1.2 },
  brandCaption: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 8, color: COLORS.textMuted, letterSpacing: 1.15, marginTop: 1 },
  brandTagline: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 7, color: COLORS.textMuted, letterSpacing: 0.9, marginTop: 1 },
  stepBadge: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.glassBorder },
  stepText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 8, letterSpacing: 0.4, color: COLORS.primary },
  authPanel: { width: '100%', maxWidth: 540, alignSelf: 'center', marginBottom: 8, borderRadius: 28, overflow: 'hidden', backgroundColor: COLORS.glassStrong, borderWidth: 1, borderColor: '#FFFFFF', shadowColor: '#203A78', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  heroStage: { padding: 20, borderRadius: 0, overflow: 'hidden', justifyContent: 'center', backgroundColor: COLORS.primary },
  heroCopy: { maxWidth: '75%', zIndex: 1 },
  heroEyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 8, color: 'rgba(255,255,255,0.76)', letterSpacing: 1.1, marginBottom: 8 },
  heroTitle: { fontFamily: TYPOGRAPHY.displayFontFamily, fontSize: 24, lineHeight: 28, color: '#FFFFFF', letterSpacing: -0.45 },
  heroText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, color: 'rgba(255,255,255,0.80)', marginTop: 7 },
  heroBadge: { position: 'absolute', left: 18, bottom: 13, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 25, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  heroBadgeText: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 7, color: '#FFFFFF', letterSpacing: 0.65 },
  heroStamp: { position: 'absolute', right: 22, top: 48, width: 70, height: 70, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.17)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '9deg' }] },
  formCard: { width: '100%', maxWidth: 540, alignSelf: 'center', padding: 21, borderRadius: 0, backgroundColor: COLORS.glassStrong },
  formEyebrow: { fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 8, letterSpacing: 1.05, color: COLORS.primary, marginBottom: 4 },
  title: { fontFamily: TYPOGRAPHY.displayFontFamily, fontSize: 22, lineHeight: 27, color: COLORS.textPrimary, letterSpacing: -0.45, marginBottom: 2 },
  subtitle: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 11, color: COLORS.textSecondary, lineHeight: 16, marginBottom: 7 },
  form: { width: '100%' },
  label: { ...TYPOGRAPHY.label, fontFamily: TYPOGRAPHY.semiboldFontFamily, color: COLORS.textSecondary, marginTop: 18, marginBottom: 7, fontSize: 9, letterSpacing: 0.65 },
  input: { minHeight: 54, backgroundColor: '#F6F8FD', borderRadius: 15, borderWidth: 1, borderColor: COLORS.pearlBorder, paddingHorizontal: 13, paddingVertical: 12, fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, color: COLORS.pearlText },
  errorBox: { marginTop: 17, padding: 12, borderRadius: 17, backgroundColor: 'rgba(201,79,101,0.10)', borderWidth: 1, borderColor: 'rgba(201,79,101,0.24)' },
  error: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 12, lineHeight: 18, color: COLORS.danger },
  loader: { minHeight: 64, alignItems: 'center', justifyContent: 'center' },
  primaryAction: { marginTop: 18, marginBottom: 2 },
  link: { width: '100%', maxWidth: 540, alignSelf: 'center', fontFamily: TYPOGRAPHY.semiboldFontFamily, fontSize: 11, color: COLORS.primary, textAlign: 'center', marginTop: 16, paddingVertical: 12 },
  successContainer: { padding: SPACE.lg, backgroundColor: COLORS.primaryTint, borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: RADIUS.lg, alignItems: 'center' },
  successIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.sm },
  successTitle: { fontFamily: TYPOGRAPHY.headingFontFamily, fontSize: 21, color: COLORS.textPrimary, marginBottom: SPACE.sm, textAlign: 'center' },
  successText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: SPACE.sm },
});
