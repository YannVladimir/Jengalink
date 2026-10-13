import {
  Camera,
  CircleCheck,
  Clock,
  Inbox,
  Lock,
  RefreshCw,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  useColorScheme,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { groupDigits, parseAmount } from '../format';
import {
  colors,
  darkColors,
  mainButtonHeight,
  minTouchTarget,
  nativeFamilyFor,
  radius,
  spacing,
  statuses,
  typeScale,
  type ColorTheme,
  type Status,
  type StatusIcon,
  type TypeVariant,
} from '../tokens';

export interface JengaTheme {
  dark: boolean;
  colors: ColorTheme;
  status: (s: Status) => { color: string; soft: string };
}

/** Follows the phone's light/dark setting. */
export function useJengaTheme(): JengaTheme {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    colors: dark ? darkColors : colors,
    status: (s) => ({
      color: dark ? statuses[s].darkColor : statuses[s].color,
      soft: dark ? statuses[s].darkSoft : statuses[s].soft,
    }),
  };
}

export const textStyle = (variant: TypeVariant): TextStyle => {
  const t: (typeof typeScale)[TypeVariant] = typeScale[variant];
  return {
    fontFamily: nativeFamilyFor(t),
    fontSize: t.size,
    lineHeight: t.lineHeight,
    letterSpacing: 'letterSpacing' in t ? t.letterSpacing : 0,
    fontVariant: 'tabularNums' in t && t.tabularNums ? ['tabular-nums'] : undefined,
  };
};

export function Text({
  variant = 'body',
  muted,
  color,
  style,
  children,
  numberOfLines,
}: {
  variant?: TypeVariant;
  muted?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  const { colors: c } = useJengaTheme();
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[textStyle(variant), { color: color ?? (muted ? c.inkMuted : c.ink) }, style]}
    >
      {children}
    </RNText>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  block,
  loading,
  disabled,
  icon: Icon,
  accessibilityHint,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  accessibilityHint?: string;
}) {
  const { colors: c, status } = useJengaTheme();
  const inactive = disabled || loading;
  const look = {
    primary: { bg: c.primary, pressed: c.primaryPressed, fg: c.onPrimary, border: 'transparent' },
    secondary: { bg: c.surface, pressed: c.surfaceSunken, fg: c.ink, border: c.borderStrong },
    ghost: { bg: 'transparent', pressed: c.primarySoft, fg: c.primary, border: 'transparent' },
    danger: { bg: status('problem').color, pressed: status('problem').color, fg: '#FFFFFF', border: 'transparent' },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        {
          minHeight: size === 'lg' ? mainButtonHeight : minTouchTarget,
          paddingHorizontal: variant === 'ghost' ? spacing.sm : size === 'lg' ? spacing.xl : spacing.lg,
          borderRadius: size === 'lg' ? radius.lg : radius.md,
          borderWidth: 1,
          borderColor: look.border,
          backgroundColor: pressed ? look.pressed : look.bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          alignSelf: block ? 'stretch' : 'flex-start',
          opacity: inactive ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={look.fg} />
      ) : (
        Icon && <Icon size={18} color={look.fg} />
      )}
      <RNText style={[textStyle('bodyStrong'), { color: look.fg, fontSize: size === 'lg' ? 16 : 15 }]}>
        {title}
      </RNText>
    </Pressable>
  );
}

export function Card({
  title,
  action,
  flush,
  style,
  children,
}: {
  title?: string;
  action?: ReactNode;
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { colors: c, dark } = useJengaTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding: flush ? 0 : spacing.lg,
          overflow: flush ? 'hidden' : 'visible',
          shadowColor: '#1C2430',
          shadowOpacity: dark ? 0 : 0.06,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          elevation: dark ? 0 : 1,
        },
        style,
      ]}
    >
      {(title || action) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing.md,
            gap: spacing.md,
            ...(flush ? { paddingHorizontal: spacing.lg, paddingTop: spacing.lg } : null),
          }}
        >
          {title && (
            <Text variant="sectionTitle" style={{ flexShrink: 1 }}>
              {title}
            </Text>
          )}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

const statusIcons: Record<StatusIcon, LucideIcon> = {
  camera: Camera,
  'check-outline': CircleCheck,
  'check-filled': CircleCheck,
  clock: Clock,
  warning: TriangleAlert,
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const { t } = useI18n();
  const word = label ?? t(`status.${status}`);
  const meaning = t(`status.${status}Meaning`);
  const theme = useJengaTheme();
  const { color, soft } = theme.status(status);
  const meta = statuses[status];
  const Icon = statusIcons[meta.icon];
  const filled = meta.icon === 'check-filled';
  return (
    <View
      accessible
      accessibilityLabel={`${word}: ${meta.meaning}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        height: 28,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: radius.pill,
        backgroundColor: soft,
      }}
    >
      {/* Paid = filled check, Approved = outline check: told apart without colour. */}
      <Icon size={16} strokeWidth={2.25} color={filled ? soft : color} fill={filled ? color : 'none'} />
      <RNText style={[textStyle('label'), { color, fontFamily: nativeFamilyFor(typeScale.bodyStrong), fontSize: 13 }]}>
        {word}
      </RNText>
    </View>
  );
}

export function Money({
  amount,
  variant = 'money',
  color,
}: {
  amount: number;
  variant?: 'money' | 'moneyLarge' | 'display';
  color?: string;
}) {
  const { colors: c } = useJengaTheme();
  const base = textStyle(variant);
  const negative = amount < 0;
  return (
    <RNText
      accessibilityLabel={`${negative ? 'minus ' : ''}${Math.abs(amount)} Rwandan francs`}
      style={[base, { color: color ?? c.ink }]}
    >
      <RNText
        style={{
          fontFamily: nativeFamilyFor(typeScale.bodyStrong),
          fontSize: Math.round((base.fontSize ?? 16) * 0.62),
          color: c.inkMuted,
          letterSpacing: 0.3,
        }}
      >
        {'RWF '}
      </RNText>
      {negative ? '−' : ''}
      {groupDigits(Math.abs(Math.round(amount)))}
    </RNText>
  );
}

export function AmountInput({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  error?: string;
}) {
  const theme = useJengaTheme();
  const c = theme.colors;
  const [focused, setFocused] = useState(false);
  const problem = theme.status('problem').color;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          height: 56,
          paddingHorizontal: spacing.lg,
          backgroundColor: c.surface,
          borderWidth: 1.5,
          borderRadius: radius.md,
          borderColor: error ? problem : focused ? c.primary : c.borderStrong,
        }}
      >
        <Text variant="label" muted style={{ fontFamily: nativeFamilyFor(typeScale.bodyStrong) }}>
          RWF
        </Text>
        <TextInput
          accessibilityLabel={label}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={c.inkSubtle}
          value={value == null ? '' : groupDigits(value)}
          onChangeText={(t) => onChange(parseAmount(t))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: c.ink,
            fontFamily: nativeFamilyFor(typeScale.bodyStrong),
            fontSize: 22,
            fontVariant: ['tabular-nums'],
            padding: 0,
            outlineWidth: 0, // the field border shows focus; no browser outline on web
          }}
        />
      </View>
      {(error || hint) && (
        <Text variant="caption" color={error ? problem : c.inkMuted}>
          {error ?? hint}
        </Text>
      )}
    </View>
  );
}

const stateIcons = { empty: Inbox, error: TriangleAlert, offline: WifiOff, 'no-permission': Lock } as const;

export function StateView({
  kind,
  title,
  message,
  action,
}: {
  kind: keyof typeof stateIcons;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const theme = useJengaTheme();
  const c = theme.colors;
  const tone =
    kind === 'error'
      ? theme.status('problem')
      : kind === 'offline'
        ? theme.status('waiting')
        : { color: c.inkMuted, soft: c.surfaceSunken };
  const Icon = stateIcons[kind];
  return (
    <View
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.sm }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          backgroundColor: tone.soft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.sm,
        }}
      >
        <Icon size={26} color={tone.color} />
      </View>
      <Text variant="sectionTitle" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message && (
        <Text muted style={{ textAlign: 'center', maxWidth: 300, marginBottom: spacing.sm }}>
          {message}
        </Text>
      )}
      {action}
    </View>
  );
}

export function OfflineBanner({ pending = 0 }: { pending?: number }) {
  const { t } = useI18n();
  const { color, soft } = useJengaTheme().status('waiting');
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: 10,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        backgroundColor: soft,
      }}
    >
      <WifiOff size={18} color={color} />
      <Text variant="label" color={color} style={{ flexShrink: 1 }}>
        {pending > 0 ? t('states.offlinePending', { count: pending }) : t('states.offline')}
      </Text>
    </View>
  );
}

export function Skeleton({ width = '100%', height = 16 }: { width?: number | `${number}%`; height?: number }) {
  const { colors: c } = useJengaTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius.sm, backgroundColor: c.border, opacity: pulse }}
    />
  );
}

export function LastUpdated({ at, now }: { at: Date | string; now?: Date }) {
  const { t, locale } = useI18n();
  const { colors: c } = useJengaTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <RefreshCw size={12} color={c.inkMuted} />
      <Text variant="caption" muted>
        {t('common.updated', { when: formatUpdatedAgo(t, locale, at, now) })}
      </Text>
    </View>
  );
}

export * from './charts';
