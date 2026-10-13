import { type NextAction, type ProjectProgress, QUIET_DAYS } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing, towerSentence } from '@jengalink/ui';
import { Card, JengaTower, ProgressRing, RingLegend, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, useAuth } from '@/lib/auth';
import { useOutbox } from '@/lib/outbox';

/** Progress ring + Jenga tower from real stages (Phase 3). Tapping a block opens that stage's timeline. */
export function ProgressCard({ projectId, progress }: { projectId: string; progress: ProjectProgress }) {
  const { t, locale } = useI18n();
  const blocks = progress.stages.map((s) => ({ id: s.id, name: s.name, status: s.displayStatus }));
  return (
    <Card title={t('home.progress')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <ProgressRing accepted={progress.acceptedPercent} reported={progress.reportedPercent} size={124} />
        <View style={{ flex: 1 }}>
          <JengaTower
            compact
            stages={blocks}
            onSelect={(stageId) => router.push({ pathname: '/project/[id]/stages/[stageId]', params: { id: projectId, stageId } })}
          />
        </View>
      </View>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <RingLegend accepted={progress.acceptedPercent} reported={progress.reportedPercent} />
        <Text variant="label" muted>
          {towerSentence(blocks, { t, locale })}
        </Text>
      </View>
    </Card>
  );
}

/** Where each next action leads. */
export function openNextAction(projectId: string, a: NextAction) {
  const stage = (stageId: string | null) =>
    stageId && router.push({ pathname: '/project/[id]/stages/[stageId]', params: { id: projectId, stageId } });
  switch (a.kind) {
    case 'review_stage':
    case 'fix_changes':
    case 'clear_blocker':
      return stage(a.stageId);
    case 'accept_project':
      return router.push({ pathname: '/project/[id]/accept', params: { id: projectId } });
    case 'invite_owner':
      return router.push({ pathname: '/project/[id]/invite', params: { id: projectId } });
    case 'plan_project':
    case 'await_owner':
      return router.push({ pathname: '/project/[id]/plan', params: { id: projectId } });
    case 'post_update':
      return router.push({ pathname: '/update/new', params: { projectId } });
    default:
      return undefined;
  }
}

export function nextActionText(a: NextAction, t: ReturnType<typeof useI18n>['t']) {
  return t(`dash.next_${a.kind}`, { stage: a.stageName ?? '', days: QUIET_DAYS });
}

/** A tappable "next action" row; quiet when there is nothing to do. */
export function NextActionRow({ projectId, action, compact }: { projectId: string; action: NextAction; compact?: boolean }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const urgent = action.kind === 'review_stage' || action.kind === 'fix_changes' || action.kind === 'clear_blocker' || action.kind === 'accept_project';
  const tone = action.kind === 'clear_blocker' || action.kind === 'fix_changes' ? status('problem') : urgent ? { color: colors.primary, soft: colors.primarySoft } : { color: colors.structure, soft: colors.structureSoft };
  if (action.kind === 'none')
    return (
      <Text variant="caption" muted>
        {nextActionText(action, t)}
      </Text>
    );
  return (
    <Pressable
      onPress={() => openNextAction(projectId, action)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: compact ? 44 : 52,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: tone.soft,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        {!compact && (
          <Text variant="caption" color={tone.color}>
            {t('dash.nextAction')}
          </Text>
        )}
        <Text variant="bodyStrong" color={tone.color} numberOfLines={2}>
          {nextActionText(action, t)}
        </Text>
      </View>
      <ChevronRight size={18} color={tone.color} />
    </Pressable>
  );
}

/** Progress and overview for the dashboard: from the server, else the copy saved on the phone. */
export function useDashboardData(projectId: string | undefined) {
  const { withRefresh } = useAuth();
  const outbox = useOutbox();
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!projectId) return;
      let live = true;
      Promise.all([
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/progress', { params: { path: { id: projectId } } }))),
        withRefresh(() => request(() => api.GET('/v1/overview'))),
      ])
        .then(([progress, overview]) => {
          if (!live) return;
          outbox.cacheProgress(projectId, progress);
          outbox.cacheOverview(overview);
          setOffline(false);
        })
        .catch(() => live && setOffline(true));
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, withRefresh, tick]),
  );

  return {
    offline,
    reload: () => setTick((n) => n + 1),
    progress: projectId ? outbox.cache.progress?.[projectId] : undefined,
    overview: outbox.cache.overview ?? [],
  };
}
