import {
  MAX_EXCLUSIONS,
  MAX_MILESTONES,
  marginOf,
  milestonesFromStages,
  type ProjectStage,
  type ProjectSummary,
  quoteTotal,
  type QuoteView,
} from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, FileText, ListChecks, Lock, Plus, Send, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DatePickerSheet, fromIsoDate } from '@/components/DatePickerSheet';
import { BottomAction } from '@/components/ui';
import { SlideToApprove } from '@/components/SlideToApprove';
import { api, useAuth } from '@/lib/auth';
import { localDate } from '@/lib/outbox-core';
import { QuoteStatusChip as StatusChip } from '@/components/quote';

interface Draft {
  title: string;
  scope: string;
  milestones: {
    name: string;
    description: string;
    amount: number | null;
    stageId: string | null;
    basis: 'fixed' | 'reimbursable';
    feePercent: number | null;
    internalCost: number | null;
  }[];
  exclusions: string[];
  terms: string;
  validUntil: string;
}
const inDays = (n: number) => localDate(new Date(Date.now() + n * 86_400_000));
const emptyMilestone = (): Draft['milestones'][number] => ({ name: '', description: '', amount: null, stageId: null, basis: 'fixed', feePercent: null, internalCost: null });
const blank = (): Draft => ({ title: '', scope: '', milestones: [emptyMilestone()], exclusions: [], terms: '', validUntil: inDays(30) });
const fromView = (q: QuoteView): Draft => ({
  title: q.title,
  scope: q.scope,
  milestones: q.milestones.map((m, i) => ({
    name: m.name,
    description: m.description ?? '',
    amount: m.amount,
    stageId: m.stageId,
    basis: m.basis,
    feePercent: m.feePercent,
    internalCost: q.internal?.costs[i] ?? null,
  })),
  exclusions: [...q.exclusions],
  terms: q.terms ?? '',
  validUntil: q.validUntil,
});
const toBody = (d: Draft) => ({
  title: d.title.trim(),
  scope: d.scope.trim(),
  milestones: d.milestones.map((m) => ({
    name: m.name.trim(),
    description: m.description.trim() || null,
    amount: m.amount ?? 0,
    stageId: m.stageId,
    basis: m.basis,
    feePercent: m.basis === 'reimbursable' ? m.feePercent : null,
    internalCost: m.internalCost,
  })),
  exclusions: d.exclusions,
  terms: d.terms.trim() || null,
  validUntil: d.validUntil,
});

/**
 * Quote builder (Phase 4): scope, priced milestones, exclusions, terms and validity, with a branded
 * PDF. Owners read the sent revision. Once sent, a revision is frozen; editing starts the next one.
 */
export default function QuoteScreen() {
  const { id, quoteId } = useLocalSearchParams<{ id: string; quoteId: string }>();
  const isNew = quoteId === 'new';
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [view, setView] = useState<QuoteView | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'send' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const [exclusion, setExclusion] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/stages', { params: { path: { id } } }))),
      isNew ? Promise.resolve(null) : withRefresh(() => request(() => api.GET('/v1/projects/{id}/quotes/{quoteId}', { params: { path: { id, quoteId } } }))),
    ])
      .then(([p, s, q]) => {
        if (!live) return;
        setProject(p);
        setStages(s);
        if (q) {
          setView(q);
          setDraft(fromView(q));
        }
        setLoaded(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, quoteId, isNew, withRefresh]);

  const change = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setSaved(false);
  };
  const total = quoteTotal(draft.milestones.map((m) => ({ amount: m.amount ?? 0 })));
  const setMilestone = (i: number, patch: Partial<Draft['milestones'][number]>) =>
    change({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  // Private costs: for the contractor's own company only (the server returns them only there).
  const showPrivate = isNew || view?.internal != null;
  const privateMargin = marginOf(
    draft.milestones.map((m) => ({ amount: m.amount ?? 0 })),
    draft.milestones.map((m) => m.internalCost),
  );
  const valid =
    draft.title.trim().length >= 2 &&
    draft.scope.trim().length >= 3 &&
    draft.milestones.length > 0 &&
    draft.milestones.every((m) => m.name.trim().length >= 2 && m.amount !== null && (m.basis === 'fixed' || m.feePercent !== null)) &&
    total > 0 &&
    draft.validUntil >= localDate();

  const save = async (): Promise<QuoteView | null> => {
    setError(null);
    try {
      const next = view
        ? await withRefresh(() =>
            request(() =>
              api.PUT('/v1/projects/{id}/quotes/{quoteId}', {
                params: { path: { id, quoteId: view.id }, header: { 'If-Match': `"${view.version}"` } },
                body: toBody(draft),
              }),
            ),
          )
        : await withRefresh(() => request(() => api.POST('/v1/projects/{id}/quotes', { params: { path: { id } }, body: toBody(draft) })));
      setView(next);
      setDraft(fromView(next));
      setDirty(false);
      if (isNew) router.setParams({ quoteId: next.id });
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      return null;
    }
  };

  const onSave = async () => {
    setBusy('save');
    if (await save()) setSaved(true);
    setBusy(null);
  };

  const onSend = async () => {
    setBusy('send');
    const current = dirty || !view ? await save() : view;
    if (current) {
      try {
        const sent = await withRefresh(() =>
          request(() => api.POST('/v1/projects/{id}/quotes/{quoteId}/send', { params: { path: { id, quoteId: current.id } } })),
        );
        setView(sent);
        setDraft(fromView(sent));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      }
    }
    setBusy(null);
  };

  const onPdf = async () => {
    if (!view) return;
    setBusy('pdf');
    try {
      const link = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/quotes/{quoteId}/pdf', { params: { path: { id, quoteId: view.id }, query: { revision: view.revision } } }),
        ),
      );
      await Linking.openURL(link.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!loaded || !project)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  const editable = isNew ? project.myRoles.some((r) => r === 'contractor' || r === 'manager') : !!view?.canEdit;
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const input = {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  } as const;
  const splitAmount = total > 0 ? total : (project.contractValue ?? 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="caption" muted style={{ flex: 1 }}>
            {view ? `${view.number} · ${t('quote.revision', { n: view.revision })}` : t('quote.newQuote')} · {project.name}
          </Text>
          {view && <StatusChip status={view.status} />}
        </View>

        {view?.decision?.kind === 'accepted' && (
          <Banner
            tone="ok"
            text={t('agreement.acceptedBanner', {
              name: view.decision.byName ?? t('invite.someone'),
              date: formatDate(locale, view.decision.at),
              version: view.decision.agreementVersion ?? 1,
              value: formatRwf(view.total),
            })}
          />
        )}
        {view?.decision?.kind === 'declined' && (
          <Banner
            tone="problem"
            text={`${t('agreement.declinedBanner', { name: view.decision.byName ?? t('invite.someone'), date: formatDate(locale, view.decision.at) })}${view.decision.note ? ' ' + t('agreement.declinedReason', { note: view.decision.note }) : ''}`}
          />
        )}
        {view?.status === 'expired' && view.canEdit && <Banner tone="problem" text={t('quote.expiredNote', { date: fmt(view.validUntil) })} />}
        {view?.sentAt && view.canEdit && view.status !== 'expired' && (
          <Banner tone="info" text={t('quote.sentNote', { n: view.revision, date: formatDate(locale, view.sentAt) })} />
        )}
        {view && !view.sentAt && view.revisions.some((r) => r.sentAt) && <Banner tone="info" text={t('quote.newRevisionNote', { n: view.revision })} />}

        {editable ? (
          <>
            <Field label={t('quote.titleLabel')}>
              <TextInput accessibilityLabel={t('quote.titleLabel')} value={draft.title} onChangeText={(title) => change({ title })} placeholder={t('quote.titlePlaceholder')} placeholderTextColor={colors.inkSubtle} maxLength={120} style={input} />
            </Field>
            <Field label={t('quote.scopeLabel')}>
              <TextInput
                accessibilityLabel={t('quote.scopeLabel')}
                value={draft.scope}
                onChangeText={(scope) => change({ scope })}
                placeholder={t('quote.scopePlaceholder')}
                placeholderTextColor={colors.inkSubtle}
                multiline
                maxLength={4000}
                style={{ ...input, minHeight: 100, textAlignVertical: 'top' }}
              />
            </Field>

            <Field label={t('quote.milestonesLabel')}>
              {stages.length > 0 && (
                <View style={{ gap: 4 }}>
                  <Button
                    title={t('quote.fromPlan')}
                    icon={ListChecks}
                    variant="secondary"
                    onPress={() =>
                      change({
                        milestones: milestonesFromStages(stages, splitAmount).map((m) => ({ ...emptyMilestone(), name: m.name, amount: m.amount, stageId: m.stageId ?? null })),
                      })
                    }
                  />
                  <Text variant="caption" muted>
                    {t('quote.fromPlanHint', { amount: formatRwf(splitAmount) })}
                  </Text>
                </View>
              )}
              {draft.milestones.map((m, i) => (
                <Card key={i}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text variant="label" muted>
                      {i + 1}
                    </Text>
                    <TextInput
                      accessibilityLabel={`${t('quote.milestoneName')} ${i + 1}`}
                      value={m.name}
                      onChangeText={(name) => change({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, name } : x)) })}
                      placeholder={t('quote.milestoneName')}
                      placeholderTextColor={colors.inkSubtle}
                      maxLength={120}
                      style={{ ...input, flex: 1, minWidth: 0, paddingVertical: 10 }}
                    />
                    {draft.milestones.length > 1 && (
                      <Pressable
                        onPress={() => change({ milestones: draft.milestones.filter((_, j) => j !== i) })}
                        accessibilityRole="button"
                        accessibilityLabel={t('quote.removeMilestone', { name: m.name })}
                        hitSlop={8}
                        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <X size={18} color={colors.inkMuted} />
                      </Pressable>
                    )}
                  </View>
                  <BasisSwitch value={m.basis} onChange={(basis) => setMilestone(i, { basis })} />
                  <Text variant="caption" muted style={{ marginTop: 4 }}>
                    {t(m.basis === 'fixed' ? 'basis.explainFixed' : 'basis.explainReimbursable')}
                  </Text>
                  <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                    <AmountInput label={t('quote.milestoneAmount')} value={m.amount} onChange={(amount) => setMilestone(i, { amount })} />
                    {m.basis === 'reimbursable' && (
                      <View style={{ gap: 4 }}>
                        <Text variant="label">{t('basis.feeLabel')}</Text>
                        <TextInput
                          accessibilityLabel={t('basis.feeLabel')}
                          keyboardType="decimal-pad"
                          value={m.feePercent == null ? '' : String(m.feePercent)}
                          onChangeText={(v) => {
                            const n = Number(v.replace(',', '.'));
                            setMilestone(i, { feePercent: v.trim() === '' || Number.isNaN(n) ? null : Math.min(100, Math.round(n * 10) / 10) });
                          }}
                          placeholder="10"
                          placeholderTextColor={colors.inkSubtle}
                          style={{ ...input, width: 120, paddingVertical: 10 }}
                        />
                      </View>
                    )}
                    {showPrivate && (
                      <View style={{ gap: 4, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}>
                        <AmountInput label={t('basis.internalCost')} value={m.internalCost} onChange={(internalCost) => setMilestone(i, { internalCost })} />
                      </View>
                    )}
                  </View>
                </Card>
              ))}
              {draft.milestones.length < MAX_MILESTONES && (
                <Button
                  title={t('quote.addMilestone')}
                  icon={Plus}
                  variant="ghost"
                  onPress={() => change({ milestones: [...draft.milestones, emptyMilestone()] })}
                />
              )}
            </Field>

            <Field label={t('quote.exclusionsLabel')}>
              {draft.exclusions.map((e, i) => (
                <View key={`${i}-${e}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 }}>
                  <Text style={{ flex: 1 }}>• {e}</Text>
                  <Pressable
                    onPress={() => change({ exclusions: draft.exclusions.filter((_, j) => j !== i) })}
                    accessibilityRole="button"
                    accessibilityLabel={t('quote.removeExclusion', { text: e })}
                    hitSlop={8}
                    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={18} color={colors.inkMuted} />
                  </Pressable>
                </View>
              ))}
              {draft.exclusions.length < MAX_EXCLUSIONS && (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput
                    accessibilityLabel={t('quote.exclusionsLabel')}
                    value={exclusion}
                    onChangeText={setExclusion}
                    placeholder={t('quote.exclusionPlaceholder')}
                    placeholderTextColor={colors.inkSubtle}
                    maxLength={200}
                    style={{ ...input, flex: 1, minWidth: 0, paddingVertical: 10 }}
                  />
                  <Button
                    title={t('quote.addExclusion')}
                    variant="secondary"
                    disabled={exclusion.trim().length < 2}
                    onPress={() => {
                      change({ exclusions: [...draft.exclusions, exclusion.trim()] });
                      setExclusion('');
                    }}
                  />
                </View>
              )}
            </Field>

            <Field label={t('quote.termsLabel')}>
              <TextInput
                accessibilityLabel={t('quote.termsLabel')}
                value={draft.terms}
                onChangeText={(terms) => change({ terms })}
                placeholder={t('quote.termsPlaceholder')}
                placeholderTextColor={colors.inkSubtle}
                multiline
                maxLength={2000}
                style={{ ...input, minHeight: 80, textAlignVertical: 'top' }}
              />
            </Field>

            <Field label={t('quote.validUntil')}>
              <Pressable
                onPress={() => setPicking(true)}
                accessibilityRole="button"
                accessibilityLabel={`${t('quote.validUntil')}: ${fmt(draft.validUntil)}`}
                style={{ ...input, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <CalendarDays size={18} color={colors.inkMuted} />
                <Text>{fmt(draft.validUntil)}</Text>
              </Pressable>
              {draft.validUntil < localDate() && (
                <Text variant="caption" color={status('problem').color}>
                  {t('quote.pastDate')}
                </Text>
              )}
            </Field>
          </>
        ) : (
          view && <ReadOnly q={view} />
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: 2, borderTopColor: colors.primary }}>
          <Text variant="sectionTitle">{t('quote.total')}</Text>
          <Text variant="moneyLarge">{formatRwf(editable ? total : (view?.total ?? 0))}</Text>
        </View>

        {editable && showPrivate && (
          <View style={{ gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Lock size={16} color={colors.inkMuted} />
              <Text variant="label">{t('basis.privateTitle')}</Text>
            </View>
            <Text variant="caption" muted>
              {t('basis.privateHint')}
            </Text>
            {privateMargin.totalCost === null ? (
              <Text variant="caption" muted>
                {t('basis.marginUnknown')}
              </Text>
            ) : (
              <>
                <Row label={t('basis.totalCost')} value={formatRwf(privateMargin.totalCost)} />
                <Row label={t('basis.margin')} value={t('basis.marginLine', { amount: formatRwf(privateMargin.margin ?? 0), percent: privateMargin.marginPercent ?? 0 })} />
              </>
            )}
          </View>
        )}

        {view?.canDecide && <DecisionPanel view={view} projectId={id} onChange={(v) => { setView(v); setDraft(fromView(v)); }} />}

        {view && <Button title={busy === 'pdf' ? t('quote.pdfPreparing') : t('quote.pdf')} icon={FileText} variant="secondary" loading={busy === 'pdf'} onPress={() => void onPdf()} />}
        {error && (
          <Text variant="caption" color={status('problem').color} alert>
            {error}
          </Text>
        )}
      </ScrollView>

      {editable && (
        <BottomAction>
          <View style={{ gap: spacing.xs }}>
            {saved && !dirty && (
              <Text variant="caption" muted style={{ textAlign: 'center' }}>
                {t('quote.saved')}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                title={busy === 'save' ? t('quote.saving') : t('quote.save')}
                variant="secondary"
                size="lg"
                loading={busy === 'save'}
                disabled={!valid || (!dirty && !!view) || !!busy}
                onPress={() => void onSave()}
              />
              <View style={{ flex: 1 }}>
                <Button
                  title={busy === 'send' ? t('quote.sending') : t('quote.send')}
                  icon={Send}
                  size="lg"
                  block
                  loading={busy === 'send'}
                  disabled={!valid || !!busy || (!!view?.sentAt && !dirty)}
                  onPress={() => void onSend()}
                />
              </View>
            </View>
          </View>
        </BottomAction>
      )}

      <DatePickerSheet
        visible={picking}
        title={t('quote.validUntil')}
        value={draft.validUntil}
        min={localDate()}
        onPick={(iso) => {
          change({ validUntil: iso });
          setPicking(false);
        }}
        onClear={() => setPicking(false)}
        onClose={() => setPicking(false)}
      />
    </SafeAreaView>
  );
}

function ReadOnly({ q }: { q: QuoteView }) {
  const { t, locale } = useI18n();
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: 4 }}>
        <Text variant="screenTitle">{q.title}</Text>
        <Text variant="caption" muted>
          {q.organizationName} · {t('quote.validLine', { date: formatDate(locale, fromIsoDate(q.validUntil)) })}
        </Text>
        <Text variant="caption" muted>
          {t('basis.quoteBasis', { basis: t(`basis.${q.commercialBasis}`) })}
        </Text>
      </View>
      <Field label={t('quote.scopeLabel')}>
        <Text>{q.scope}</Text>
      </Field>
      <Field label={t('quote.milestonesLabel')}>
        <Card flush>
          {q.milestones.map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: i ? 1 : 0, borderTopColor: '#0001' }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{m.name}</Text>
                <Text variant="caption" muted>
                  {m.basis === 'reimbursable' ? t('basis.reimbursableLine', { fee: m.feePercent ?? 0 }) : t('basis.fixedLine')}
                </Text>
                {m.description ? (
                  <Text variant="caption" muted>
                    {m.description}
                  </Text>
                ) : null}
              </View>
              <Text variant="bodyStrong">{formatRwf(m.amount)}</Text>
            </View>
          ))}
        </Card>
      </Field>
      {q.exclusions.length > 0 && (
        <Field label={t('quote.exclusionsLabel')}>
          {q.exclusions.map((e) => (
            <Text key={e}>• {e}</Text>
          ))}
        </Field>
      )}
      {q.terms && (
        <Field label={t('quote.termsLabel')}>
          <Text>{q.terms}</Text>
        </Field>
      )}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label">{label}</Text>
      {children}
    </View>
  );
}

function Banner({ tone, text }: { tone: 'info' | 'problem' | 'ok'; text: string }) {
  const { colors, status } = useJengaTheme();
  const c = tone === 'problem' ? status('problem') : tone === 'ok' ? status('paid') : { color: colors.structure, soft: colors.structureSoft };
  return (
    <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: c.soft }}>
      <Text color={c.color}>{text}</Text>
    </View>
  );
}

/** The owner's decision on the exact revision shown: a deliberate slide to accept, or decline with a reason. */
function DecisionPanel({ view, projectId, onChange }: { view: QuoteView; projectId: string; onChange: (v: QuoteView) => void }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [slideKey, setSlideKey] = useState(0);

  const decide = async (decision: 'accept' | 'decline') => {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/quotes/{quoteId}/decision', {
              params: { path: { id: projectId, quoteId: view.id }, header: { 'If-Match': `"${view.version}"` } },
              body: { decision, revision: view.revision, ...(note.trim() ? { note: note.trim() } : {}) },
            }),
          ),
        ),
      );
    } catch (err) {
      setSlideKey((k) => k + 1);
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (conflict)
    return (
      <Card>
        <Text>{t('agreement.conflict')}</Text>
        <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
          <Button title={t('plan.reload')} variant="secondary" onPress={() => router.replace({ pathname: '/project/[id]/quotes/[quoteId]', params: { id: projectId, quoteId: view.id } })} />
        </View>
      </Card>
    );

  return (
    <Card>
      <Text variant="sectionTitle">{t('agreement.decisionTitle')}</Text>
      <Text muted style={{ marginVertical: spacing.xs }}>
        {t('agreement.acceptLead', { value: formatRwf(view.total) })}
      </Text>
      {declining ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('agreement.declineLabel')}</Text>
          <TextInput
            accessibilityLabel={t('agreement.declineLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('agreement.declinePlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            multiline
            maxLength={500}
            style={{ minHeight: 64, padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: radius.md, color: colors.ink, backgroundColor: colors.surface, fontSize: 16, textAlignVertical: 'top' }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setDeclining(false)} />
            <View style={{ flex: 1 }}>
              <Button title={t('agreement.sendDecline')} variant="danger" block loading={busy} onPress={() => void decide('decline')} />
            </View>
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SlideToApprove
            key={slideKey}
            amount={view.total}
            label={t('agreement.slideToAccept', { value: formatRwf(view.total) })}
            doneLabel={t('accept.acceptedShort')}
            onApprove={() => void decide('accept')}
          />
          <Button title={t('agreement.decline')} variant="ghost" onPress={() => setDeclining(true)} />
        </View>
      )}
      {error && (
        <Text variant="caption" color={status('problem').color} alert style={{ marginTop: spacing.sm }}>
          {error}
        </Text>
      )}
    </Card>
  );
}

function BasisSwitch({ value, onChange }: { value: 'fixed' | 'reimbursable'; onChange: (v: 'fixed' | 'reimbursable') => void }) {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('basis.label')} style={{ flexDirection: 'row', marginTop: spacing.sm, padding: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}>
      {(['fixed', 'reimbursable'] as const).map((k) => {
        const on = value === k;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            accessibilityRole="radio"
            aria-checked={on}
            style={{ flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.surface : 'transparent' }}
          >
            <Text variant="label" color={on ? colors.ink : colors.inkMuted}>
              {t(`basis.${k}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
      <Text muted>{label}</Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}
