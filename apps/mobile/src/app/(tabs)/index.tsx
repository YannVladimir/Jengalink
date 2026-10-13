import type { DecisionInbox, SiteUpdate, UpdatePhoto } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, spacing } from '@jengalink/ui';
import { Button, Card, OfflineBanner, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect } from 'expo-router';
import { Camera, ChevronDown, FolderPlus, Mail } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NextActionRow, ProgressCard, useDashboardData } from '@/components/dashboard';
import { PhotoThumb, PhotoViewer } from '@/components/feed';
import { DecisionInboxCard } from '@/components/inbox';
import { setInboxCount } from '@/lib/inbox-count';
import { SyncStatus } from '@/components/SyncStatus';
import { BottomAction } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';
import { useCurrentProject } from '@/lib/current-project';

const REPORTERS = ['contractor', 'supervisor', 'manager'];

/**
 * Home (Phase 3), in order: what needs me, is it on track, the money, then proof.
 * Owners see stages waiting for their decision; contractors and supervisors see their next action.
 */
export default function HomeScreen() {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const { projects, project, select } = useCurrentProject();
  const { progress, overview, offline } = useDashboardData(project?.id);
  const [photos, setPhotos] = useState<UpdatePhoto[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [inbox, setInbox] = useState<{ data: DecisionInbox; at: number } | null>(null);

  // What waits on me, across all my projects (the clock is read when the list arrives).
  useFocusEffect(
    useCallback(() => {
      let live = true;
      withRefresh(() => request(() => api.GET('/v1/decisions')))
        .then((data) => {
          if (!live) return;
          setInbox({ data, at: Date.now() });
          setInboxCount(data.count);
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, [withRefresh]),
  );

  // Latest proof: the newest ready photos.
  useFocusEffect(
    useCallback(() => {
      if (!project) return;
      let live = true;
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/updates', { params: { path: { id: project.id }, query: { limit: 10 } } })))
        .then((list: SiteUpdate[]) => live && setPhotos(list.flatMap((u) => u.photos.filter((p) => p.status === 'ready')).slice(0, 6)))
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, [project, withRefresh]),
  );

  if (!project)
    return (
      <StateView
        kind="empty"
        title={t('feed.noProjectsTitle')}
        message={t('dash.emptyLead')}
        action={
          <View style={{ gap: spacing.sm, alignSelf: 'stretch' }}>
            <Button title={t('wizard.startProject')} icon={FolderPlus} onPress={() => router.push('/project/new')} />
            <Button title={t('invite.listTitle')} icon={Mail} variant="secondary" onPress={() => router.push('/invitations')} />
          </View>
        }
      />
    );

  const mine = overview.find((o) => o.id === project.id);
  const canReport = project.status === 'active' && project.myRoles.some((r) => REPORTERS.includes(r));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 }}>
        <View style={{ gap: 2 }}>
          <Pressable
            onPress={() => projects.length > 1 && setPicking(true)}
            accessibilityRole="button"
            accessibilityHint={projects.length > 1 ? t('feed.switchProject') : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44 }}
          >
            <Text variant="screenTitle">{project.name}</Text>
            {projects.length > 1 && <ChevronDown size={22} color={colors.inkMuted} />}
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text variant="caption" muted>
              {progress?.lastUpdateAt ? t('dash.lastUpdate', { when: formatUpdatedAgo(t, locale, progress.lastUpdateAt) }) : t('dash.noUpdatesYet')} ·
            </Text>
            <SyncStatus />
          </View>
          {projects.length > 1 && (
            <Pressable onPress={() => router.push('/projects')} accessibilityRole="link" hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
              <Text variant="label" color={colors.primary}>
                {t('dash.allProjects', { count: projects.length })}
              </Text>
            </Pressable>
          )}
        </View>

        {offline && <OfflineBanner />}

        {/* What needs me: the decision inbox; with nothing to decide, my next action. */}
        {inbox && inbox.data.count > 0 ? (
          <DecisionInboxCard inbox={inbox.data} now={inbox.at} multiProject={projects.length > 1} />
        ) : mine ? (
          <NextActionRow projectId={project.id} action={mine.nextAction} />
        ) : null}

        {progress && <ProgressCard projectId={project.id} progress={progress} />}

        {/* Money: only for people who may see it (site supervisors and viewers do not). */}
        {project.seesMoney && (
          <Card title={t('home.money')}>
            <Text variant="label" muted>
              {t('dash.contractValue')}
            </Text>
            <Text variant="moneyLarge">{project.contractValue !== null ? formatRwf(project.contractValue) : t('accept.noValue')}</Text>
            <View style={{ height: 10, borderRadius: 5, marginVertical: spacing.sm, backgroundColor: colors.surfaceSunken }} />
            <Text variant="caption" muted>
              {t('dash.moneyPlaceholder')}
            </Text>
          </Card>
        )}

        <Card
          title={t('home.latestPhotos')}
          action={
            <Pressable onPress={() => router.push('/updates')} accessibilityRole="link" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text variant="label" color={colors.primary}>
                {t('dash.seeAll')}
              </Text>
            </Pressable>
          }
        >
          {photos.length === 0 ? (
            <Text muted>{t('dash.noPhotos')}</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {photos.map((p, i) => (
                <PhotoThumb key={p.id} photo={p} size={104} onPress={() => setViewing(i)} />
              ))}
            </ScrollView>
          )}
        </Card>
        <PhotoViewer photos={photos} index={viewing} onIndex={setViewing} />

        {mine && mine.blockers.length > 0 && (
          <Text variant="caption" color={status('problem').color}>
            {t('dash.blockersCount', { count: mine.blockers.length })}: {mine.blockers.map((b) => `${b.stageName} — ${b.text}`).join(' · ')}
          </Text>
        )}
      </ScrollView>

      {canReport && (
        <BottomAction>
          <Button title={t('home.addSiteUpdate')} size="lg" block icon={Camera} onPress={() => router.push({ pathname: '/update/new', params: { projectId: project.id } })} />
        </BottomAction>
      )}

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: spacing.xl }} onPress={() => setPicking(false)}>
          <Card flush>
            {projects.map((p, i) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  select(p.id);
                  setPicking(false);
                }}
                accessibilityRole="button"
                style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}
              >
                <Text variant="bodyStrong" color={p.id === project.id ? colors.primary : colors.ink}>
                  {p.name}
                </Text>
              </Pressable>
            ))}
          </Card>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
