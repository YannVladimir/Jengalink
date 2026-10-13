import {
  type AttachedFile,
  lineAmount,
  MAX_SPENDING_FILES,
  MAX_SPENDING_LINES,
  type ProjectBudget,
  type ProjectStage,
  type ProjectSummary,
  type SpendingView,
  spendingTotal,
} from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Check, FileText, ImagePlus, Loader, Paperclip, Plus, ReceiptText, Send, ShieldAlert, Undo2, Wallet, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DatePickerSheet, fromIsoDate } from '@/components/DatePickerSheet';
import { SlideToApprove } from '@/components/SlideToApprove';
import { ExpenseCard } from '@/components/receipt';
import { SpendingStatusChip } from '@/components/spending';
import { BottomAction } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';
import { localDate } from '@/lib/outbox-core';

const REQUESTERS = ['contractor', 'manager'];
const QTY = /^\d{1,7}(\.\d{1,3})?$/;
interface Line {
  description: string;
  quantity: string;
  unit: string;
  unitRate: number | null;
}
interface LocalFile {
  uri: string;
  name: string | null;
  contentType: string;
}
const emptyLine = (): Line => ({
  description: '',
  quantity: '1',
  unit: '',
  unitRate: null,
});

/** A spending request: editor for the contractor side; read view, ledger, expenses and the owner's answer otherwise. */
export default function SpendingRequestScreen() {
  const { id, requestId } = useLocalSearchParams<{
    id: string;
    requestId: string;
  }>();
  const isNew = requestId === 'new';
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [view, setView] = useState<SpendingView | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [requiredDate, setRequiredDate] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [newFiles, setNewFiles] = useState<LocalFile[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = (r: SpendingView) => {
    setView(r);
    setIndex(r.milestoneIndex);
    setStageId(r.stageId);
    setPurpose(r.purpose);
    setRequiredDate(r.requiredDate);
    setLines(
      r.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitRate: l.unitRate,
      })),
    );
    setNewFiles([]);
    setRemoved([]);
  };

  useEffect(() => {
    let live = true;
    Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/budget', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/stages', { params: { path: { id } } }))),
      isNew
        ? Promise.resolve(null)
        : withRefresh(() =>
            request(() =>
              api.GET('/v1/projects/{id}/spending/{requestId}', {
                params: { path: { id, requestId } },
              }),
            ),
          ),
    ])
      .then(([p, b, s, r]) => {
        if (!live) return;
        setProject(p);
        setBudget(b);
        setStages(s);
        if (r) load(r);
        else if (b.lines.length === 1) setIndex(b.lines[0].index);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, requestId, isNew, withRefresh]);

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!project || !budget || (!isNew && !view))
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  const editable = isNew ? project.myRoles.some((r) => REQUESTERS.includes(r)) : !!view?.canEdit;
  if (!editable && view) return <ReadOnly view={view} projectId={id} onChange={load} />;

  const touch = () => setSaved(false);
  const line = budget.lines.find((l) => l.index === index);
  const linesValid = lines.every((l) => l.description.trim().length >= 2 && QTY.test(l.quantity.trim()) && Number(l.quantity) > 0 && l.unit.trim() && l.unitRate);
  const total = linesValid
    ? spendingTotal(
        lines.map((l) => ({
          quantity: l.quantity.trim(),
          unitRate: l.unitRate ?? 0,
        })),
      )
    : null;
  const over = !!line && total !== null && total > line.headroom;
  const canSave = !!line && purpose.trim().length >= 3 && linesValid;
  const keptFiles = (view?.files ?? []).filter((f) => !removed.includes(f.id));
  const room = MAX_SPENDING_FILES - keptFiles.length - newFiles.length;
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
  const setLine = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    touch();
  };

  const save = async (): Promise<SpendingView | null> => {
    if (index === null) return null;
    setError(null);
    try {
      const files: { uploadKey: string; fileName: string | null }[] = [];
      for (const f of newFiles) {
        const grant = await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/spending/uploads', {
              params: { path: { id } },
              body: { contentType: f.contentType as 'application/pdf' },
            }),
          ),
        );
        const put = await fetch(grant.url, {
          method: 'PUT',
          headers: grant.headers,
          body: await (await fetch(f.uri)).blob(),
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        files.push({ uploadKey: grant.key, fileName: f.name });
      }
      const body = {
        milestoneIndex: index,
        stageId,
        purpose: purpose.trim(),
        requiredDate,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          quantity: l.quantity.trim(),
          unit: l.unit.trim(),
          unitRate: l.unitRate ?? 0,
        })),
        files,
        removeFileIds: removed,
      };
      const next = view
        ? await withRefresh(() =>
            request(() =>
              api.PUT('/v1/projects/{id}/spending/{requestId}', {
                params: {
                  path: { id, requestId: view.id },
                  header: { 'If-Match': `"${view.version}"` },
                },
                body,
              }),
            ),
          )
        : await withRefresh(() =>
            request(() =>
              api.POST('/v1/projects/{id}/spending', {
                params: {
                  path: { id },
                  header: {
                    'Idempotency-Key': `sr-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
                  },
                },
                body,
              }),
            ),
          );
      load(next);
      if (isNew) router.setParams({ requestId: next.id });
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      return null;
    }
  };

  const onSend = async () => {
    setBusy('send');
    const current = await save();
    if (current && current.status !== 'submitted') {
      try {
        load(
          await withRefresh(() =>
            request(() =>
              api.POST('/v1/projects/{id}/spending/{requestId}/submit', {
                params: {
                  path: { id, requestId: current.id },
                  header: { 'If-Match': `"${current.version}"` },
                },
              }),
            ),
          ),
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      }
    }
    setBusy(null);
  };

  const onWithdraw = () =>
    view &&
    Alert.alert(t('spending.withdraw'), t('spending.withdrawConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('spending.withdraw'),
        style: 'destructive',
        onPress: async () => {
          try {
            load(
              await withRefresh(() =>
                request(() =>
                  api.POST('/v1/projects/{id}/spending/{requestId}/withdraw', {
                    params: {
                      path: { id, requestId: view.id },
                      header: { 'If-Match': `"${view.version}"` },
                    },
                  }),
                ),
              ),
            );
          } catch (err) {
            setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
          }
        },
      },
    ]);

  const addPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: room,
    });
    if (res.canceled) return;
    setNewFiles((f) => [
      ...f,
      ...res.assets.slice(0, room).map((a) => ({
        uri: a.uri,
        name: a.fileName ?? null,
        contentType: a.mimeType ?? 'image/jpeg',
      })),
    ]);
    touch();
  };
  const addDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    setNewFiles((f) => [
      ...f,
      ...res.assets.slice(0, room).map((a) => ({
        uri: a.uri,
        name: a.name,
        contentType: 'application/pdf',
      })),
    ]);
    touch();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.lg,
          paddingBottom: 200,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <Text variant="caption" muted style={{ flex: 1 }}>
            {view ? view.number : t('spending.newRequest')} · {project.name}
          </Text>
          {view && <SpendingStatusChip status={view.status} />}
        </View>
        <Banner
          tone={view?.status === 'changes_requested' ? 'problem' : 'info'}
          text={
            view?.status === 'changes_requested'
              ? `${t('spending.changesBanner')}${view.decisions[0]?.note ? `\n“${view.decisions[0].note}”` : ''}`
              : view?.status === 'submitted'
                ? t('spending.waitingOwner')
                : t('spending.draftPrivate')
          }
        />

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('spending.package')}</Text>
          {budget.lines.map((l) => {
            const on = index === l.index;
            return (
              <Pressable
                key={l.index}
                onPress={() => {
                  setIndex(l.index);
                  touch();
                }}
                accessibilityRole="radio"
                aria-checked={on}
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: on ? 2 : 1.5,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: colors.surface,
                  gap: 2,
                }}
              >
                <Text variant="bodyStrong">{l.name}</Text>
                <Text variant="caption" muted>
                  {t('spending.costBudget', {
                    amount: formatRwf(l.costBudget),
                  })}
                </Text>
                <Text variant="caption" color={l.headroom <= 0 ? status('problem').color : colors.inkMuted}>
                  {t('spending.free')} {formatRwf(l.headroom)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('spending.purpose')}</Text>
          <TextInput
            accessibilityLabel={t('spending.purpose')}
            value={purpose}
            onChangeText={(v) => {
              setPurpose(v);
              touch();
            }}
            placeholder={t('spending.purposePlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            maxLength={300}
            style={input}
          />
          <Button
            title={requiredDate ? `${t('spending.requiredDate')}: ${formatDate(locale, fromIsoDate(requiredDate))}` : t('spending.requiredDate')}
            icon={CalendarDays}
            variant="secondary"
            onPress={() => setPicking(true)}
          />
          {stages.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text variant="label">{t('spending.stage')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { id: null as string | null, name: t('spending.noStage') },
                  ...stages.map((s) => ({
                    id: s.id as string | null,
                    name: s.name,
                  })),
                ].map((s) => {
                  const on = stageId === s.id;
                  return (
                    <Pressable
                      key={s.id ?? 'none'}
                      onPress={() => {
                        setStageId(s.id);
                        touch();
                      }}
                      accessibilityRole="radio"
                      aria-checked={on}
                      style={{
                        paddingHorizontal: 12,
                        minHeight: 44,
                        justifyContent: 'center',
                        borderRadius: radius.pill,
                        borderWidth: 1.5,
                        borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.surface : 'transparent',
                      }}
                    >
                      <Text variant="caption" color={on ? colors.ink : colors.inkMuted}>
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('spending.lines')}</Text>
          {lines.map((l, i) => (
            <Card key={i}>
              <View
                style={{
                  flexDirection: 'row',
                  gap: spacing.sm,
                  alignItems: 'center',
                }}
              >
                <TextInput
                  accessibilityLabel={`${t('spending.lineDescription')} ${i + 1}`}
                  value={l.description}
                  onChangeText={(v) => setLine(i, { description: v })}
                  placeholder={t('spending.lineDescription')}
                  placeholderTextColor={colors.inkSubtle}
                  maxLength={200}
                  style={{
                    ...input,
                    flex: 1,
                    minWidth: 0,
                    paddingVertical: 10,
                  }}
                />
                {lines.length > 1 && (
                  <Pressable
                    onPress={() => {
                      setLines((ls) => ls.filter((_, j) => j !== i));
                      touch();
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('spending.removeLine')}
                    style={{
                      width: 40,
                      height: 40,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={18} color={colors.inkMuted} />
                  </Pressable>
                )}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  gap: spacing.sm,
                  marginTop: spacing.sm,
                }}
              >
                <TextInput
                  accessibilityLabel={`${t('spending.quantity')} ${i + 1}`}
                  value={l.quantity}
                  onChangeText={(v) => setLine(i, { quantity: v.replace(',', '.') })}
                  keyboardType="decimal-pad"
                  placeholder={t('spending.quantity')}
                  placeholderTextColor={colors.inkSubtle}
                  style={{
                    ...input,
                    width: 90,
                    paddingVertical: 10,
                    borderColor: l.quantity && !QTY.test(l.quantity.trim()) ? status('problem').color : colors.borderStrong,
                  }}
                />
                <TextInput
                  accessibilityLabel={`${t('spending.unit')} ${i + 1}`}
                  value={l.unit}
                  onChangeText={(v) => setLine(i, { unit: v })}
                  placeholder={t('spending.unit')}
                  placeholderTextColor={colors.inkSubtle}
                  maxLength={20}
                  style={{
                    ...input,
                    flex: 1,
                    minWidth: 0,
                    paddingVertical: 10,
                  }}
                />
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <AmountInput label={t('spending.unitRate')} value={l.unitRate} onChange={(unitRate) => setLine(i, { unitRate })} />
              </View>
              {QTY.test(l.quantity.trim()) && !!l.unitRate && (
                <Text variant="bodyStrong" style={{ marginTop: spacing.sm, textAlign: 'right' }}>
                  {formatRwf(lineAmount(l.quantity.trim(), l.unitRate))}
                </Text>
              )}
            </Card>
          ))}
          {lines.length < MAX_SPENDING_LINES && (
            <Button
              title={t('spending.addLine')}
              icon={Plus}
              variant="ghost"
              onPress={() => {
                setLines((ls) => [...ls, emptyLine()]);
                touch();
              }}
            />
          )}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('spending.quotations')}</Text>
          {keptFiles.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              onRemove={() => {
                setRemoved((r) => [...r, f.id]);
                touch();
              }}
            />
          ))}
          {newFiles.map((f, i) => (
            <View
              key={f.uri}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                padding: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <FileText size={20} color={colors.inkMuted} />
              <Text style={{ flex: 1 }} numberOfLines={1}>
                {f.name ?? t('claims.photo')}
              </Text>
              <Pressable onPress={() => setNewFiles((n) => n.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('claims.remove')}>
                <X size={18} color={colors.inkMuted} />
              </Pressable>
            </View>
          ))}
          {room > 0 && (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title={t('claims.addPhoto')} icon={ImagePlus} variant="secondary" onPress={addPhoto} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t('claims.addDocument')} icon={Paperclip} variant="secondary" onPress={addDocument} />
              </View>
            </View>
          )}
        </View>
        {view?.canWithdraw && <Button title={t('spending.withdraw')} variant="ghost" icon={Undo2} onPress={onWithdraw} />}
      </ScrollView>
      <BottomAction>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{t('spending.total')}</Text>
          <Text variant="money">{total === null ? '—' : formatRwf(total)}</Text>
        </View>
        {over && line && (
          <Text color={status('problem').color}>
            {t('spending.overHeadroom', {
              amount: formatRwf(Math.max(0, line.headroom)),
            })}
          </Text>
        )}
        {error && <Text color={status('problem').color} alert>{error}</Text>}
        {saved && !error && <Text color={status('paid').color}>{t('quote.saved')}</Text>}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title={t('spending.saveDraft')}
              variant="secondary"
              onPress={async () => {
                setBusy('save');
                if (await save()) setSaved(true);
                setBusy(null);
              }}
              disabled={!canSave || busy !== null}
              loading={busy === 'save'}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t('spending.send')} icon={Send} onPress={onSend} disabled={!canSave || over || busy !== null} loading={busy === 'send'} />
          </View>
        </View>
      </BottomAction>
      <DatePickerSheet
        visible={picking}
        title={t('spending.requiredDate')}
        value={requiredDate}
        min={localDate()}
        onPick={(iso) => {
          setRequiredDate(iso);
          setPicking(false);
          touch();
        }}
        onClear={() => {
          setRequiredDate(null);
          setPicking(false);
          touch();
        }}
        onClose={() => setPicking(false)}
      />
    </SafeAreaView>
  );
}

/** Amount and purpose first, the items and quotations, the request's ledger, expenses, then the next step. */
function ReadOnly({ view: r, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="caption" muted style={{ flex: 1 }}>
          {r.number} · {r.milestoneName}
        </Text>
        <SpendingStatusChip status={r.status} />
      </View>
      <Text variant="moneyLarge">{formatRwf(r.amount)}</Text>
      <Text variant="sectionTitle">{r.purpose}</Text>
      <Text variant="caption" muted>
        {t('claims.agreementVersion', { version: r.agreementVersion })}
        {r.stageName ? ` · ${r.stageName}` : ''}
        {r.requiredDate ? ` · ${t('spending.requiredDate')} ${formatDate(locale, fromIsoDate(r.requiredDate))}` : ''}
      </Text>
      {r.submittedAt && (
        <Text variant="caption" muted>
          {t('claims.sentLine', {
            date: formatDate(locale, r.submittedAt),
            name: r.createdByName ?? t('claims.someone'),
          })}
        </Text>
      )}
      {r.status === 'submitted' && !r.canDecide && <Banner tone="info" text={t('spending.waitingOwner')} />}
      {r.status === 'approved' && <Banner tone="ok" text={t('spending.approvedBanner', { amount: formatRwf(r.reserved) })} />}
      {r.status === 'closed' && <Banner tone="info" text={t('spending.closedBanner')} />}
      {r.status === 'rejected' && <Banner tone="problem" text={t('spending.rejectedBanner')} />}

      <Card>
        {r.lines.map((l, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              gap: spacing.sm,
              paddingVertical: 6,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{l.description}</Text>
              <Text variant="caption" muted>
                {t('spending.lineTotal', {
                  qty: l.quantity,
                  unit: l.unit,
                  rate: formatRwf(l.unitRate),
                })}
              </Text>
            </View>
            <Text variant="bodyStrong">{formatRwf(l.amount)}</Text>
          </View>
        ))}
      </Card>
      {r.files.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('spending.quotations')}</Text>
          {r.files.map((f) => (
            <FileRow key={f.id} file={f} />
          ))}
        </View>
      )}

      {r.reserved > 0 && (
        <View
          style={{
            gap: 4,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <Text variant="label">{t('spending.ledgerTitle')}</Text>
          <Row label={t('spending.ledgerReserved')} value={formatRwf(r.reserved)} />
          <Row label={t('spending.ledgerPosted')} value={`− ${formatRwf(r.posted)}`} />
          {r.released > 0 && <Row label={t('spending.ledgerReleased')} value={`− ${formatRwf(r.released)}`} />}
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 4,
            }}
          >
            <Row label={t('spending.ledgerLeft')} value={formatRwf(r.committed)} strong />
          </View>
        </View>
      )}

      {(r.status === 'approved' || r.status === 'closed') && (
        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('spending.expensesTitle')}</Text>
          {r.expenses.length === 0 && <Text muted>{t('spending.noExpenses')}</Text>}
          {r.missingReceipts > 0 && <Banner tone="problem" text={t('receipt.missingCount', { count: r.missingReceipts })} />}
          {r.expenses.map((e) => (
            <ExpenseCard key={e.id} expense={e} projectId={projectId} onChange={onChange} />
          ))}
          {r.canPostExpense && <ExpenseForm view={r} projectId={projectId} onChange={onChange} />}
          {r.canClose && <CloseButton view={r} projectId={projectId} onChange={onChange} />}
        </View>
      )}

      {r.canDecide && <DecisionPanel view={r} projectId={projectId} onChange={onChange} />}
      {r.decisions.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text variant="label">{t('claims.history')}</Text>
          {r.decisions.map((d) => (
            <Card key={d.at}>
              <Text variant="bodyStrong">
                {t(`claims.decided_${d.kind}`, {
                  name: d.byName ?? t('claims.someone'),
                  date: formatDate(locale, d.at),
                })}
              </Text>
              <Text variant="caption" muted>
                {formatRwf(d.amount)}
              </Text>
              {d.note ? <Text style={{ marginTop: 4 }}>“{d.note}”</Text> : null}
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ExpenseForm({ view, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(localDate());
  const [amount, setAmount] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = amount !== null && amount > view.committed;
  const valid = description.trim().length >= 2 && !!amount && !over;
  const input = {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 16,
  } as const;

  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          marginBottom: spacing.sm,
        }}
      >
        <ReceiptText size={16} color={colors.inkMuted} />
        <Text variant="sectionTitle">{t('spending.recordExpense')}</Text>
      </View>
      <View style={{ gap: spacing.sm }}>
        <TextInput
          accessibilityLabel={t('spending.expenseDescription')}
          value={description}
          onChangeText={setDescription}
          placeholder={t('spending.expenseDescription')}
          placeholderTextColor={colors.inkSubtle}
          maxLength={200}
          style={input}
        />
        <TextInput
          accessibilityLabel={t('spending.supplier')}
          value={supplier}
          onChangeText={setSupplier}
          placeholder={t('spending.supplier')}
          placeholderTextColor={colors.inkSubtle}
          maxLength={120}
          style={input}
        />
        <Button title={`${t('spending.expenseDate')}: ${formatDate(locale, fromIsoDate(date))}`} icon={CalendarDays} variant="secondary" onPress={() => setPicking(true)} />
        <AmountInput label={t('spending.expenseAmount')} value={amount} onChange={setAmount} />
        {over && <Text color={status('problem').color}>{t('spending.overReserved', { amount: formatRwf(view.committed) })}</Text>}
        <Text variant="caption" muted>
          {t('spending.expenseHint')}
        </Text>
        {error && <Text color={status('problem').color} alert>{error}</Text>}
        <Button
          title={t('spending.postExpense')}
          icon={Check}
          disabled={!valid}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              const next = await withRefresh(() =>
                request(() =>
                  api.POST('/v1/projects/{id}/spending/{requestId}/expenses', {
                    params: {
                      path: { id: projectId, requestId: view.id },
                      header: {
                        'Idempotency-Key': `ex-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
                      },
                    },
                    body: {
                      description: description.trim(),
                      supplierName: supplier.trim() || null,
                      expenseDate: date,
                      amount: amount ?? 0,
                    },
                  }),
                ),
              );
              // Ready for the next receipt.
              setDescription('');
              setSupplier('');
              setAmount(null);
              onChange(next);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      <DatePickerSheet
        visible={picking}
        title={t('spending.expenseDate')}
        value={date}
        onPick={(iso) => {
          if (iso <= localDate()) setDate(iso);
          setPicking(false);
        }}
        onClear={() => setPicking(false)}
        onClose={() => setPicking(false)}
      />
    </Card>
  );
}

function CloseButton({ view, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const amount = formatRwf(view.committed);
  return (
    <Button
      title={t('spending.closeRequest', { amount })}
      icon={Wallet}
      variant="secondary"
      onPress={() =>
        Alert.alert(t('spending.closeRequest', { amount }), t('spending.closeConfirm', { amount }), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('spending.closeRequest', { amount }),
            onPress: async () =>
              onChange(
                await withRefresh(() =>
                  request(() =>
                    api.POST('/v1/projects/{id}/spending/{requestId}/close', {
                      params: {
                        path: { id: projectId, requestId: view.id },
                        header: { 'If-Match': `"${view.version}"` },
                      },
                    }),
                  ),
                ),
              ),
          },
        ])
      }
    />
  );
}

/** The owner's answer: a slide to approve (which reserves the amount), or a reason to send it back or reject it. */
function DecisionPanel({ view, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [mode, setMode] = useState<'approve' | 'request_changes' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [slideKey, setSlideKey] = useState(0);

  const decide = async (decision: typeof mode) => {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/spending/{requestId}/decision', {
              params: {
                path: { id: projectId, requestId: view.id },
                header: {
                  'If-Match': `"${view.version}"`,
                  'Idempotency-Key': `sd-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
                },
              },
              body: {
                decision,
                amount: view.amount,
                ...(note.trim() ? { note: note.trim() } : {}),
              },
            }),
          ),
        ),
      );
    } catch (err) {
      setSlideKey((k) => k + 1);
      if (err instanceof ApiError && err.status === 412) setStale(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (stale)
    return (
      <Card>
        <Text>{t('claims.staleAnswer')}</Text>
        <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
          <Button
            title={t('plan.reload')}
            variant="secondary"
            onPress={() =>
              router.replace({
                pathname: '/project/[id]/spending/[requestId]',
                params: { id: projectId, requestId: view.id },
              })
            }
          />
        </View>
      </Card>
    );

  const amount = formatRwf(view.amount);
  return (
    <Card>
      <Text variant="sectionTitle">{t('claims.decideTitle')}</Text>
      <Text muted style={{ marginVertical: spacing.xs }}>
        {t('spending.decideHint', { amount, line: view.milestoneName })}
      </Text>
      {mode === 'approve' ? (
        <View style={{ gap: spacing.sm }}>
          <SlideToApprove key={slideKey} amount={view.amount} label={t('spending.slideToApprove', { amount })} doneLabel={t('spending.status_approved')} onApprove={() => void decide('approve')} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title={t('claims.askChanges')} variant="secondary" onPress={() => setMode('request_changes')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('claims.reject')} variant="ghost" onPress={() => setMode('reject')} />
            </View>
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t(mode === 'reject' ? 'claims.rejectLabel' : 'claims.changesLabel')}</Text>
          <TextInput
            accessibilityLabel={t(mode === 'reject' ? 'claims.rejectLabel' : 'claims.changesLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('claims.reasonPlaceholder')}
            placeholderTextColor={colors.inkSubtle}
            multiline
            maxLength={1000}
            style={{
              minHeight: 72,
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
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setMode('approve')} />
            <View style={{ flex: 1 }}>
              <Button
                title={t(mode === 'reject' ? 'spending.sendReject' : 'claims.sendChanges')}
                variant={mode === 'reject' ? 'danger' : 'primary'}
                block
                loading={busy}
                disabled={note.trim().length < 3}
                onPress={() => void decide(mode)}
              />
            </View>
          </View>
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

function FileRow({ file: f, onRemove }: { file: AttachedFile; onRemove?: () => void }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const bad = f.status === 'blocked' || f.status === 'failed';
  const Icon = f.status === 'processing' ? Loader : bad ? ShieldAlert : FileText;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {f.kind === 'photo' && f.thumbUrl ? (
        <Image source={{ uri: f.thumbUrl }} style={{ width: 48, height: 48, borderRadius: radius.sm }} accessibilityIgnoresInvertColors />
      ) : (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <Icon size={20} color={bad ? status('problem').color : colors.inkMuted} />
        </View>
      )}
      <Pressable style={{ flex: 1, minWidth: 0 }} disabled={!f.url} onPress={() => f.url && Linking.openURL(f.url)} accessibilityRole="link">
        <Text variant="bodyStrong" numberOfLines={1}>
          {f.fileName ?? (f.kind === 'photo' ? t('claims.photo') : 'PDF')}
        </Text>
        <Text variant="caption" color={bad ? status('problem').color : colors.inkMuted}>
          {f.status === 'ready' ? `${t('claims.open')} · ${Math.max(1, Math.round(f.sizeBytes / 1024))} KB` : t(`claims.file_${f.status}`)}
        </Text>
      </Pressable>
      {onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('claims.remove')}
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={18} color={colors.inkMuted} />
        </Pressable>
      )}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.sm,
      }}
    >
      <Text muted={!strong} variant={strong ? 'bodyStrong' : 'body'}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

function Banner({ tone, text }: { tone: 'info' | 'problem' | 'ok'; text: string }) {
  const { colors, status } = useJengaTheme();
  const c = tone === 'problem' ? status('problem') : tone === 'ok' ? status('paid') : { color: colors.structure, soft: colors.structureSoft };
  return (
    <View
      style={{
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: c.soft,
      }}
    >
      <Text color={c.color}>{text}</Text>
    </View>
  );
}
