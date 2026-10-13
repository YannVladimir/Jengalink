import type { ProjectStage, SiteUpdate } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Card, OfflineBanner, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect } from 'expo-router';
import { Camera, ChevronDown, CloudOff } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FeedCard } from '@/components/feed';
import { SyncStatus } from '@/components/SyncStatus';
import { BottomAction } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';
import { useCurrentProject } from '@/lib/current-project';
import { useOutbox } from '@/lib/outbox';

const PAGE = 20;
const REPORTERS = ['contractor', 'supervisor', 'manager'];

/** Activity feed (Phase 3): the project's site updates, newest first, filterable by stage. */
export default function ActivityScreen() {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const { projects, project, select } = useCurrentProject();
  const outbox = useOutbox();
  const [stageId, setStageId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<SiteUpdate[] | null>(null);
  const [more, setMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);
  const projectId = project?.id;
  const stages: ProjectStage[] = (projectId && outbox.cache.stages?.[projectId]) || [];

  const fetchPage = useCallback(
    (before?: string) =>
      projectId
        ? withRefresh(() =>
            request(() =>
              api.GET('/v1/projects/{id}/updates', {
                params: { path: { id: projectId }, query: { limit: PAGE, ...(stageId ? { stageId } : {}), ...(before ? { before } : {}) } },
              }),
            ),
          )
        : Promise.resolve([]),
    [projectId, stageId, withRefresh],
  );

  const load = useCallback(
    () =>
      fetchPage()
        .then((page) => {
          setUpdates(page);
          setMore(page.length === PAGE);
          setOffline(false);
        })
        .catch(() => {
          setOffline(true);
          setUpdates((u) => u ?? []);
        }),
    [fetchPage],
  );

  // Load when the project or the stage filter changes, and whenever the tab is shown
  // (new updates, photos that finished processing).
  useFocusEffect(
    useCallback(() => {
      if (projectId) void load();
    }, [load, projectId]),
  );

  const loadMore = async () => {
    const last = updates?.at(-1);
    if (!last) return;
    try {
      const page = await fetchPage(last.submittedAt);
      setUpdates([...(updates ?? []), ...page]);
      setMore(page.length === PAGE);
    } catch {
      setOffline(true);
    }
  };

  if (!project) return <StateView kind="empty" title={t('feed.noProjectsTitle')} message={t('feed.noProjectsLead')} />;

  const pending = outbox.items.filter((i) => i.projectId === project.id && i.status !== 'draft');
  const canReport = project.status === 'active' && project.myRoles.some((r) => REPORTERS.includes(r));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 120 }}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" muted>
              {t('feed.title')} ·
            </Text>
            <SyncStatus />
          </View>
        </View>

        {offline && <OfflineBanner />}

        {stages.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {[{ id: null as string | null, name: t('feed.allStages') }, ...stages].map((s) => {
              const on = s.id === stageId;
              return (
                <Pressable
                  key={s.id ?? 'all'}
                  onPress={() => {
                    setStageId(s.id);
                    setUpdates(null);
                  }}
                  accessibilityRole="radio"
                  aria-checked={on}
                  style={{
                    minHeight: 44,
                    paddingHorizontal: spacing.md,
                    justifyContent: 'center',
                    borderRadius: radius.pill,
                    borderWidth: 1.5,
                    borderColor: on ? colors.primary : colors.borderStrong,
                    backgroundColor: on ? colors.primarySoft : colors.surface,
                  }}
                >
                  <Text variant="label" color={on ? colors.primary : colors.ink}>
                    {s.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {pending.map((i) => (
          <Card key={i.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <CloudOff size={14} color={colors.inkMuted} />
              <Text variant="caption" muted>
                {t('feed.onThisPhone')}
              </Text>
            </View>
            <Text variant="bodyStrong" style={{ marginTop: 4 }}>
              {i.stageName}
            </Text>
            {i.note ? <Text>{i.note}</Text> : null}
            <Text variant="caption" muted>
              {t('sync.photosCount', { count: i.photos.length })}
            </Text>
          </Card>
        ))}

        {updates === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : updates.length === 0 && pending.length === 0 ? (
          <Text muted>{t('feed.empty')}</Text>
        ) : (
          updates.map((u) => (
            <FeedCard
              key={u.id}
              update={u}
              onStage={() => router.push({ pathname: '/project/[id]/stages/[stageId]', params: { id: project.id, stageId: u.stageId } })}
            />
          ))
        )}
        {more && <Button title={t('feed.loadMore')} variant="secondary" onPress={() => void loadMore()} />}
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
                  setStageId(null);
                  setUpdates(null);
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
