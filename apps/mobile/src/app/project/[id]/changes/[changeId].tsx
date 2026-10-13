import { type BudgetChangesOverview, type BudgetChangeView, type ChangeCategory, type CommercialBasis, MAX_CHANGE_LINES } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { FileText, Paperclip, Plus, Send, Undo2, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SlideToApprove } from '@/components/SlideToApprove';
import { BottomAction } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';

const CATEGORIES: ChangeCategory[] = ['owner_request', 'unforeseen_conditions', 'specification_change', 'quantity_correction'];
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatRwf(Math.abs(n))}`;
type Line =
  { kind: 'existing'; milestoneIndex: number | null; sign: 1 | -1; amount: number | null } | { kind: 'new'; name: string; basis: CommercialBasis; feePercent: number | null; amount: number | null };

/** A budget change: editor for the contractor side; read view and the owner's answer otherwise. */
export default function ChangeScreen() {
  const { id, changeId } = useLocalSearchParams<{ id: string; changeId: string }>();
  const isNew = changeId === 'new';
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [ov, setOv] = useState<BudgetChangesOverview | null>(null);
  const [view, setView] = useState<BudgetChangeView | null>(null);
  const [category, setCategory] = useState<ChangeCategory>('owner_request');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [lines, setLines] = useState<Line[]>([{ kind: 'existing', milestoneIndex: null, sign: 1, amount: null }]);
  const [newFiles, setNewFiles] = useState<{ uri: string; name: string }[]>([]);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = (c: BudgetChangeView) => {
    setView(c);
    setCategory(c.category);
    setReason(c.reason);
    setDays(c.scheduleDays == null ? '' : String(c.scheduleDays));
    setLines(
      c.lines.map((l) =>
        l.milestoneIndex != null
          ? { kind: 'existing', milestoneIndex: l.milestoneIndex, sign: l.delta < 0 ? -1 : 1, amount: Math.abs(l.delta) }
          : { kind: 'new', name: l.name, basis: l.basis, feePercent: l.feePercent, amount: l.delta },
      ),
    );
    setNewFiles([]);
  };

  useEffect(() => {
    let live = true;
    Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/changes', { params: { path: { id } } }))),
      isNew ? Promise.resolve(null) : withRefresh(() => request(() => api.GET('/v1/projects/{id}/changes/{changeId}', { params: { path: { id, changeId } } }))),
    ])
      .then(([o, c]) => {
        if (!live) return;
        setOv(o);
        if (c) load(c);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, changeId, isNew, withRefresh]);

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!ov || (!isNew && !view))
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  const editable = isNew ? ov.canPropose : !!view?.canEdit;
  if (!editable && view) return <ReadOnly view={view} projectId={id} onChange={load} />;

  const deltaOf = (l: Line) => (l.amount ?? 0) * (l.kind === 'existing' ? l.sign : 1);
  const net = lines.reduce((s, l) => s + deltaOf(l), 0);
  const picked = lines.filter((l) => l.kind === 'existing').map((l) => (l as { milestoneIndex: number | null }).milestoneIndex);
  const valid =
    reason.trim().length >= 10 &&
    lines.length > 0 &&
    lines.every((l) => !!l.amount && (l.kind === 'existing' ? l.milestoneIndex !== null : l.name.trim().length >= 2 && (l.basis === 'fixed' || l.feePercent !== null))) &&
    new Set(picked).size === picked.length;
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? ({ ...l, ...patch } as Line) : l)));
  const input = { borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: radius.md, padding: spacing.md, color: colors.ink, backgroundColor: colors.surface, fontSize: 16 } as const;
  const pill = (on: boolean) =>
    ({
      paddingHorizontal: 12,
      minHeight: 40,
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: on ? colors.primary : colors.border,
      backgroundColor: on ? colors.surface : 'transparent',
    }) as const;

  const save = async (): Promise<BudgetChangeView | null> => {
    setError(null);
    try {
      const files: { uploadKey: string; fileName: string | null }[] = [];
      for (const f of newFiles) {
        const grant = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/changes/uploads', { params: { path: { id } }, body: { contentType: 'application/pdf' } })));
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: await (await fetch(f.uri)).blob() });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        files.push({ uploadKey: grant.key, fileName: f.name });
      }
      const body = {
        category,
        reason: reason.trim(),
        scheduleDays: days.trim() === '' ? null : Number(days),
        lines: lines.map((l) =>
          l.kind === 'existing'
            ? { milestoneIndex: l.milestoneIndex, delta: deltaOf(l) }
            : { newPackage: { name: l.name.trim(), basis: l.basis, feePercent: l.basis === 'reimbursable' ? l.feePercent : null }, delta: deltaOf(l) },
        ),
        files,
        removeFileIds: [],
      };
      const next = view
        ? await withRefresh(() => request(() => api.PUT('/v1/projects/{id}/changes/{changeId}', { params: { path: { id, changeId: view.id }, header: { 'If-Match': `"${view.version}"` } }, body })))
        : await withRefresh(() =>
            request(() => api.POST('/v1/projects/{id}/changes', { params: { path: { id }, header: { 'Idempotency-Key': `ch-${Date.now()}-${Math.round(Math.random() * 1e9)}` } }, body })),
          );
      load(next);
      if (isNew) router.setParams({ changeId: next.id });
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      return null;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 200 }} keyboardShouldPersistTaps="handled">
        {view?.stale ? (
          <Banner tone="problem" text={t('changes.stale', { version: ov.agreementVersion ?? 1 })} />
        ) : (
          <Banner tone="info" text={view?.status === 'submitted' ? t('changes.waitingOwner') : t('changes.draftPrivate')} />
        )}
        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('changes.category')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setCategory(c)} accessibilityRole="radio" accessibilityState={{ checked: category === c }} style={pill(category === c)}>
                <Text variant="caption" color={category === c ? colors.ink : colors.inkMuted}>
                  {t(`changes.category_${c}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text variant="label">{t('changes.reason')}</Text>
          <TextInput
            accessibilityLabel={t('changes.reason')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('changes.reasonPlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            multiline
            maxLength={2000}
            style={{ ...input, minHeight: 90, textAlignVertical: 'top' }}
          />
          <Text variant="label">{t('changes.scheduleDays')}</Text>
          <TextInput
            accessibilityLabel={t('changes.scheduleDays')}
            value={days}
            onChangeText={(v) => setDays(v.replace(/[^0-9-]/g, ''))}
            keyboardType="numbers-and-punctuation"
            style={{ ...input, width: 120 }}
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('changes.lines')}</Text>
          {lines.map((l, i) => {
            const pkg = l.kind === 'existing' && l.milestoneIndex !== null ? ov.lines.find((x) => x.index === l.milestoneIndex) : undefined;
            const now = pkg?.current ?? 0;
            const floor = view?.lines.find((x) => (l.kind === 'existing' ? x.milestoneIndex === l.milestoneIndex : x.milestoneIndex === null && x.name === l.name))?.floor ?? 0;
            const after = now + deltaOf(l);
            return (
              <Card key={i}>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <Pressable onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('spending.removeLine')}>
                    <X size={18} color={colors.inkMuted} />
                  </Pressable>
                </View>
                {l.kind === 'existing' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {ov.lines.map((x) => (
                      <Pressable
                        key={x.index}
                        onPress={() => setLine(i, { milestoneIndex: x.index })}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: l.milestoneIndex === x.index }}
                        style={pill(l.milestoneIndex === x.index)}
                      >
                        <Text variant="caption" color={l.milestoneIndex === x.index ? colors.ink : colors.inkMuted}>
                          {x.name} · {formatRwf(x.current)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    <TextInput
                      accessibilityLabel={t('changes.newName')}
                      value={l.name}
                      onChangeText={(name) => setLine(i, { name })}
                      placeholder={t('changes.newName')}
                      placeholderTextColor={colors.inkSubtle}
                      maxLength={120}
                      style={input}
                    />
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {(['fixed', 'reimbursable'] as const).map((k) => (
                        <Pressable key={k} onPress={() => setLine(i, { basis: k })} accessibilityRole="radio" accessibilityState={{ checked: l.basis === k }} style={pill(l.basis === k)}>
                          <Text variant="caption" color={l.basis === k ? colors.ink : colors.inkMuted}>
                            {t(`basis.${k}`)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {l.basis === 'reimbursable' && (
                      <TextInput
                        accessibilityLabel={t('basis.feeLabel')}
                        placeholder={t('basis.feeLabel')}
                        placeholderTextColor={colors.inkSubtle}
                        keyboardType="decimal-pad"
                        value={l.feePercent == null ? '' : String(l.feePercent)}
                        onChangeText={(v) => setLine(i, { feePercent: v.trim() === '' ? null : Math.round(Number(v.replace(',', '.')) * 10) / 10 })}
                        style={{ ...input, width: 140 }}
                      />
                    )}
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginTop: spacing.sm }}>
                  {l.kind === 'existing' && (
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {([1, -1] as const).map((sg) => (
                        <Pressable
                          key={sg}
                          onPress={() => setLine(i, { sign: sg })}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: l.sign === sg }}
                          style={{ ...pill(l.sign === sg), width: 44, alignItems: 'center' }}
                        >
                          <Text variant="bodyStrong">{sg === 1 ? '+' : '−'}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <AmountInput label={t('changes.delta')} value={l.amount} onChange={(amount) => setLine(i, { amount })} />
                  </View>
                </View>
                <Text variant="caption" muted style={{ marginTop: 4 }}>
                  {l.kind === 'new' ? t('changes.newTag') : `${t('changes.before')} ${formatRwf(now)}`} → {formatRwf(after)}
                </Text>
                {floor > 0 && (
                  <Text variant="caption" color={after < floor ? status('problem').color : colors.inkMuted}>
                    {t('changes.floorLine', { amount: formatRwf(floor) })}
                  </Text>
                )}
              </Card>
            );
          })}
          {lines.length < MAX_CHANGE_LINES && (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title={t('changes.addExisting')} icon={Plus} variant="ghost" onPress={() => setLines((ls) => [...ls, { kind: 'existing', milestoneIndex: null, sign: 1, amount: null }])} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t('changes.addNew')} icon={Plus} variant="ghost" onPress={() => setLines((ls) => [...ls, { kind: 'new', name: '', basis: 'fixed', feePercent: null, amount: null }])} />
              </View>
            </View>
          )}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('changes.evidence')}</Text>
          {(view?.files ?? []).map((f) => (
            <Pressable key={f.id} disabled={!f.url} onPress={() => f.url && Linking.openURL(f.url)} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <FileText size={16} color={colors.inkMuted} />
              <Text numberOfLines={1}>{f.fileName ?? 'PDF'}</Text>
            </Pressable>
          ))}
          {newFiles.map((f) => (
            <Text key={f.uri} numberOfLines={1}>
              {f.name}
            </Text>
          ))}
          <Button
            title={t('claims.addDocument')}
            icon={Paperclip}
            variant="secondary"
            onPress={async () => {
              const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
              if (!res.canceled) setNewFiles((f) => [...f, { uri: res.assets[0].uri, name: res.assets[0].name }]);
            }}
          />
        </View>
        {view?.canWithdraw && (
          <Button
            title={t('changes.withdraw')}
            icon={Undo2}
            variant="ghost"
            onPress={() =>
              Alert.alert(t('changes.withdraw'), t('changes.withdrawConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('changes.withdraw'),
                  style: 'destructive',
                  onPress: async () =>
                    load(
                      await withRefresh(() =>
                        request(() => api.POST('/v1/projects/{id}/changes/{changeId}/withdraw', { params: { path: { id, changeId: view.id }, header: { 'If-Match': `"${view.version}"` } } })),
                      ),
                    ),
                },
              ])
            }
          />
        )}
      </ScrollView>
      <BottomAction>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{t('changes.net')}</Text>
          <Text variant="money">{signed(net)}</Text>
        </View>
        <Text variant="caption" muted>
          {t('changes.contractLine', { before: formatRwf(ov.current), after: formatRwf(ov.current + net) })}
        </Text>
        {error && <Text color={status('problem').color}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title={t('changes.saveDraft')}
              variant="secondary"
              disabled={!valid || busy !== null}
              loading={busy === 'save'}
              onPress={async () => {
                setBusy('save');
                await save();
                setBusy(null);
              }}
            />
          </View>
          {(!view || view.status === 'draft') && (
            <View style={{ flex: 1 }}>
              <Button
                title={t('changes.send')}
                icon={Send}
                disabled={!valid || busy !== null}
                loading={busy === 'send'}
                onPress={async () => {
                  setBusy('send');
                  const current = await save();
                  if (current && current.status === 'draft') {
                    try {
                      load(
                        await withRefresh(() =>
                          request(() => api.POST('/v1/projects/{id}/changes/{changeId}/submit', { params: { path: { id, changeId: current.id }, header: { 'If-Match': `"${current.version}"` } } })),
                        ),
                      );
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
                    }
                  }
                  setBusy(null);
                }}
              />
            </View>
          )}
        </View>
      </BottomAction>
    </SafeAreaView>
  );
}

/** Net change and contract first, each package before → after, why, then the owner's answer. */
function ReadOnly({ view: c, projectId, onChange }: { view: BudgetChangeView; projectId: string; onChange: (c: BudgetChangeView) => void }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {c.number} · {t(`changes.status_${c.status}`)}
      </Text>
      <Text variant="moneyLarge">{signed(c.netDelta)}</Text>
      <Text variant="sectionTitle">{t(`changes.category_${c.category}`)}</Text>
      <Text variant="caption" muted>
        {t('changes.contractLine', { before: formatRwf(c.contractBefore), after: formatRwf(c.contractAfter) })}
        {c.scheduleDays != null ? ` · ${t('changes.scheduleLine', { days: c.scheduleDays })}` : ''}
      </Text>
      {c.submittedAt && (
        <Text variant="caption" muted>
          {t('claims.sentLine', { date: formatDate(locale, c.submittedAt), name: c.createdByName ?? t('claims.someone') })}
        </Text>
      )}
      {c.stale && <Banner tone="problem" text={t('changes.stale', { version: c.baseVersion + 1 })} />}
      {c.status === 'applied' && <Banner tone="ok" text={t('changes.appliedBanner', { version: c.appliedVersion ?? 0 })} />}
      {c.status === 'rejected' && <Banner tone="problem" text={t('changes.rejectedBanner')} />}
      <Card>
        <Text variant="label" muted>
          {t('changes.reason')}
        </Text>
        <Text style={{ marginTop: 4 }}>{c.reason}</Text>
      </Card>
      <Card>
        {c.lines.map((l, i) => (
          <View key={i} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {l.name}
                {l.milestoneIndex == null ? ` (${t('changes.newTag')})` : ''}
              </Text>
              <Text variant="bodyStrong">{signed(l.delta)}</Text>
            </View>
            <Text variant="caption" muted>
              {formatRwf(l.before)} → {formatRwf(l.after)}
            </Text>
            {l.after < l.floor && (
              <Text variant="caption" color={status('problem').color}>
                {t('changes.belowFloor')}
              </Text>
            )}
          </View>
        ))}
      </Card>
      {c.files.map((f) => (
        <Pressable key={f.id} disabled={!f.url} onPress={() => f.url && Linking.openURL(f.url)} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <FileText size={16} color={colors.inkMuted} />
          <Text numberOfLines={1}>{f.fileName ?? 'PDF'}</Text>
        </Pressable>
      ))}
      {c.canDecide && !c.stale && <DecisionPanel view={c} projectId={projectId} onChange={onChange} />}
      {c.decisions.map((d) => (
        <Card key={d.at}>
          <Text variant="bodyStrong">{t(`changes.decided_${d.kind}`, { name: d.byName ?? t('claims.someone'), date: formatDate(locale, d.at) })}</Text>
          {d.note ? <Text style={{ marginTop: 4 }}>“{d.note}”</Text> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

function DecisionPanel({ view, projectId, onChange }: { view: BudgetChangeView; projectId: string; onChange: (c: BudgetChangeView) => void }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slideKey, setSlideKey] = useState(0);
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/changes/{changeId}/decision', {
              params: { path: { id: projectId, changeId: view.id }, header: { 'If-Match': `"${view.version}"`, 'Idempotency-Key': `cd-${Date.now()}-${Math.round(Math.random() * 1e9)}` } },
              body: { decision, netDelta: view.netDelta, ...(note.trim() ? { note: note.trim() } : {}) },
            }),
          ),
        ),
      );
    } catch (err) {
      setSlideKey((k) => k + 1);
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text variant="sectionTitle">{t('claims.decideTitle')}</Text>
      <Text muted style={{ marginVertical: spacing.xs }}>
        {t('changes.approveConfirmBody', { before: formatRwf(view.contractBefore), after: formatRwf(view.contractAfter) })}
      </Text>
      {rejecting ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            accessibilityLabel={t('changes.rejectLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('changes.rejectLabel')}
            placeholderTextColor={colors.inkSubtle}
            multiline
            style={{
              minHeight: 64,
              padding: spacing.md,
              borderWidth: 1.5,
              borderColor: colors.borderStrong,
              borderRadius: radius.md,
              color: colors.ink,
              backgroundColor: colors.surface,
              fontSize: 16,
              textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setRejecting(false)} />
            <View style={{ flex: 1 }}>
              <Button title={t('changes.sendReject')} variant="danger" block loading={busy} disabled={note.trim().length < 3} onPress={() => void decide('reject')} />
            </View>
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <SlideToApprove key={slideKey} amount={Math.abs(view.netDelta)} label={t('changes.slideToApprove')} doneLabel={t('changes.status_applied')} onApprove={() => void decide('approve')} />
          <Button title={t('claims.reject')} variant="ghost" onPress={() => setRejecting(true)} />
        </View>
      )}
      {error && (
        <Text variant="caption" color={status('problem').color} style={{ marginTop: spacing.sm }}>
          {error}
        </Text>
      )}
    </Card>
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
