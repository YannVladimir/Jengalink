import { DEFAULT_QUIET_HOURS, type NotificationSettings } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Card, Text, useJengaTheme } from '@jengalink/ui/native';
import { Lock, Square, SquareCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, useAuth } from '@/lib/auth';

const FROM = ['20:00', '21:00', '22:00', '23:00'];
const UNTIL = ['05:00', '06:00', '07:00', '08:00'];

/** Reminders and quiet hours (spec §9.4). Each change is saved at once. */
export function NotificationSettingsCard() {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [s, setS] = useState<NotificationSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/me/notification-settings')))
      .then(setS)
      .catch(() => undefined);
  }, [withRefresh]);
  if (!s) return null;

  const save = (next: Pick<NotificationSettings, 'remindersEnabled' | 'quietHours'>) => {
    setS({ ...s, ...next });
    setSaved(false);
    void withRefresh(() => request(() => api.PUT('/v1/me/notification-settings', { body: next })))
      .then((v) => {
        setS(v);
        setSaved(true);
      })
      .catch(() => undefined);
  };
  const check = (on: boolean, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 }}>
      {on ? <SquareCheck size={22} color={colors.primary} /> : <Square size={22} color={colors.inkMuted} />}
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
  const chips = (values: string[], current: string, pick: (v: string) => void, label: string) => (
    <View style={{ gap: 4 }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
        {values.map((v) => {
          const on = v === current;
          return (
            <Pressable
              key={v}
              onPress={() => pick(v)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{
                minHeight: 40,
                paddingHorizontal: spacing.md,
                justifyContent: 'center',
                borderRadius: radius.pill,
                borderWidth: 1.5,
                borderColor: on ? colors.primary : colors.borderStrong,
                backgroundColor: on ? colors.primarySoft : colors.surface,
              }}
            >
              <Text variant="label" color={on ? colors.primary : colors.ink}>
                {v}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  const quiet = s.quietHours;

  return (
    <Card title={t('notify.settingsTitle')}>
      {check(s.remindersEnabled, t('notify.remindersLabel'), () => save({ remindersEnabled: !s.remindersEnabled, quietHours: quiet }))}
      {check(!!quiet, t('notify.quietLabel'), () => save({ remindersEnabled: s.remindersEnabled, quietHours: quiet ? null : { ...DEFAULT_QUIET_HOURS } }))}
      {quiet ? (
        <View style={{ gap: spacing.sm, marginLeft: 30 }}>
          {chips(FROM, quiet.start, (v) => save({ remindersEnabled: s.remindersEnabled, quietHours: { ...quiet, start: v } }), t('notify.quietFrom'))}
          {chips(UNTIL, quiet.end, (v) => save({ remindersEnabled: s.remindersEnabled, quietHours: { ...quiet, end: v } }), t('notify.quietTo'))}
          <Text variant="caption" muted>
            {t('notify.quietHint', { start: quiet.start, end: quiet.end })}
          </Text>
        </View>
      ) : (
        <Text variant="caption" muted style={{ marginLeft: 30 }}>
          {t('notify.quietOff')}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: spacing.md }}>
        <Lock size={14} color={colors.inkMuted} />
        <Text variant="caption" muted style={{ flex: 1 }}>
          {t('notify.lockScreenNote')}
        </Text>
      </View>
      {saved && (
        <Text variant="caption" color={status('paid').color} style={{ marginTop: 4 }}>
          {t('notify.saved')}
        </Text>
      )}
    </Card>
  );
}
