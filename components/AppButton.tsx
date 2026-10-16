import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { COLORS, RADIUS, SPACE } from '@/constants/colors';
import { TYPOGRAPHY } from '@/constants/typography';

type Props = { title: string; icon: keyof typeof Ionicons.glyphMap; theme?: 'primary'; disabled?: boolean; centeredContent?: boolean; createEventSpacing?: boolean; removeOuterGlow?: boolean; onPress: () => void; };
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function AppButton({ title, icon, theme, disabled, centeredContent = false, createEventSpacing = false, removeOuterGlow = false, onPress }: Props) {
  const primary = theme === 'primary';
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: disabled ? 0.45 : 1,
    transform: [{ scale: scale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <AnimatedPressable
      accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
      onPressOut={() => {
        if (reduceMotion) {
          scale.value = 1;
          glow.value = 0;
          return;
        }
        scale.value = withSpring(1, { damping: 13, stiffness: 220 });
        glow.value = withTiming(0, { duration: 180 });
      }}
      onPressIn={() => {
        if (reduceMotion) return;
        scale.value = withSpring(0.97, { damping: 15, stiffness: 260 });
        glow.value = withTiming(1, { duration: 140 });
      }}
      style={[styles.button, centeredContent && styles.centeredButton, createEventSpacing && styles.createEventSpacing, primary ? styles.primary : styles.secondary, removeOuterGlow && styles.noOuterGlow, animatedStyle]}
    >
      {!removeOuterGlow && <Animated.View pointerEvents="none" style={[styles.pressGlow, primary && styles.pressGlowPrimary, glowStyle]} />}
      <View style={[styles.icon, centeredContent && styles.centeredIcon, primary ? styles.iconPrimary : styles.iconSecondary]}><Ionicons name={icon} size={19} color={primary ? '#FFFFFF' : COLORS.champagne} /></View>
      <View style={centeredContent ? styles.centeredLabelContainer : styles.labelContainer}>
        <Text style={[styles.label, centeredContent && styles.centeredLabel, primary ? styles.primaryLabel : styles.secondaryLabel]}>{title}</Text>
      </View>
      <View style={[styles.arrow, centeredContent && styles.centeredArrow, primary ? styles.arrowPrimary : styles.arrowSecondary]}><Ionicons name="arrow-forward" size={16} color={primary ? '#FFFFFF' : COLORS.champagne} /></View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 64, width: '100%', borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.sm },
  centeredButton: { position: 'relative', justifyContent: 'center' },
  createEventSpacing: { marginTop: 20 },
  pressGlow: { ...StyleSheet.absoluteFillObject, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.cyan, shadowColor: COLORS.cyan, shadowOpacity: 0.24, shadowRadius: 14 },
  pressGlowPrimary: { borderColor: 'rgba(255,255,255,0.62)', shadowColor: COLORS.primary },
  primary: { backgroundColor: COLORS.primary, borderColor: 'rgba(255,255,255,0.56)', borderWidth: 1, shadowColor: COLORS.primary, shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  noOuterGlow: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  secondary: { backgroundColor: COLORS.glassStrong, borderColor: COLORS.glassBorder, borderWidth: 1 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  iconPrimary: { backgroundColor: 'rgba(255,255,255,0.18)' },
  iconSecondary: { backgroundColor: COLORS.champagneSoft },
  labelContainer: { flex: 1 },
  centeredLabelContainer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  label: { ...TYPOGRAPHY.button },
  centeredLabel: { flex: 0, textAlign: 'center' },
  centeredIcon: { position: 'absolute', left: 10, top: 8, marginRight: 0 },
  centeredArrow: { position: 'absolute', right: 10, top: 8 },
  primaryLabel: { color: '#FFFFFF' }, secondaryLabel: { color: COLORS.textPrimary },
  arrow: { width: 44, height: 44, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  arrowPrimary: { backgroundColor: 'rgba(255,255,255,0.20)' },
  arrowSecondary: { backgroundColor: COLORS.champagneSoft, borderWidth: 1, borderColor: COLORS.champagneBorder },
});
