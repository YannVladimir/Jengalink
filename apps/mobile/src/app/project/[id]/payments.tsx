import type { PaymentMethod, PaymentsOverview, PaymentView, ProjectSummary } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { Banknote, CalendarDays, Check, FileText, ImagePlus, Paperclip, TriangleAlert, Undo2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { DatePickerSheet, fromIsoDate } from '@/components/DatePickerSheet';
import { api, useAuth } from '@/lib/auth';
import { localDate } from '@/lib/outbox-core';

const METHODS: PaymentMethod[] = ['mtn_momo', 'airtel_money', 'bank_transfer', 'cash'];
type Change = (o: PaymentsOverview) => void;

/**
 * Payments made outside JengaLink (Phase 4): recorded with proof, counted as paid only once the
 * other side (or finance) confirms. A claim is Paid when its confirmed payments cover it.
 */
export default function PaymentsScreen() {
  const { id, claim } = useLocalSearchParams<{ id: string; claim?: string }>();
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [overview, setOverview] = useState<PaymentsOverview | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/payments', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
    ])
      .then(([o, p]) => {
        if (!live) return;
        setOverview(o);
        setProject(p);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, withRefresh]);

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!overview || !project)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  const figures: [string, number][] = [
    [t('payments.cashPaid'), overview.cashPaid],
    [t('payments.pending'), overview.pendingVerification],
    [t('payments.owed'), overview.owedOnClaims],
  ];
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <Text variant="caption" muted>
        {project.name}
      </Text>
      <Text variant="caption" muted>
        {t('payments.recordOnly')}
      </Text>
      <Card>
        <View style={{ gap: spacing.sm }}>
          {figures.map(([label, n]) => (
            <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text muted>{label}</Text>
              <Text variant="bodyStrong">{formatRwf(n)}</Text>
            </View>
          ))}
        </View>
      </Card>
      {overview.payable.length > 0 && (
        <Card>
          <Text variant="label" muted style={{ marginBottom: 4 }}>
            {t('payments.payable')}
          </Text>
          {overview.payable.map((c) => (
            <View key={c.claimId} style={{ paddingVertical: 4 }}>
              <Text variant="bodyStrong">
                {c.number} · {c.milestoneName}
              </Text>
              <Text variant="caption" muted>
                {t('payments.paidOf', { paid: formatRwf(c.paid), amount: formatRwf(c.amount) })}
                {c.pending > 0 ? ` · ${t('payments.pending')} ${formatRwf(c.pending)}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {overview.canRecord && <RecordForm projectId={id} overview={overview} preselect={claim ?? null} onChange={setOverview} />}
      <Text variant="label">{t('payments.all')}</Text>
      {overview.payments.length === 0 && <Text muted>{t('payments.empty')}</Text>}
      {overview.payments.map((p) => (
        <PaymentCard key={p.id} payment={p} projectId={id} onChange={setOverview} />
      ))}
    </ScrollView>
  );
}

interface LocalFile {
  uri: string;
  name: string | null;
  contentType: string;
}

function RecordForm({ projectId, overview, preselect, onChange }: { projectId: string; overview: PaymentsOverview; preselect: string | null; onChange: Change }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh, user } = useAuth();
  const open = overview.payable.filter((c) => c.open > 0);
  const initial = open.find((c) => c.claimId === preselect) ?? open[0] ?? null;
  const [claimId, setClaimId] = useState<string | null>(initial?.claimId ?? null);
  const [payer, setPayer] = useState(user?.displayName ?? '');
  const [beneficiary, setBeneficiary] = useState('');
  const [amount, setAmount] = useState<number | null>(initial?.open ?? null);
  const [method, setMethod] = useState<PaymentMethod>('mtn_momo');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(localDate());
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claim = open.find((c) => c.claimId === claimId);
  const over = !!claim && amount !== null && amount > claim.open;
  const valid = payer.trim().length >= 2 && beneficiary.trim().length >= 2 && !!amount && !over && (method === 'cash' || reference.trim().length >= 3);
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

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const uploads: { uploadKey: string; fileName: string | null }[] = [];
      for (const f of files) {
        const grant = await withRefresh(() =>
          request(() => api.POST('/v1/projects/{id}/payments/uploads', { params: { path: { id: projectId } }, body: { contentType: f.contentType as 'application/pdf' } })),
        );
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: await (await fetch(f.uri)).blob() });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        uploads.push({ uploadKey: grant.key, fileName: f.name });
      }
      const next = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/payments', {
            params: { path: { id: projectId }, header: { 'Idempotency-Key': `pay-${Date.now()}-${Math.round(Math.random() * 1e9)}` } },
            body: { claimId, payer: payer.trim(), beneficiary: beneficiary.trim(), amount: amount ?? 0, method, reference: reference.trim() || null, paymentDate: date, files: uploads },
          }),
        ),
      );
      setReference('');
      setFiles([]);
      setAmount(next.payable.find((c) => c.claimId === claimId)?.open || null);
      onChange(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="sectionTitle" style={{ marginBottom: spacing.sm }}>
        {t('payments.record')}
      </Text>
      <View style={{ gap: spacing.sm }}>
        <Text variant="label">{t('payments.claim')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {[...open.map((c) => ({ id: c.claimId as string | null, label: `${c.number} · ${formatRwf(c.open)}`, open: c.open })), { id: null, label: t('payments.advance'), open: 0 }].map((c) => (
            <Pressable
              key={c.id ?? 'advance'}
              onPress={() => {
                setClaimId(c.id);
                if (c.id) setAmount(c.open);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: claimId === c.id }}
              style={pill(claimId === c.id)}
            >
              <Text variant="caption" color={claimId === c.id ? colors.ink : colors.inkMuted}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <AmountInput label={t('payments.amount')} value={amount} onChange={setAmount} />
        {over && claim && <Text color={status('problem').color}>{t('payments.overOpen', { amount: formatRwf(claim.open) })}</Text>}
        <TextInput
          accessibilityLabel={t('payments.payer')}
          value={payer}
          onChangeText={setPayer}
          placeholder={t('payments.payer')}
          placeholderTextColor={colors.inkSubtle}
          maxLength={120}
          style={input}
        />
        <TextInput
          accessibilityLabel={t('payments.beneficiary')}
          value={beneficiary}
          onChangeText={setBeneficiary}
          placeholder={t('payments.beneficiary')}
          placeholderTextColor={colors.inkSubtle}
          maxLength={120}
          style={input}
        />
        <Text variant="label">{t('payments.method')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {METHODS.map((m) => (
            <Pressable key={m} onPress={() => setMethod(m)} accessibilityRole="radio" accessibilityState={{ checked: method === m }} style={pill(method === m)}>
              <Text variant="caption" color={method === m ? colors.ink : colors.inkMuted}>
                {t(`payments.method_${m}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        {method !== 'cash' && (
          <TextInput
            accessibilityLabel={t('payments.reference')}
            value={reference}
            onChangeText={setReference}
            placeholder={t('payments.reference')}
            placeholderTextColor={colors.inkSubtle}
            maxLength={80}
            autoCapitalize="characters"
            style={input}
          />
        )}
        <Button title={`${t('payments.paymentDate')}: ${formatDate(locale, fromIsoDate(date))}`} icon={CalendarDays} variant="secondary" onPress={() => setPicking(true)} />
        <Text variant="label">{t('payments.proof')}</Text>
        {files.map((f) => (
          <Text key={f.uri} numberOfLines={1}>
            {f.name ?? t('claims.photo')}
          </Text>
        ))}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title={t('claims.addPhoto')}
              icon={ImagePlus}
              variant="secondary"
              onPress={async () => {
                const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
                if (!res.canceled) setFiles((f) => [...f, { uri: res.assets[0].uri, name: res.assets[0].fileName ?? null, contentType: res.assets[0].mimeType ?? 'image/jpeg' }].slice(0, 5));
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={t('claims.addDocument')}
              icon={Paperclip}
              variant="secondary"
              onPress={async () => {
                const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
                if (!res.canceled) setFiles((f) => [...f, { uri: res.assets[0].uri, name: res.assets[0].name, contentType: 'application/pdf' }].slice(0, 5));
              }}
            />
          </View>
        </View>
        {error && <Text color={status('problem').color}>{error}</Text>}
        <Button title={t('payments.save')} icon={Banknote} disabled={!valid} loading={busy} onPress={() => void submit()} />
      </View>
      <DatePickerSheet
        visible={picking}
        title={t('payments.paymentDate')}
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

function PaymentCard({ payment: p, projectId, onChange }: { payment: PaymentView; projectId: string; onChange: Change }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone =
    p.status === 'settled'
      ? status('paid')
      : p.status === 'disputed'
        ? status('problem')
        : p.status === 'pending_verification'
          ? status('waiting')
          : { color: colors.inkMuted, soft: colors.surfaceSunken };
  const run = async (fn: () => Promise<PaymentsOverview>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };
  const verify = (decision: 'settle' | 'dispute') =>
    run(() =>
      withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/payments/{paymentId}/verify', {
            params: { path: { id: projectId, paymentId: p.id }, header: { 'If-Match': `"${p.version}"`, 'Idempotency-Key': `pv-${Date.now()}-${Math.round(Math.random() * 1e9)}` } },
            body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
          }),
        ),
      ),
    );
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong">
            {formatRwf(p.amount)} · {t(`payments.method_${p.method}`)}
          </Text>
          <Text variant="caption" muted>
            {p.number} · {formatDate(locale, fromIsoDate(p.paymentDate))} · {p.payer} → {p.beneficiary}
            {p.claimNumber ? ` · ${p.claimNumber}` : ` · ${t('payments.advance')}`}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone.soft }}>
          <Text variant="caption" color={tone.color}>
            {t(`payments.status_${p.status}`)}
          </Text>
        </View>
      </View>
      {p.reference && (
        <Text variant="caption" style={{ marginTop: 4 }}>
          {t('payments.reference')}: {p.reference}
        </Text>
      )}
      {p.files.map((f) => (
        <Pressable key={f.id} disabled={!f.url} onPress={() => f.url && Linking.openURL(f.url)} accessibilityRole="link" style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <FileText size={16} color={colors.inkMuted} />
          <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
            {f.fileName ?? 'PDF'} · {f.status === 'ready' ? t('claims.open') : t(`claims.file_${f.status}`)}
          </Text>
        </Pressable>
      ))}
      {p.sameReference.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          <TriangleAlert size={16} color={status('problem').color} />
          <Text variant="caption" color={status('problem').color} style={{ flex: 1 }}>
            {t('payments.sameReference', { numbers: p.sameReference.join(', ') })}
          </Text>
        </View>
      )}
      <Text variant="caption" muted style={{ marginTop: 4 }}>
        {t('payments.recordedLine', { name: p.recordedByName ?? t('claims.someone'), date: formatDate(locale, p.recordedAt) })}
        {p.verifiedAt ? ` · ${t('payments.verifiedLine', { status: t(`payments.status_${p.status}`), name: p.verifiedByName ?? t('claims.someone'), date: formatDate(locale, p.verifiedAt) })}` : ''}
        {p.verificationNote ? ` · “${p.verificationNote}”` : ''}
      </Text>
      {p.canVerify && (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.structure }}>
          <Text variant="bodyStrong">{t('payments.confirmTitle')}</Text>
          <Text variant="caption" muted>
            {t('payments.confirmHint')}
          </Text>
          {disputing ? (
            <>
              <TextInput
                accessibilityLabel={t('payments.disputeLabel')}
                value={note}
                onChangeText={setNote}
                placeholder={t('payments.disputeLabel')}
                placeholderTextColor={colors.inkSubtle}
                multiline
                maxLength={500}
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
                <Button title={t('common.cancel')} variant="secondary" onPress={() => setDisputing(false)} />
                <View style={{ flex: 1 }}>
                  <Button title={t('payments.sendDispute')} variant="danger" block loading={busy} disabled={note.trim().length < 3} onPress={() => void verify('dispute')} />
                </View>
              </View>
            </>
          ) : (
            <>
              <Button title={t('payments.confirm', { amount: formatRwf(p.amount) })} icon={Check} loading={busy} onPress={() => void verify('settle')} />
              <Button title={t('payments.dispute')} variant="secondary" onPress={() => setDisputing(true)} />
            </>
          )}
        </View>
      )}
      {p.canCancel && (
        <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
          <Button
            title={t('payments.withdraw')}
            icon={Undo2}
            variant="ghost"
            loading={busy}
            onPress={() =>
              void run(() =>
                withRefresh(() =>
                  request(() => api.POST('/v1/projects/{id}/payments/{paymentId}/cancel', { params: { path: { id: projectId, paymentId: p.id }, header: { 'If-Match': `"${p.version}"` } } })),
                ),
              )
            }
          />
        </View>
      )}
      {error && <Text color={status('problem').color}>{error}</Text>}
    </Card>
  );
}
