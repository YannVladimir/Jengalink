import type { NotificationKind, NotificationList } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatDateTime } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { useFocusEffect } from 'expo-router';
import { AlarmClock, Banknote, CheckCheck, FilePen, HandCoins, Newspaper, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { api, useAuth } from '@/lib/auth';
import { NotificationSettingsCard } from '@/components/notification-settings';
import { openNotification } from '@/lib/push';

const icons: Record<NotificationKind, LucideIcon> = {
  claim_to_decide: HandCoins,
  spending_to_decide: Banknote,
  change_to_decide: FilePen,
  report_published: Newspaper,
  update_problem: TriangleAlert,
  decisions_reminder: AlarmClock,
};

/** In-app notifications (spec §9.4): each opens the exact item; unread ones stand out. */
export default function NotificationsScreen() {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<NotificationList | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      withRefresh(() => request(() => api.GET('/v1/notifications')))
        .then((l) => live && setList(l))
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [withRefresh]),
  );

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!list)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
      {list.items.length === 0 && <StateView kind="empty" title={t('notify.empty')} />}
      {list.unread > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <Text variant="label" color={colors.primary}>
            {t('notify.unread', { count: list.unread })}
          </Text>
          <Button
            title={t('notify.markAll')}
            icon={CheckCheck}
            variant="secondary"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              try {
                setList(await withRefresh(() => request(() => api.POST('/v1/notifications/read-all'))));
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      )}
      {list.items.map((n) => {
        const Icon = icons[n.kind];
        const unread = !n.readAt;
        const tone = n.kind === 'update_problem' ? status('problem').color : unread ? colors.accent : colors.inkMuted;
        return (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            onPress={() => {
              setList((l) => (l && unread ? { unread: l.unread - 1, items: l.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) } : l));
              openNotification(withRefresh, n);
            }}
          >
            <Card>
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                <View style={{ width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSunken }}>
                  <Icon size={18} color={tone} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant={unread ? 'bodyStrong' : 'body'}>{n.title}</Text>
                  <Text variant="caption" muted>
                    {n.body}
                  </Text>
                  <Text variant="caption" muted>
                    {formatDateTime(locale, n.createdAt)}
                  </Text>
                </View>
                {unread && <View accessibilityLabel={t('notify.unread', { count: 1 })} style={{ width: 10, height: 10, marginTop: 6, borderRadius: 5, backgroundColor: colors.accent }} />}
              </View>
            </Card>
          </Pressable>
        );
      })}
      <View style={{ height: spacing.md }} />
      <NotificationSettingsCard />
    </ScrollView>
  );
}
