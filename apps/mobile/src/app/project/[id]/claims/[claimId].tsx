import { type ClaimFile, type ClaimMilestones, claimProblems, type ClaimView, MAX_CLAIM_FILES, type ProjectSummary, type SiteUpdate } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, router } from 'expo-router';
import { Check, FileText, ImagePlus, Loader, Paperclip, Send, ShieldAlert, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ClaimStatusChip } from '@/components/claim';
import { FeedCard, PhotoThumb } from '@/components/feed';
import { SlideToApprove } from '@/components/SlideToApprove';
import { BottomAction } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';

/** A file picked on the phone, uploaded when the claim is saved. */
interface LocalFile {
  uri: string;
  name: string | null;
  contentType: string;
}

/**
 * Payment claim (Phase 4): the contractor claims a milestone of the current agreement with
 * evidence (site updates, photos, PDFs). JengaLink records it; the owner pays outside the app.
 */
export default function ClaimScreen() {
  const { id, claimId } = useLocalSearchParams<{
    id: string;
    claimId: string;
  }>();
  const isNew = claimId === 'new';
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [milestones, setMilestones] = useState<ClaimMilestones | null>(null);
  const [updates, setUpdates] = useState<SiteUpdate[]>([]);
  const [view, setView] = useState<ClaimView | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<LocalFile[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'send' | 'withdraw' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changeNote, setChangeNote] = useState('');

  const load = (c: ClaimView) => {
    setView(c);
    setIndex(c.milestoneIndex);
    setAmount(c.amount);
    setNote(c.note ?? '');
    setPicked(c.updates.map((u) => u.id));
    setNewFiles([]);
    setRemoved([]);
    setEditing(false);
    setChangeNote('');
  };
  const touch = () => setSaved(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      withRefresh(() =>
        request(() =>
          api.GET('/v1/projects/{id}/claims/milestones', {
            params: { path: { id } },
          }),
        ),
      ),
      isNew
        ? Promise.resolve(null)
        : withRefresh(() =>
            request(() =>
              api.GET('/v1/projects/{id}/claims/{claimId}', {
                params: { path: { id, claimId } },
              }),
            ),
          ),
    ])
      .then(async ([p, m, c]) => {
        if (!live) return;
        setProject(p);
        setMilestones(m);
        if (c) load(c);
        const canWrite = isNew || c?.canEdit;
        if (canWrite) {
          const u = await withRefresh(() =>
            request(() =>
              api.GET('/v1/projects/{id}/updates', {
                params: { path: { id }, query: { limit: 30 } },
              }),
            ),
          );
          if (live) setUpdates(u);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, claimId, isNew, withRefresh]);

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!project || !milestones || (!isNew && !view))
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

  const editable = isNew ? project.myRoles.some((r) => r === 'contractor' || r === 'manager') : !!view?.canEdit;
  // A claim already sent opens as the owner sees it; editing it sends the next revision.
  const resend = !!view?.savingSendsRevision;
  if ((!editable || (resend && !editing)) && view) return <ReadOnly view={view} projectId={id} onChange={load} onEdit={view.canEdit && resend ? () => setEditing(true) : undefined} />;

  const milestone = index === null ? undefined : milestones.milestones[index];
  // What is left without this claim (the list counts a saved claim already).
  const left = milestone?.remaining == null ? null : milestone.remaining + (view && view.milestoneIndex === index && view.status !== 'cancelled' ? view.amount : 0);
  const keptFiles = (view?.files ?? []).filter((f) => !removed.includes(f.id));
  const evidence = picked.length + newFiles.length + keptFiles.filter((f) => f.status === 'processing' || f.status === 'ready').length;
  const problems = claimProblems({ amount, evidence, remaining: left });
  const canSave = milestone !== undefined && amount !== null && amount > 0 && !problems.includes('overClaim');
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

  const uploadAll = async () => {
    const keys: { uploadKey: string; fileName: string | null }[] = [];
    for (const f of newFiles) {
      const grant = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/claims/uploads', {
            params: { path: { id } },
            body: { contentType: f.contentType as 'application/pdf' },
          }),
        ),
      );
      const blob = await (await fetch(f.uri)).blob();
      const put = await fetch(grant.url, {
        method: 'PUT',
        headers: grant.headers,
        body: blob,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      keys.push({ uploadKey: grant.key, fileName: f.name });
    }
    return keys;
  };

  const save = async (): Promise<ClaimView | null> => {
    if (index === null || amount === null) return null;
    setError(null);
    try {
      const files = await uploadAll();
      const body = {
        milestoneIndex: index,
        amount,
        note: note.trim() || null,
        siteUpdateIds: picked,
        files,
        removeFileIds: removed,
        ...(resend ? { changeNote: changeNote.trim() } : {}),
      };
      const next = view
        ? await withRefresh(() =>
            request(() =>
              api.PUT('/v1/projects/{id}/claims/{claimId}', {
                params: {
                  path: { id, claimId: view.id },
                  header: { 'If-Match': `"${view.version}"` },
                },
                body,
              }),
            ),
          )
        : await withRefresh(() =>
            request(() =>
              api.POST('/v1/projects/{id}/claims', {
                params: {
                  path: { id },
                  header: {
                    'Idempotency-Key': `claim-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
                  },
                },
                body,
              }),
            ),
          );
      load(next);
      if (isNew) router.setParams({ claimId: next.id });
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
    const current = await save();
    if (current) {
      try {
        const sent = await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/claims/{claimId}/submit', {
              params: {
                path: { id, claimId: current.id },
                header: { 'If-Match': `"${current.version}"` },
              },
            }),
          ),
        );
        load(sent);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      }
    }
    setBusy(null);
  };

  const onWithdraw = () =>
    view &&
    Alert.alert(t('claims.withdraw'), t('claims.withdrawConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('claims.withdraw'),
        style: 'destructive',
        onPress: async () => {
          setBusy('withdraw');
          try {
            load(
              await withRefresh(() =>
                request(() =>
                  api.POST('/v1/projects/{id}/claims/{claimId}/cancel', {
                    params: {
                      path: { id, claimId: view.id },
                      header: { 'If-Match': `"${view.version}"` },
                    },
                  }),
                ),
              ),
            );
          } catch (err) {
            setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
          }
          setBusy(null);
        },
      },
    ]);

  const room = MAX_CLAIM_FILES - keptFiles.length - newFiles.length;
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
            {view ? view.number : t('claims.newClaim')} · {project.name}
          </Text>
          {view && <ClaimStatusChip status={view.status} />}
        </View>
        {resend && view ? (
          <Banner
            tone={view.status === 'approved' ? 'problem' : 'info'}
            text={`${t('claims.reviseBanner', { n: view.revisionNo + 1 })}${view.status === 'approved' ? `\n${t('claims.reviseCancelsApproval', { prev: view.revisionNo })}` : ''}`}
          />
        ) : view?.status === 'changes_requested' ? (
          <Banner tone="problem" text={`${t('claims.changesBanner')}${view.decisions[0]?.note ? `\n“${view.decisions[0].note}”` : ''}`} />
        ) : (
          <Banner tone="info" text={t('claims.draftPrivate')} />
        )}

        <View style={{ gap: spacing.sm }}>
          <Text variant="label">{t('claims.stepMilestone')}</Text>
          {milestones.milestones.map((m) => {
            const on = index === m.index;
            const locked = (view?.status === 'changes_requested' || resend) && !on;
            return (
              <Pressable
                key={m.index}
                disabled={locked}
                onPress={() => {
                  setIndex(m.index);
                  touch();
                }}
                accessibilityRole="radio"
                aria-checked={on} aria-disabled={locked}
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: on ? 2 : 1.5,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: colors.surface,
                  opacity: locked ? 0.5 : 1,
                  gap: 2,
                }}
              >
                <Text variant="bodyStrong">{m.name}</Text>
                <Text variant="caption" muted>
                  {m.basis === 'fixed'
                    ? t('claims.agreed', { amount: formatRwf(m.amount) })
                    : t('claims.estimate', {
                        amount: formatRwf(m.amount),
                        fee: m.feePercent ?? 0,
                      })}
                </Text>
                <Text variant="caption" color={m.remaining === 0 ? status('problem').color : colors.inkMuted}>
                  {m.remaining === null
                    ? t('claims.claimedSoFar', { amount: formatRwf(m.claimed) })
                    : m.remaining === 0
                      ? t('claims.fullyClaimed')
                      : t('claims.left', { amount: formatRwf(m.remaining) })}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {milestone && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{t('claims.stepAmount')}</Text>
            <AmountInput
              label={t('claims.amount')}
              value={amount}
              onChange={(a) => {
                setAmount(a);
                touch();
              }}
            />
            {left !== null && left > 0 && amount !== left && (
              <Button
                title={t('claims.claimRest', { amount: formatRwf(left) })}
                variant="secondary"
                onPress={() => {
                  setAmount(left);
                  touch();
                }}
              />
            )}
            {problems.includes('overClaim') && left !== null && <Text color={status('problem').color}>{t('claims.overClaim', { amount: formatRwf(left) })}</Text>}
            {milestone.basis === 'reimbursable' && amount !== null && amount + milestone.claimed > milestone.amount && (
              <Text variant="caption" muted>
                {t('claims.overEstimate')}
              </Text>
            )}
            <Text variant="label" style={{ marginTop: spacing.sm }}>
              {t('claims.note')}
            </Text>
            <TextInput
              accessibilityLabel={t('claims.note')}
              value={note}
              onChangeText={(v) => {
                setNote(v);
                touch();
              }}
              placeholder={t('claims.notePlaceholder')}
              placeholderTextColor={colors.inkSubtle}
              multiline
              maxLength={2000}
              style={{ ...input, minHeight: 90, textAlignVertical: 'top' }}
            />
          </View>
        )}

        {milestone && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{t('claims.stepEvidence')}</Text>
            <Text variant="caption" muted>
              {t('claims.evidenceHint')}
            </Text>
            <Text variant="bodyStrong">{t('claims.siteUpdates')}</Text>
            {updates.length === 0 && <Text muted>{t('claims.noUpdates')}</Text>}
            {updates.map((u) => {
              const on = picked.includes(u.id);
              return (
                <Pressable
                  key={u.id}
                  onPress={() => {
                    setPicked((p) => (on ? p.filter((x) => x !== u.id) : [...p, u.id]));
                    touch();
                  }}
                  accessibilityRole="checkbox"
                  aria-checked={on}
                  style={{
                    flexDirection: 'row',
                    gap: spacing.sm,
                    alignItems: 'center',
                    padding: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: colors.surface,
                  }}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: on ? colors.primary : colors.surfaceSunken,
                    }}
                  >
                    {on && <Check size={16} color={colors.onPrimary} />}
                  </View>
                  {u.photos[0] && <PhotoThumb photo={u.photos[0]} size={48} />}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {u.stageName} · {formatDate(locale, u.submittedAt)}
                    </Text>
                    <Text variant="caption" muted numberOfLines={2}>
                      {u.note ?? `${t('claims.photo')} × ${u.photos.length}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}

            <Text variant="bodyStrong" style={{ marginTop: spacing.sm }}>
              {t('claims.files')}
            </Text>
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
              <LocalFileRow
                key={f.uri}
                file={f}
                onRemove={() => {
                  setNewFiles((n) => n.filter((_, j) => j !== i));
                  touch();
                }}
              />
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
            {problems.includes('evidence') && (
              <Text variant="caption" muted>
                {t('claims.needEvidence')}
              </Text>
            )}
          </View>
        )}

        {resend && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{t('claims.changeNote')}</Text>
            <TextInput
              accessibilityLabel={t('claims.changeNote')}
              value={changeNote}
              onChangeText={setChangeNote}
              placeholder={t('claims.changeNotePlaceholder')}
              placeholderTextColor={colors.inkSubtle}
              maxLength={500}
              style={input}
            />
          </View>
        )}
        {view && view.status !== 'approved' && <Button title={t('claims.withdraw')} variant="ghost" icon={X} onPress={onWithdraw} loading={busy === 'withdraw'} />}
      </ScrollView>
      <BottomAction>
        {error && <Text color={status('problem').color} alert>{error}</Text>}
        {saved && !error && <Text color={status('paid').color}>{t('quote.saved')}</Text>}
        {busy && newFiles.length > 0 && (
          <Text variant="caption" muted>
            {t('claims.uploading')}
          </Text>
        )}
        {resend && view ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('claims.stopEditing')} variant="secondary" onPress={() => load(view)} disabled={busy !== null} />
            <View style={{ flex: 1 }}>
              <Button
                title={t('claims.sendRevision', { n: view.revisionNo + 1 })}
                icon={Send}
                block
                onPress={onSave}
                disabled={!canSave || problems.length > 0 || changeNote.trim().length < 3 || busy !== null}
                loading={busy === 'save'}
              />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title={t('claims.saveDraft')} variant="secondary" onPress={onSave} disabled={!canSave || busy !== null} loading={busy === 'save'} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('claims.send')} icon={Send} onPress={onSend} disabled={!canSave || problems.length > 0 || busy !== null} loading={busy === 'send'} />
            </View>
          </View>
        )}
      </BottomAction>
    </SafeAreaView>
  );
}

/** What the owner (and the contractor, once sent) reads: amount first, then what it is for and the evidence. */
function ReadOnly({ view: c, projectId, onChange, onEdit }: { view: ClaimView; projectId: string; onChange: (c: ClaimView) => void; onEdit?: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="caption" muted style={{ flex: 1 }}>
          {c.number} · {c.organizationName}
        </Text>
        <ClaimStatusChip status={c.status} />
      </View>
      <Text variant="moneyLarge">{formatRwf(c.amount)}</Text>
      {c.revisionNo > 1 && (
        <Text variant="caption" muted>
          {t('claims.revisionBadge', { n: c.revisionNo })}
        </Text>
      )}
      <Text variant="sectionTitle">{c.milestoneName}</Text>
      <Text variant="caption" muted>
        {c.basis === 'fixed'
          ? t('claims.agreed', { amount: formatRwf(c.milestoneAmount) })
          : t('claims.estimate', {
              amount: formatRwf(c.milestoneAmount),
              fee: c.feePercent ?? 0,
            })}{' '}
        · {t('claims.agreementVersion', { version: c.agreementVersion })}
      </Text>
      {c.claimedBefore > 0 && (
        <Text variant="caption" muted>
          {t('claims.claimedBefore', { amount: formatRwf(c.claimedBefore) })}
        </Text>
      )}
      {c.submittedAt && (
        <Text variant="caption" muted>
          {t('claims.sentLine', {
            date: formatDate(locale, c.submittedAt),
            name: c.submittedByName ?? t('claims.someone'),
          })}
        </Text>
      )}
      {c.status === 'submitted' && !c.canDecide && <Banner tone="info" text={t('claims.waitingOwner')} />}
      {c.status === 'approved' && <Banner tone="ok" text={t('claims.approvedBanner')} />}
      {c.status === 'paid' && <Banner tone="ok" text={t('payments.claimPaid')} />}
      {(c.status === 'approved' || c.status === 'paid') && (c.paidAmount > 0 || c.pendingPayments > 0) && (
        <Text variant="caption" muted>
          {t('payments.claimPartly', { paid: formatRwf(c.paidAmount), amount: formatRwf(c.amount), pending: formatRwf(c.pendingPayments) })}
        </Text>
      )}
      {c.status === 'approved' && (
        <Button title={t('payments.recordForClaim')} variant="secondary" onPress={() => router.push({ pathname: '/project/[id]/payments', params: { id: projectId, claim: c.id } })} />
      )}
      {c.status === 'rejected' && <Banner tone="problem" text={t('claims.rejectedBanner')} />}
      {onEdit && <Button title={t('claims.editClaim')} variant="secondary" onPress={onEdit} />}
      <Text variant="caption" muted>
        {t('claims.recordOnly')}
      </Text>
      {c.note && (
        <Card>
          <Text variant="label" muted>
            {t('claims.note')}
          </Text>
          <Text style={{ marginTop: 4 }}>{c.note}</Text>
        </Card>
      )}
      <Text variant="label">{t('claims.evidence')}</Text>
      {c.files.map((f) => (
        <FileRow key={f.id} file={f} />
      ))}
      {c.updates.map((u) => (
        <FeedCard key={u.id} update={u} />
      ))}
      {c.canDecide && <DecisionPanel view={c} projectId={projectId} onChange={onChange} />}
      {c.revisions.length + c.decisions.length > 1 && (
        <View style={{ gap: 4 }}>
          <Text variant="label">{t('claims.history')}</Text>
          {history(c).map((h) =>
            h.type === 'revision' ? (
              <Card key={`r${h.r.revisionNo}`}>
                <Text variant="bodyStrong">
                  {t('claims.revisionLine', {
                    n: h.r.revisionNo,
                    name: h.r.byName ?? t('claims.someone'),
                    date: formatDate(locale, h.r.at),
                  })}
                </Text>
                <Text variant="caption" muted>
                  {formatRwf(h.r.amount)}
                </Text>
                {h.r.changeNote ? <Text style={{ marginTop: 4 }}>“{h.r.changeNote}”</Text> : null}
                {h.r.cancelledApproval ? (
                  <Text variant="caption" muted style={{ marginTop: 4 }}>
                    {t('claims.approvalCancelled', {
                      prev: h.r.revisionNo - 1,
                    })}
                  </Text>
                ) : null}
              </Card>
            ) : (
              <Card key={`d${h.d.at}`}>
                <Text variant="bodyStrong">
                  {t(`claims.decided_${h.d.kind}`, {
                    name: h.d.byName ?? t('claims.someone'),
                    date: formatDate(locale, h.d.at),
                  })}
                </Text>
                <Text variant="caption" muted>
                  {t('claims.answeredRevision', { n: h.d.revisionNo })} · {formatRwf(h.d.amount)}
                </Text>
                {h.d.note ? <Text style={{ marginTop: 4 }}>“{h.d.note}”</Text> : null}
              </Card>
            ),
          )}
        </View>
      )}
    </ScrollView>
  );
}

function FileRow({ file: f, onRemove }: { file: ClaimFile; onRemove?: () => void }) {
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

function LocalFileRow({ file: f, onRemove }: { file: LocalFile; onRemove: () => void }) {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const pdf = f.contentType === 'application/pdf';
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
      {pdf ? (
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
          <FileText size={20} color={colors.inkMuted} />
        </View>
      ) : (
        <Image source={{ uri: f.uri }} style={{ width: 48, height: 48, borderRadius: radius.sm }} accessibilityIgnoresInvertColors />
      )}
      <Text style={{ flex: 1 }} numberOfLines={1}>
        {f.name ?? (pdf ? 'PDF' : t('claims.photo'))}
      </Text>
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

/**
 * The owner's answer (spec §41): the amount again, a deliberate slide to approve, or a reason to
 * send it back or reject it. The answer names the exact version and amount on screen.
 */
function DecisionPanel({ view, projectId, onChange }: { view: ClaimView; projectId: string; onChange: (c: ClaimView) => void }) {
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
            api.POST('/v1/projects/{id}/claims/{claimId}/decision', {
              params: {
                path: { id: projectId, claimId: view.id },
                header: { 'If-Match': `"${view.version}"` },
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
      if (err instanceof ApiError && (err.status === 412 || err.status === 409)) setStale(true);
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
                pathname: '/project/[id]/claims/[claimId]',
                params: { id: projectId, claimId: view.id },
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
        {t('claims.decideHint', { amount })}
      </Text>
      {mode === 'approve' ? (
        <View style={{ gap: spacing.sm }}>
          <SlideToApprove key={slideKey} amount={view.amount} label={t('claims.slideToApprove', { amount })} doneLabel={t('claims.status_approved')} onApprove={() => void decide('approve')} />
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
                title={t(mode === 'reject' ? 'claims.sendReject' : 'claims.sendChanges')}
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

/** Revisions sent and the owner's answers, newest first. */
function history(c: ClaimView) {
  return [...c.revisions.map((r) => ({ type: 'revision' as const, at: r.at, r })), ...c.decisions.map((d) => ({ type: 'decision' as const, at: d.at, d }))].sort((a, b) => b.at.localeCompare(a.at));
}
