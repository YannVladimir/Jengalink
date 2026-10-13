import type { StageTimeline } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Clock, MessageSquare } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { fromIsoDate } from '@/components/DatePickerSheet';
import { BeforeAfter, FeedCard, stageStatusKey } from '@/components/feed';
import { SlideToApprove } from '@/components/SlideToApprove';
import { api, useAuth } from '@/lib/auth';

/** A stage's photo story (Phase 3): before/after, the plan's checks, and every update in order. */
export default function StageTimelineScreen() {
  const { id, stageId } = useLocalSearchParams<{ id: string; stageId: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [data, setData] = useState<StageTimeline | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchIt = useCallback(
    () =>
      withRefresh(() =>
        request(() => api.GET('/v1/projects/{id}/stages/{stageId}/timeline', { params: { path: { id, stageId } } })),
      ),
    [id, stageId, withRefresh],
  );
  useEffect(() => {
    let live = true;
    fetchIt()
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [fetchIt]);

  if (failed && !data) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!data)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  const s = data.stage;
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const range = s.plannedStart || s.plannedEnd ? `${s.plannedStart ? fmt(s.plannedStart) : '…'} – ${s.plannedEnd ? fmt(s.plannedEnd) : '…'}` : null;
  const tone = s.status === 'accepted' ? status('paid') : s.status === 'ready_for_review' ? status('waiting') : { color: colors.structure, soft: colors.structureSoft };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await fetchIt().then(setData).catch(() => undefined);
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={{ gap: spacing.xs }}>
        <Text variant="screenTitle">{s.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone.soft }}>
            <Text variant="caption" color={tone.color}>
              {t(stageStatusKey(s.status))}
            </Text>
          </View>
          <Text variant="caption" muted>
            {s.weight}%{range ? ` · ${t('feed.planned', { range })}` : ''} · {t('sync.photosCount', { count: data.photoCount })}
          </Text>
        </View>
      </View>

      <ReviewPanel data={data} projectId={id} onChange={setData} />

      <View style={{ gap: spacing.sm }}>
        <Text variant="sectionTitle">{t('feed.beforeAfter')}</Text>
        {data.before && data.after ? (
          <>
            <BeforeAfter before={data.before} after={data.after} />
            <Text variant="caption" muted style={{ textAlign: 'center' }}>
              {t('feed.dragToCompare')}
            </Text>
          </>
        ) : (
          <Text muted>{t('feed.notEnoughPhotos')}</Text>
        )}
      </View>

      {s.criteria.length > 0 && (
        <Card>
          <Text variant="label" muted style={{ marginBottom: 6 }}>
            {t('plan.criteriaTitle')}
          </Text>
          {s.criteria.map((c) => (
            <View key={c} style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
              <CheckCircle2 size={15} color={status('paid').color} style={{ marginTop: 3 }} />
              <Text style={{ flex: 1 }}>{c}</Text>
            </View>
          ))}
        </Card>
      )}

      {data.reviews.length > 0 && (
        <View style={{ gap: spacing.xs }}>
          <Text variant="sectionTitle">{t('review.historyTitle')}</Text>
          {data.reviews.map((r) => (
            <View key={r.id} style={{ gap: 2 }}>
              <Text variant="label">
                {t(`review.kind_${r.kind}`, { name: r.actorName ?? t('invite.someone') })} · {formatDate(locale, r.createdAt)}
              </Text>
              {r.note ? <Text muted>{`\u201C${r.note}\u201D`}</Text> : null}
            </View>
          ))}
        </View>
      )}

      <View style={{ gap: spacing.md }}>
        <Text variant="sectionTitle">{t('feed.stageTimeline')}</Text>
        {data.updates.length === 0 && <Text muted>{t('feed.empty')}</Text>}
        {data.updates.map((u, i) => (
          <View key={u.id} style={{ flexDirection: 'row', gap: spacing.md }}>
            {/* The timeline rail: a dot per update, joined by a line. */}
            <View style={{ alignItems: 'center', width: 14 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 18, backgroundColor: colors.primary }} />
              {i < data.updates.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: colors.border }} />}
            </View>
            <View style={{ flex: 1 }}>
              <FeedCard update={u} />
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Stage review (Phase 3): the contractor marks the stage ready; the owner accepts the exact
 * revision with a deliberate slide, or asks for changes with a note.
 */
function ReviewPanel({ data, projectId, onChange }: { data: StageTimeline; projectId: string; onChange: (d: StageTimeline) => void }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [slideKey, setSlideKey] = useState(0);
  const s = data.stage;
  const lastChanges = data.reviews.find((r) => r.kind === 'changes_requested');
  const input = {
    minHeight: 64,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    textAlignVertical: 'top',
  } as const;

  const run = async (call: () => Promise<StageTimeline>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await withRefresh(call));
      setNote('');
      setAsking(false);
      setConflict(false);
    } catch (err) {
      setSlideKey((k) => k + 1);
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    run(() =>
      request(() =>
        api.POST('/v1/projects/{id}/stages/{stageId}/submit', {
          params: { path: { id: projectId, stageId: s.id } },
          body: note.trim() ? { note: note.trim() } : {},
        }),
      ),
    );
  const review = (decision: 'accept' | 'request_changes') =>
    run(() =>
      request(() =>
        api.POST('/v1/projects/{id}/stages/{stageId}/review', {
          params: { path: { id: projectId, stageId: s.id }, header: { 'If-Match': `"${s.revision}"` } },
          body: decision === 'accept' ? { decision } : { decision, note: note.trim() },
        }),
      ),
    );
  const reload = () =>
    run(() => request(() => api.GET('/v1/projects/{id}/stages/{stageId}/timeline', { params: { path: { id: projectId, stageId: s.id } } })));

  if (s.status === 'accepted')
    return (
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: status('paid').soft }}>
        <CheckCircle2 size={18} color={status('paid').color} style={{ marginTop: 2 }} />
        <Text color={status('paid').color} style={{ flex: 1 }}>
          {t('review.acceptedNote')}
        </Text>
      </View>
    );

  return (
    <View style={{ gap: spacing.sm }}>
      {s.status === 'changes_required' && lastChanges?.note && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: status('problem').soft }}>
          <MessageSquare size={18} color={status('problem').color} style={{ marginTop: 2 }} />
          <Text color={status('problem').color} style={{ flex: 1 }}>
            {t('review.changesAsked', { note: lastChanges.note })}
          </Text>
        </View>
      )}

      {data.canSubmit && (
        <Card>
          <Text variant="sectionTitle">{t('review.submitTitle')}</Text>
          <Text muted style={{ marginVertical: spacing.xs }}>
            {t('review.submitLead')}
          </Text>
          <TextInput
            accessibilityLabel={t('review.submitNote')}
            value={note}
            onChangeText={setNote}
            placeholder={t('review.submitNotePlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            multiline
            maxLength={500}
            style={input}
          />
          <View style={{ marginTop: spacing.sm }}>
            <Button title={busy ? t('review.submitting') : t('review.submit')} loading={busy} block onPress={() => void submit()} />
          </View>
        </Card>
      )}

      {s.status === 'ready_for_review' && !data.canReview && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: status('waiting').soft }}>
          <Clock size={18} color={status('waiting').color} style={{ marginTop: 2 }} />
          <Text color={status('waiting').color}>{t('review.waitingOwner')}</Text>
        </View>
      )}

      {data.canReview && !conflict && (
        <Card>
          <Text variant="sectionTitle">{t('review.reviewTitle')}</Text>
          <Text muted style={{ marginVertical: spacing.xs }}>
            {t('review.reviewLead', { weight: s.weight })}
          </Text>
          {asking ? (
            <View style={{ gap: spacing.sm }}>
              <TextInput
                accessibilityLabel={t('accept.changesLabel')}
                value={note}
                onChangeText={setNote}
                placeholder={t('review.changesPlaceholder')}
                placeholderTextColor={colors.inkSubtle}
                multiline
                maxLength={500}
                autoFocus
                style={input}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title={t('common.cancel')} variant="secondary" onPress={() => setAsking(false)} />
                <View style={{ flex: 1 }}>
                  <Button
                    title={busy ? t('accept.sending') : t('review.sendChanges')}
                    block
                    loading={busy}
                    disabled={note.trim().length < 3}
                    onPress={() => void review('request_changes')}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <SlideToApprove
                key={slideKey}
                amount={0}
                label={t('review.slideToAccept', { stage: s.name })}
                doneLabel={t('accept.acceptedShort')}
                onApprove={() => void review('accept')}
              />
              <Button title={t('accept.requestChanges')} icon={MessageSquare} variant="ghost" onPress={() => setAsking(true)} />
            </View>
          )}
        </Card>
      )}

      {conflict && (
        <Card>
          <Text>{t('review.conflict')}</Text>
          <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
            <Button title={t('plan.reload')} variant="secondary" onPress={() => void reload()} />
          </View>
        </Card>
      )}
      {error && (
        <Text variant="caption" color={status('problem').color} alert>
          {error}
        </Text>
      )}
    </View>
  );
}
