import type { ExpenseView, ReceiptView, SpendingView } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, Text, useJengaTheme } from '@jengalink/ui/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { CalendarDays, Check, FileText, ImagePlus, Paperclip, ReceiptText, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { DatePickerSheet, fromIsoDate } from '@/components/DatePickerSheet';
import { api, useAuth } from '@/lib/auth';
import { localDate } from '@/lib/outbox-core';

type Change = (v: SpendingView) => void;

/** One expense with its receipt (spec §26.1): status, EBM details, warnings, and this person's next step. */
export function ExpenseCard({ expense: e, projectId, onChange }: { expense: ExpenseView; projectId: string; onChange: Change }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const [editing, setEditing] = useState(false);
  const r = e.receipt;
  const tone =
    e.receiptStatus === 'not_supplied' || e.receiptStatus === 'discrepancy_found'
      ? status('problem')
      : e.receiptStatus === 'captured'
        ? { color: colors.structure, soft: colors.structureSoft }
        : status('paid');
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong">
            {e.description} · {formatRwf(e.amount)}
          </Text>
          <Text variant="caption" muted>
            {e.number} · {formatDate(locale, fromIsoDate(e.expenseDate))}
            {e.supplierName ? ` · ${e.supplierName}` : ''} · {e.byName ?? t('claims.someone')}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone.soft }}>
          <Text variant="caption" color={tone.color}>
            {e.receiptStatus === 'not_supplied' ? t('receipt.missing') : t(`receipt.status_${e.receiptStatus}`)}
          </Text>
        </View>
      </View>
      {r && !editing && <ReceiptDetails receipt={r} amount={e.amount} />}
      {(editing || (!r && e.canAddReceipt)) && (
        <ReceiptForm
          expense={e}
          projectId={projectId}
          onCancel={r ? () => setEditing(false) : undefined}
          onChange={(v) => {
            setEditing(false);
            onChange(v);
          }}
        />
      )}
      {r?.canEdit && !editing && (
        <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
          <Button title={t('receipt.edit')} variant="secondary" onPress={() => setEditing(true)} />
        </View>
      )}
      {r?.canReview && !editing && <ReceiptReview expense={e} receipt={r} projectId={projectId} onChange={onChange} />}
    </Card>
  );
}

function Warn({ text }: { text: string }) {
  const { status } = useJengaTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <TriangleAlert size={16} color={status('problem').color} />
      <Text variant="caption" color={status('problem').color} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function ReceiptDetails({ receipt: r, amount }: { receipt: ReceiptView; amount: number }) {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  const rows: [string, string][] = [
    [t('receipt.supplierName'), `${r.supplierName}${r.supplierTin ? ` · TIN ${r.supplierTin}` : ''}`],
    [t('receipt.invoiceNumber'), `${r.invoiceNumber} · ${formatDate(locale, fromIsoDate(r.invoiceDate))}`],
    [t('receipt.total'), `${formatRwf(r.total)}${r.vatAmount != null ? ` · VAT ${formatRwf(r.vatAmount)}` : ''}`],
    ...(r.ebmReference ? [['EBM', r.ebmReference] as [string, string]] : []),
  ];
  return (
    <View style={{ gap: 6, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}>
      {rows.map(([k, v]) => (
        <View key={k}>
          <Text variant="caption" muted>
            {k}
          </Text>
          <Text>{v}</Text>
        </View>
      ))}
      {r.file && (
        <Pressable disabled={!r.file.url} onPress={() => r.file?.url && Linking.openURL(r.file.url)} accessibilityRole="link" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <FileText size={16} color={colors.inkMuted} />
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {r.file.fileName ?? t('claims.photo')}
          </Text>
          <Text variant="caption" muted>
            {r.file.status === 'ready' ? t('claims.open') : t(`claims.file_${r.file.status}`)}
          </Text>
        </Pressable>
      )}
      {!r.totalMatches && <Warn text={t('receipt.totalMismatch', { total: formatRwf(r.total), amount: formatRwf(amount) })} />}
      {r.duplicates.map((d, i) => (
        <Warn key={i} text={t(d.kind === 'invoice' ? 'receipt.duplicateInvoice' : 'receipt.duplicateFile', { expense: d.expenseNumber, project: d.projectName })} />
      ))}
      <Text variant="caption" muted>
        {t('receipt.capturedLine', { name: r.capturedByName ?? t('claims.someone'), date: formatDate(locale, r.capturedAt) })}
        {r.reviewedAt ? ` · ${t('receipt.reviewedLine', { status: t(`receipt.status_${r.status}`), name: r.reviewedByName ?? t('claims.someone'), date: formatDate(locale, r.reviewedAt) })}` : ''}
        {r.reviewNote ? ` · “${r.reviewNote}”` : ''}
      </Text>
      <Text variant="caption" muted>
        {t('receipt.notVerified')}
      </Text>
    </View>
  );
}

interface LocalFile {
  uri: string;
  name: string | null;
  contentType: string;
}

function ReceiptForm({ expense: e, projectId, onChange, onCancel }: { expense: ExpenseView; projectId: string; onChange: Change; onCancel?: () => void }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const r = e.receipt;
  const [supplierName, setSupplierName] = useState(r?.supplierName ?? e.supplierName ?? '');
  const [supplierTin, setSupplierTin] = useState(r?.supplierTin ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(r?.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(r?.invoiceDate ?? e.expenseDate);
  const [total, setTotal] = useState<number | null>(r?.total ?? e.amount);
  const [vat, setVat] = useState<number | null>(r?.vatAmount ?? null);
  const [ebmReference, setEbmReference] = useState(r?.ebmReference ?? '');
  const [file, setFile] = useState<LocalFile | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tinOk = supplierTin.trim() === '' || /^\d{9}$/.test(supplierTin.trim());
  const valid = supplierName.trim().length >= 2 && invoiceNumber.trim().length >= 1 && total !== null && tinOk && (vat === null || vat <= total);
  const input = { borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: radius.md, padding: spacing.md, color: colors.ink, backgroundColor: colors.surface, fontSize: 16 } as const;

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled) setFile({ uri: res.assets[0].uri, name: res.assets[0].fileName ?? null, contentType: res.assets[0].mimeType ?? 'image/jpeg' });
  };
  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (!res.canceled) setFile({ uri: res.assets[0].uri, name: res.assets[0].name, contentType: 'application/pdf' });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let upload: { uploadKey: string; fileName: string | null } | null = null;
      if (file) {
        const grant = await withRefresh(() =>
          request(() => api.POST('/v1/projects/{id}/receipts/uploads', { params: { path: { id: projectId } }, body: { contentType: file.contentType as 'application/pdf' } })),
        );
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: await (await fetch(file.uri)).blob() });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        upload = { uploadKey: grant.key, fileName: file.name };
      }
      onChange(
        await withRefresh(() =>
          request(() =>
            api.PUT('/v1/projects/{id}/expenses/{expenseId}/receipt', {
              params: { path: { id: projectId, expenseId: e.id }, header: { 'If-Match': r ? `"${r.version}"` : '' } },
              body: {
                supplierName: supplierName.trim(),
                supplierTin: supplierTin.trim() || null,
                invoiceNumber: invoiceNumber.trim(),
                invoiceDate,
                total: total ?? 0,
                vatAmount: vat,
                ebmReference: ebmReference.trim() || null,
                file: upload,
              },
            }),
          ),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <ReceiptText size={16} color={colors.inkMuted} />
        <Text variant="label">{r ? t('receipt.edit') : t('receipt.add')}</Text>
      </View>
      <TextInput
        accessibilityLabel={t('receipt.supplierName')}
        value={supplierName}
        onChangeText={setSupplierName}
        placeholder={t('receipt.supplierName')}
        placeholderTextColor={colors.inkSubtle}
        maxLength={120}
        style={input}
      />
      <TextInput
        accessibilityLabel={t('receipt.supplierTin')}
        value={supplierTin}
        onChangeText={setSupplierTin}
        placeholder={`${t('receipt.supplierTin')} · ${t('receipt.tinHint')}`}
        placeholderTextColor={colors.inkSubtle}
        keyboardType="number-pad"
        maxLength={9}
        style={{ ...input, borderColor: tinOk ? colors.borderStrong : status('problem').color }}
      />
      <TextInput
        accessibilityLabel={t('receipt.invoiceNumber')}
        value={invoiceNumber}
        onChangeText={setInvoiceNumber}
        placeholder={t('receipt.invoiceNumber')}
        placeholderTextColor={colors.inkSubtle}
        maxLength={60}
        style={input}
      />
      <Button title={`${t('receipt.invoiceDate')}: ${formatDate(locale, fromIsoDate(invoiceDate))}`} icon={CalendarDays} variant="secondary" onPress={() => setPicking(true)} />
      <AmountInput label={t('receipt.total')} value={total} onChange={setTotal} />
      <AmountInput label={t('receipt.vat')} value={vat} onChange={setVat} />
      <TextInput
        accessibilityLabel={t('receipt.ebmReference')}
        value={ebmReference}
        onChangeText={setEbmReference}
        placeholder={t('receipt.ebmReference')}
        placeholderTextColor={colors.inkSubtle}
        maxLength={120}
        style={input}
      />
      <Text variant="label">{t('receipt.file')}</Text>
      {file && <Text numberOfLines={1}>{file.name ?? t('claims.photo')}</Text>}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title={t('claims.addPhoto')} icon={ImagePlus} variant="secondary" onPress={pickPhoto} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('claims.addDocument')} icon={Paperclip} variant="secondary" onPress={pickPdf} />
        </View>
      </View>
      {total !== null && total !== e.amount && <Warn text={t('receipt.totalMismatch', { total: formatRwf(total), amount: formatRwf(e.amount) })} />}
      <Text variant="caption" muted>
        {t('receipt.notVerified')}
      </Text>
      {error && <Text color={status('problem').color}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {onCancel && <Button title={t('common.cancel')} variant="secondary" onPress={onCancel} />}
        <View style={{ flex: 1 }}>
          <Button title={t('receipt.save')} icon={Check} block disabled={!valid} loading={busy} onPress={() => void submit()} />
        </View>
      </View>
      <DatePickerSheet
        visible={picking}
        title={t('receipt.invoiceDate')}
        value={invoiceDate}
        onPick={(iso) => {
          if (iso <= localDate()) setInvoiceDate(iso);
          setPicking(false);
        }}
        onClear={() => setPicking(false)}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

/** The independent check: reviewed, or a discrepancy with a note. Never "verified with RRA". */
function ReceiptReview({ expense: e, receipt: r, projectId, onChange }: { expense: ExpenseView; receipt: ReceiptView; projectId: string; onChange: Change }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (next: 'manually_reviewed' | 'discrepancy_found') => {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/expenses/{expenseId}/receipt/review', {
              params: { path: { id: projectId, expenseId: e.id }, header: { 'If-Match': `"${r.version}"` } },
              body: { status: next, ...(note.trim() ? { note: note.trim() } : {}) },
            }),
          ),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.structure }}>
      <Text variant="bodyStrong">{t('receipt.reviewTitle')}</Text>
      <Text variant="caption" muted>
        {t('receipt.reviewHint')}
      </Text>
      {flagging ? (
        <>
          <TextInput
            accessibilityLabel={t('receipt.discrepancyLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('receipt.discrepancyLabel')}
            placeholderTextColor={colors.inkSubtle}
            multiline
            maxLength={1000}
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
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setFlagging(false)} />
            <View style={{ flex: 1 }}>
              <Button title={t('receipt.markDiscrepancy')} variant="danger" block loading={busy} disabled={note.trim().length < 3} onPress={() => void send('discrepancy_found')} />
            </View>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title={t('receipt.markReviewed')} icon={Check} loading={busy} onPress={() => void send('manually_reviewed')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t('receipt.markDiscrepancy')} variant="secondary" onPress={() => setFlagging(true)} />
          </View>
        </View>
      )}
      {error && <Text color={status('problem').color}>{error}</Text>}
    </View>
  );
}
