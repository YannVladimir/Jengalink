import { intlLocale } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Text, useJengaTheme } from '@jengalink/ui/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** "2026-11-02" → a local Date at noon (no time-zone day shift). */
export const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Weeks of a month, Monday first; null pads the first and last week. */
function monthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1, 12);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1, 12))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/**
 * A plain-JS month calendar in a bottom sheet (works in Expo Go and on the web build,
 * unlike the native date picker). Dates are ISO "YYYY-MM-DD".
 */
export function DatePickerSheet({
  visible,
  title,
  value,
  min,
  onPick,
  onClear,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: string | null;
  min?: string | null;
  onPick: (iso: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  const start = fromIsoDate(value ?? min ?? toIso(new Date()));
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const intl = intlLocale(locale);
  const monthLabel = new Date(view.y, view.m, 1, 12).toLocaleDateString(intl, { month: 'long', year: 'numeric' });
  // 2024-01-01 was a Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i, 12).toLocaleDateString(intl, { weekday: 'narrow' }));
  const today = toIso(new Date());
  const shift = (n: number) => setView(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} accessibilityLabel={t('plan.close')} />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text variant="sectionTitle">{title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable
              onPress={() => shift(-1)}
              accessibilityRole="button"
              accessibilityLabel={t('plan.prevMonth')}
              hitSlop={8}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={22} color={colors.ink} />
            </Pressable>
            <Text variant="bodyStrong" style={{ textTransform: 'capitalize' }}>
              {monthLabel}
            </Text>
            <Pressable
              onPress={() => shift(1)}
              accessibilityRole="button"
              accessibilityLabel={t('plan.nextMonth')}
              hitSlop={8}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronRight size={22} color={colors.ink} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row' }} accessibilityElementsHidden>
            {weekdays.map((d, i) => (
              <Text key={i} variant="caption" muted style={{ flex: 1, textAlign: 'center' }}>
                {d}
              </Text>
            ))}
          </View>
          {monthGrid(view.y, view.m).map((week, w) => (
            <View key={w} style={{ flexDirection: 'row' }}>
              {week.map((day, i) => {
                if (!day) return <View key={i} style={{ flex: 1, height: 44 }} />;
                const iso = toIso(day);
                const selected = iso === value;
                const disabled = !!min && iso < min;
                return (
                  <Pressable
                    key={i}
                    disabled={disabled}
                    onPress={() => onPick(iso)}
                    accessibilityRole="button"
                    aria-pressed={selected}
                    aria-disabled={disabled}
                    accessibilityLabel={day.toLocaleDateString(intl, { day: 'numeric', month: 'long', year: 'numeric' })}
                    style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 19,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: selected ? colors.primary : 'transparent',
                        borderWidth: iso === today && !selected ? 1 : 0,
                        borderColor: colors.borderStrong,
                      }}
                    >
                      <Text variant="label" color={selected ? colors.onPrimary : disabled ? colors.inkSubtle : colors.ink}>
                        {day.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('plan.clearDate')} variant="ghost" onPress={onClear} />
            <View style={{ flex: 1 }} />
            <Button title={t('plan.close')} variant="secondary" onPress={onClose} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
