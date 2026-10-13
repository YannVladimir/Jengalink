import type { ProjectAcceptanceView, ProjectStage } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { Button, Card, Money, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, CheckCircle2, CircleAlert, MessageSquare, ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fromIsoDate } from '@/components/DatePickerSheet';
import { PromiseList } from '@/components/invitation';
import { SlideToApprove } from '@/components/SlideToApprove';
import { BottomAction } from '@/components/ui';
import { ApiError, api, useAuth } from '@/lib/auth';

/**
 * The owner reviews the contract value and the stage plan, then accepts the exact
 * version they saw (the project starts and the plan locks) or asks for changes.
 */
export default function AcceptProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();

  const [view, setView] = useState<ProjectAcceptanceView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [outcome, setOutcome] = useState<'accepted' | 'changes' | null>(null);
  const [slideKey, setSlideKey] = useState(0);

  const fetchView = useCallback(
    () => withRefresh(() => request(() => api.GET('/v1/projects/{id}/acceptance', { params: { path: { id } } }))),
    [id, withRefresh],
  );
  useEffect(() => {
    let live = true;
    fetchView()
      .then((v) => live && setView(v))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [fetchView]);

  const reload = () => {
    setLoadFailed(false);
    setConflict(false);
    setError(null);
    setSlideKey((k) => k + 1);
    fetchView()
      .then(setView)
      .catch(() => setLoadFailed(true));
  };

  const decide = async (decision: 'accept' | 'request_changes') => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const next = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/acceptance', {
            params: { path: { id }, header: { 'If-Match': `"${view.revision}"` } },
            body: decision === 'accept' ? { decision } : { decision, note: note.trim() },
          }),
        ),
      );
      setView(next);
      setOutcome(decision === 'accept' ? 'accepted' : 'changes');
    } catch (err) {
      setSlideKey((k) => k + 1);
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (loadFailed)
    return (
      <Centered>
        <Text muted>{t('common.somethingWrong')}</Text>
        <Button title={t('common.tryAgain')} variant="secondary" onPress={reload} />
      </Centered>
    );
  if (!view)
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} />
      </Centered>
    );

  const ok = status('paid');
  if (outcome === 'changes')
    return (
      <Outcome icon={<MessageSquare size={30} color={colors.structure} />} soft={colors.structureSoft} title={t('accept.changesSentTitle', { org: view.organizationName })} lead={t('accept.changesSentLead')} />
    );
  if (outcome === 'accepted' || view.status !== 'draft')
    return <Outcome icon={<Check size={32} color={ok.color} />} soft={ok.soft} title={t('accept.acceptedTitle')} lead={t('accept.acceptedLead')} />;

  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const value = view.contractValue;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 220 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" muted>
            {view.projectName} · {view.organizationName}
          </Text>
          <Text variant="screenTitle">{t('accept.title')}</Text>
          <Text muted>{t('accept.lead')}</Text>
        </View>

        <Card>
          <Text variant="label" muted>
            {t('accept.valueLabel')}
          </Text>
          {value !== null ? <Money amount={value} variant="moneyLarge" /> : <Text variant="sectionTitle">{t('accept.noValue')}</Text>}
          <Text variant="caption" muted style={{ marginTop: spacing.xs }}>
            {t('accept.valueNote', { org: view.organizationName })}
          </Text>
        </Card>

        <View style={{ gap: spacing.sm }}>
          <Text variant="sectionTitle">{t('accept.stagesTitle')}</Text>
          {view.stages.map((s) => (
            <StageSummary key={s.id} stage={s} fmt={fmt} />
          ))}
        </View>

        <PromiseList
          icon={ShieldCheck}
          tone="keep"
          title={t('accept.meansTitle')}
          items={[t('accept.means1'), t('accept.means2'), t('accept.means3')]}
        />

        {!view.ready && (
          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <CircleAlert size={18} color={status('waiting').color} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{t('accept.notReadyTitle')}</Text>
                {!view.readiness.contractValue && <Text muted>{t('accept.missingValue')}</Text>}
                {!view.readiness.stages && <Text muted>{t('accept.missingStages')}</Text>}
                <Text muted>{t('accept.askContractor', { org: view.organizationName })}</Text>
              </View>
            </View>
          </Card>
        )}

        {view.history.length > 0 && (
          <View style={{ gap: spacing.xs }}>
            <Text variant="sectionTitle">{t('accept.historyTitle')}</Text>
            {view.history.map((h) => (
              <View key={h.id} style={{ gap: 2 }}>
                <Text variant="label">
                  {t(h.decision === 'accepted' ? 'accept.historyAccepted' : 'accept.historyChanges', {
                    name: h.decidedByName ?? t('invite.someone'),
                    date: formatDate(locale, h.decidedAt),
                  })}
                </Text>
                {h.note && <Text muted>“{h.note}”</Text>}
              </View>
            ))}
          </View>
        )}

        {!view.canDecide && (
          <Text muted>{t('accept.waitingOwner')}</Text>
        )}

        {conflict && (
          <Card>
            <Text>{t('accept.conflict')}</Text>
            <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
              <Button title={t('accept.seeNewVersion')} variant="secondary" onPress={reload} />
            </View>
          </Card>
        )}
        {error && (
          <Text variant="caption" color={status('problem').color} alert>
            {error}
          </Text>
        )}
      </ScrollView>

      {view.canDecide && !conflict && (
        <BottomAction>
          {asking ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="label">{t('accept.changesLabel')}</Text>
              <TextInput
                accessibilityLabel={t('accept.changesLabel')}
                value={note}
                onChangeText={setNote}
                placeholder={t('accept.changesPlaceholder')}
                placeholderTextColor={colors.inkSubtle}
                multiline
                maxLength={500}
                autoFocus
                style={{
                  minHeight: 72,
                  padding: spacing.md,
                  borderWidth: 1.5,
                  borderColor: colors.borderStrong,
                  borderRadius: radius.md,
                  color: colors.ink,
                  backgroundColor: colors.surface,
                  fontSize: 16,
                  fontFamily: 'Inter_400Regular',
                  textAlignVertical: 'top',
                }}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title={t('common.cancel')} variant="secondary" size="lg" onPress={() => setAsking(false)} />
                <View style={{ flex: 1 }}>
                  <Button
                    title={busy ? t('accept.sending') : t('accept.sendChanges', { org: view.organizationName })}
                    size="lg"
                    block
                    loading={busy}
                    disabled={note.trim().length < 3}
                    onPress={() => void decide('request_changes')}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {view.ready && value !== null && (
                <SlideToApprove
                  key={slideKey}
                  amount={value}
                  label={t('accept.slideToAccept', { value: formatRwf(value) })}
                  doneLabel={t('accept.acceptedShort')}
                  onApprove={() => void decide('accept')}
                />
              )}
              <Button title={t('accept.requestChanges')} icon={MessageSquare} variant="ghost" onPress={() => setAsking(true)} />
            </View>
          )}
        </BottomAction>
      )}
    </SafeAreaView>
  );
}

function StageSummary({ stage: s, fmt }: { stage: ProjectStage; fmt: (iso: string) => string }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const dates = s.plannedStart || s.plannedEnd ? `${s.plannedStart ? fmt(s.plannedStart) : '…'} – ${s.plannedEnd ? fmt(s.plannedEnd) : '…'}` : t('plan.noDates');
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.structureSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" color={colors.structure}>
            {s.position}
          </Text>
        </View>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {s.name}
        </Text>
        <Text variant="bodyStrong">{s.weight}%</Text>
      </View>
      <Text variant="caption" muted style={{ marginTop: 4, marginLeft: 34 }}>
        {dates}
      </Text>
      {s.description ? (
        <Text muted style={{ marginTop: 4, marginLeft: 34 }}>
          {s.description}
        </Text>
      ) : null}
      {s.criteria.length > 0 && (
        <View style={{ marginTop: spacing.sm, marginLeft: 34, gap: 4 }}>
          {s.criteria.map((c) => (
            <View key={c} style={{ flexDirection: 'row', gap: 6 }}>
              <CheckCircle2 size={15} color={status('paid').color} style={{ marginTop: 3 }} />
              <Text style={{ flex: 1 }}>{c}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  const { colors } = useJengaTheme();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background }}>{children}</View>;
}

function Outcome({ icon, soft, title, lead }: { icon: React.ReactNode; soft: string; title: string; lead: string }) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: soft }}>{icon}</View>
        <Text variant="screenTitle">{title}</Text>
        <Text muted>{lead}</Text>
        <Button title={t('wizard.doneButton')} size="lg" block onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </SafeAreaView>
  );
}
