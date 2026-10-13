import { formatRwf, radius } from '@jengalink/ui';
import { useI18n } from '@jengalink/i18n/react';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import * as Haptics from 'expo-haptics';
import { Check, ChevronsRight } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, View, type GestureResponderEvent } from 'react-native';

const HEIGHT = 60;
const KNOB = 52;

/**
 * Safe approval (Build Plan): a deliberate slide, never a stray tap.
 * Screen readers get a single "approve" action instead of the gesture.
 */
export function SlideToApprove({
  amount,
  onApprove,
  label,
  doneLabel,
}: {
  amount: number;
  onApprove: () => void;
  /** Defaults to the payment-claim wording ("Slide to approve RWF …"). */
  label?: string;
  doneLabel?: string;
}) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  const idleText = label ?? t('claim.slideToApprove', { amount: formatRwf(amount) });
  const doneText = doneLabel ?? t('claim.approvedAmount', { amount: formatRwf(amount) });
  const [width, setWidth] = useState(0);
  const [done, setDone] = useState(false);
  const [x] = useState(() => new Animated.Value(0));
  const max = Math.max(0, width - KNOB - 8);

  // The gesture handler is created once; it reads the latest values from these refs.
  const live = useRef({ max, done, finish: () => {} });
  useEffect(() => {
    live.current = {
      max,
      done,
      finish: () => {
        setDone(true);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        AccessibilityInfo.announceForAccessibility?.(doneText);
        onApprove();
      },
    };
  }, [max, done, doneText, onApprove]);

  // Plain responder events (no PanResponder object): drag the knob along the track.
  const startX = useRef(0);
  const dx = useRef(0);
  const knobEvents = {
    onStartShouldSetResponder: () => !live.current.done,
    onMoveShouldSetResponder: () => !live.current.done,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      startX.current = e.nativeEvent.pageX;
      dx.current = 0;
    },
    onResponderMove: (e: GestureResponderEvent) => {
      dx.current = e.nativeEvent.pageX - startX.current;
      x.setValue(Math.min(Math.max(0, dx.current), live.current.max));
    },
    onResponderRelease: () => {
      const { max: m, finish } = live.current;
      if (dx.current >= m * 0.9) {
        Animated.timing(x, { toValue: m, duration: 120, useNativeDriver: false }).start(finish);
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  };

  const fill = x.interpolate({
    inputRange: [0, Math.max(1, max)],
    outputRange: [KNOB + 8, Math.max(KNOB + 8, width)],
  });

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={done ? doneText : idleText}
      // A slider says how far it is: 0 until approved, 100 once done.
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={done ? 100 : 0}
      accessibilityActions={[{ name: 'activate', label: label ?? t('claim.approve', { amount: formatRwf(amount) }) }]}
      onAccessibilityAction={() => !live.current.done && live.current.finish()}
      style={{
        height: HEIGHT,
        borderRadius: radius.pill,
        backgroundColor: done ? colors.primary : colors.primarySoft,
        borderWidth: 1.5,
        borderColor: colors.primary,
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fill, backgroundColor: colors.primary, opacity: 0.18 }} />
      <Text variant="bodyStrong" color={done ? colors.onPrimary : colors.primary} style={{ textAlign: 'center', paddingLeft: KNOB }}>
        {done ? doneText : idleText}
      </Text>
      <Animated.View
        {...knobEvents}
        style={{
          position: 'absolute',
          left: 4,
          width: KNOB,
          height: KNOB,
          borderRadius: radius.pill,
          backgroundColor: done ? colors.onPrimary : colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ translateX: x }],
        }}
      >
        {done ? <Check size={24} color={colors.primary} strokeWidth={3} /> : <ChevronsRight size={26} color={colors.onPrimary} />}
      </Animated.View>
    </View>
  );
}
