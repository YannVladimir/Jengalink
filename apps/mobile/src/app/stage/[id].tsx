import { formatShortDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { stageStatusLabel, radius, spacing, type Status } from '@jengalink/ui';
import { Button, Card, StateView, StatusBadge, Text, useJengaTheme } from '@jengalink/ui/native';
import type { StageStatus } from '@jengalink/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoTile } from '@/components/PhotoTile';
import { BottomAction } from '@/components/ui';
import { delayDays, findStage, project } from '@/lib/demo';
import { useRole } from '@/lib/role';

const stageBadge: Record<StageStatus, Status> = {
  planned: 'approved',
  in_progress: 'reported',
  ready_for_review: 'waiting',
  accepted: 'paid',
  blocked: 'problem',
  changes_required: 'problem',
};

export default function StageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stage = findStage(id);
  const { role } = useRole();
  const { colors, status } = useJengaTheme();
  const { t, locale } = useI18n();
  const [accepted, setAccepted] = useState(false);

  if (!stage) {
    return <StateView kind="no-permission" title={t('stagePage.notFound')} message={t('states.notSharedMessage')} />;
  }

  const index = project.stages.indexOf(stage) + 1;
  const delay = delayDays(stage.plannedEnd, stage.currentEnd);
  const photos = project.updates.filter((u) => u.stageId === stage.id).flatMap((u) => u.photos);
  const shownStatus: StageStatus = accepted ? 'accepted' : stage.status;
  const canAccept = role === 'owner' && stage.status === 'ready_for_review' && !accepted;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: canAccept ? 120 : spacing.xxl }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="label" muted>
            {t('stagePage.position', { index, total: project.stages.length, weight: stage.weight })}
          </Text>
          <Text variant="screenTitle">{stage.name}</Text>
          <StatusBadge status={stageBadge[shownStatus]} label={stageStatusLabel(shownStatus, { t, locale })} />
        </View>

        <Card title={t('stagePage.schedule')}>
          <ScheduleBars plannedEnd={stage.plannedEnd} currentEnd={stage.currentEnd} />
          <Text variant="label" color={delay > 0 ? status('waiting').color : colors.inkMuted} style={{ marginTop: spacing.sm }}>
            {delay > 0 ? t('stagePage.late', { count: delay }) : delay < 0 ? t('stagePage.early', { count: -delay }) : t('stagePage.onSchedule')}
          </Text>
        </Card>

        <Card title={t('stagePage.checks')}>
          <View style={{ gap: 6 }}>
            {stage.acceptanceCriteria.map((c) => (
              <Text key={c} muted>
                • {c}
              </Text>
            ))}
          </View>
        </Card>

        <View style={{ gap: spacing.sm }}>
          <Text variant="sectionTitle">{t('stagePage.photos', { count: photos.length })}</Text>
          {photos.length === 0 ? (
            <Text muted>{t('stagePage.noPhotos')}</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {photos.map((p) => (
                <PhotoTile key={p.id} photo={p} size={104} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {canAccept && (
        <BottomAction>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title={t('stagePage.accept')} size="lg" block onPress={() => setAccepted(true)} />
            </View>
            <Button title={t('claim.askChanges')} size="lg" variant="secondary" onPress={() => router.back()} />
          </View>
        </BottomAction>
      )}
    </SafeAreaView>
  );
}

/** Two-line bar: planned vs current end date (Build Plan: Schedule). */
function ScheduleBars({ plannedEnd, currentEnd }: { plannedEnd: string; currentEnd: string }) {
  const { colors, status } = useJengaTheme();
  const { t, locale } = useI18n();
  const late = new Date(currentEnd) > new Date(plannedEnd);
  const p = new Date(plannedEnd).getTime();
  const c = new Date(currentEnd).getTime();
  const max = Math.max(p, c);
  const span = 120 * 86_400_000; // the bar shows the last ~4 months up to the later date
  const width = (t: number) => `${Math.max(8, Math.min(100, 100 - ((max - t) / span) * 100))}%` as const;
  const rows = [
    { label: t('stagePage.planned'), date: plannedEnd, w: width(p), color: colors.borderStrong },
    { label: t('stagePage.current'), date: currentEnd, w: width(c), color: late ? status('waiting').color : status('paid').color },
  ];
  return (
    <View style={{ gap: spacing.sm }}>
      {rows.map((r) => (
        <View key={r.label} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="label" muted>
              {r.label}
            </Text>
            <Text variant="label">{formatShortDate(locale, r.date)}</Text>
          </View>
          <View style={{ height: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}>
            <View style={{ width: r.w, height: 10, borderRadius: radius.pill, backgroundColor: r.color }} />
          </View>
        </View>
      ))}
    </View>
  );
}
