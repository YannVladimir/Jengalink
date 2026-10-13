import type { ProjectOverview } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Card, OfflineBanner, ProgressRing, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect } from 'expo-router';
import { FolderPlus, TriangleAlert } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { NextActionRow } from '@/components/dashboard';
import { api, useAuth } from '@/lib/auth';
import { useCurrentProject } from '@/lib/current-project';
import { useOutbox } from '@/lib/outbox';

/**
 * Contractor multi-project list (Phase 3): every project with progress, blockers and
 * the one next action for your role. Projects needing something come first.
 */
export default function ProjectsScreen() {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const outbox = useOutbox();
  const { select } = useCurrentProject();
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const list = outbox.cache.overview ?? [];

  const load = useCallback(
    () =>
      withRefresh(() => request(() => api.GET('/v1/overview')))
        .then((o) => {
          outbox.cacheOverview(o);
          setOffline(false);
        })
        .catch(() => setOffline(true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withRefresh],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {offline && <OfflineBanner />}
      {list.map((p) => (
        <ProjectRow
          key={p.id}
          p={p}
          onOpen={() => {
            select(p.id);
            router.navigate('/');
          }}
        />
      ))}
      <Button title={t('wizard.startProject')} icon={FolderPlus} variant="secondary" onPress={() => router.push('/project/new')} />
    </ScrollView>
  );
}

function ProjectRow({ p, onOpen }: { p: ProjectOverview; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  return (
    <Card>
      <Pressable onPress={onOpen} accessibilityRole="button" style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <ProgressRing accepted={p.acceptedPercent} reported={p.reportedPercent} size={64} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {p.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: p.status === 'active' ? status('paid').soft : colors.surfaceSunken }}>
              <Text variant="caption" color={p.status === 'active' ? status('paid').color : colors.inkMuted}>
                {t(`dash.status_${p.status}`)}
              </Text>
            </View>
            <Text variant="caption" muted numberOfLines={1}>
              {t('dash.percentAccepted', { percent: p.acceptedPercent })}
            </Text>
          </View>
          <Text variant="caption" muted>
            {p.lastUpdateAt ? t('dash.lastUpdate', { when: formatUpdatedAgo(t, locale, p.lastUpdateAt) }) : t('dash.noUpdatesYet')}
            {p.waitingReview > 0 ? ` · ${t('dash.waitingReview', { count: p.waitingReview })}` : ''}
          </Text>
        </View>
      </Pressable>
      {p.blockers.map((b) => (
        <View key={b.stageId} style={{ flexDirection: 'row', gap: 6, marginTop: spacing.sm }}>
          <TriangleAlert size={15} color={status('problem').color} style={{ marginTop: 2 }} />
          <Text variant="caption" color={status('problem').color} style={{ flex: 1 }}>
            {b.stageName}: {b.text}
          </Text>
        </View>
      ))}
      <View style={{ marginTop: spacing.sm }}>
        <NextActionRow projectId={p.id} action={p.nextAction} compact />
      </View>
    </Card>
  );
}
