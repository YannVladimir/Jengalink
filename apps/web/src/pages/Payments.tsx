import { type PaymentMethod, type PaymentsOverview, type PaymentView, type ProjectSummary } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { AmountInput, Button, StateView, Text } from '@jengalink/ui/web';
import { Banknote, Check, FileText, Loader, ShieldAlert, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const METHODS: PaymentMethod[] = ['mtn_momo', 'airtel_money', 'bank_transfer', 'cash'];
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/**
 * Payments made outside JengaLink (Phase 4): recorded with proof, counted as paid only once the
 * other side (or finance) confirms. A claim is Paid when its confirmed payments cover it.
 */
export default function PaymentsPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [overview, setOverview] = useState<PaymentsOverview | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/payments', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
    ])
      .then(([o, p]) => {
        setOverview(o);
        setProject(p);
      })
      .catch(() => setFailed(true));
  }, [id, withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!overview || !project) return null;

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">{project.name}</p>
          <Text variant="screenTitle" as="h1">
            {t('payments.title')}
          </Text>
        </div>
      </header>
      <p className="jl-field__hint">{t('payments.recordOnly')}</p>
      <section className="jl-card pm-figures">
        <div>
          <small>{t('payments.cashPaid')}</small>
          <strong>{formatRwf(overview.cashPaid)}</strong>
        </div>
        <div>
          <small>{t('payments.pending')}</small>
          <strong>{formatRwf(overview.pendingVerification)}</strong>
        </div>
        <div>
          <small>{t('payments.owed')}</small>
          <strong>{formatRwf(overview.owedOnClaims)}</strong>
        </div>
      </section>

      {overview.payable.length > 0 && (
        <section className="jl-card cl-ceilings">
          <span className="jl-field__label">{t('payments.payable')}</span>
          <ul>
            {overview.payable.map((c) => (
              <li key={c.claimId}>
                <span>
                  {c.number} · {c.milestoneName}
                </span>
                <small>
                  {t('payments.paidOf', { paid: formatRwf(c.paid), amount: formatRwf(c.amount) })}
                  {c.pending > 0 && ` · ${t('payments.pending')} ${formatRwf(c.pending)}`}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {overview.canRecord && <RecordForm projectId={id} overview={overview} preselect={params.get('claim')} onChange={setOverview} />}

      <section className="wz-section">
        <Text variant="sectionTitle" as="h2">
          {t('payments.all')}
        </Text>
        {overview.payments.length === 0 && <Text muted>{t('payments.empty')}</Text>}
        <ul className="rc-expenses">
          {overview.payments.map((p) => (
            <PaymentItem key={p.id} payment={p} projectId={id} onChange={setOverview} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function RecordForm({ projectId, overview, preselect, onChange }: { projectId: string; overview: PaymentsOverview; preselect: string | null; onChange: (o: PaymentsOverview) => void }) {
  const { t } = useI18n();
  const uid = useId();
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
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claim = open.find((c) => c.claimId === claimId);
  const over = !!claim && amount !== null && amount > claim.open;
  const valid = payer.trim().length >= 2 && beneficiary.trim().length >= 2 && !!amount && !over && !!date && date <= localDate() && (method === 'cash' || reference.trim().length >= 3);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const uploads: { uploadKey: string; fileName: string | null }[] = [];
      for (const f of files) {
        const contentType = (FILE_TYPES.includes(f.type) ? f.type : 'application/pdf') as 'application/pdf';
        const grant = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/payments/uploads', { params: { path: { id: projectId } }, body: { contentType, sizeBytes: f.size } })));
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: f });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        uploads.push({ uploadKey: grant.key, fileName: f.name || null });
      }
      const next = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/payments', {
            params: { path: { id: projectId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
            body: {
              claimId,
              payer: payer.trim(),
              beneficiary: beneficiary.trim(),
              amount: amount ?? 0,
              method,
              reference: reference.trim() || null,
              paymentDate: date,
              note: note.trim() || null,
              files: uploads,
            },
          }),
        ),
      );
      setReference('');
      setNote('');
      setFiles([]);
      const stillOpen = next.payable.find((c) => c.claimId === claimId)?.open ?? null;
      setAmount(stillOpen || null);
      onChange(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="jl-card wz-card pm-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void submit();
      }}
    >
      <Text variant="sectionTitle" as="h2">
        {t('payments.record')}
      </Text>
      <div className="pm-row">
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-claim`}>
            {t('payments.claim')}
          </label>
          <span className="si-input pl-input">
            <select
              id={`${uid}-claim`}
              value={claimId ?? ''}
              onChange={(e) => {
                const c = open.find((x) => x.claimId === e.target.value);
                setClaimId(c?.claimId ?? null);
                if (c) setAmount(c.open);
              }}
            >
              {open.map((c) => (
                <option key={c.claimId} value={c.claimId}>
                  {c.number} · {c.milestoneName} · {t('payments.openAmount', { amount: formatRwf(c.open) })}
                </option>
              ))}
              <option value="">{t('payments.advance')}</option>
            </select>
          </span>
        </div>
        <AmountInput label={t('payments.amount')} value={amount} onChange={setAmount} />
      </div>
      {over && claim && <span className="jl-field__error">{t('payments.overOpen', { amount: formatRwf(claim.open) })}</span>}
      <div className="pm-row">
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-payer`}>
            {t('payments.payer')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-payer`} value={payer} maxLength={120} onChange={(e) => setPayer(e.target.value)} />
          </span>
        </div>
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-to`}>
            {t('payments.beneficiary')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-to`} value={beneficiary} maxLength={120} onChange={(e) => setBeneficiary(e.target.value)} />
          </span>
        </div>
      </div>
      <div className="jl-field">
        <span className="jl-field__label">{t('payments.method')}</span>
        <div className="si-tabs" role="radiogroup" aria-label={t('payments.method')}>
          {METHODS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} className={method === m ? 'is-on' : undefined} onClick={() => setMethod(m)}>
              {t(`payments.method_${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="pm-row">
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-ref`}>
            {t('payments.reference')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-ref`} value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
          </span>
        </div>
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-date`}>
            {t('payments.paymentDate')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-date`} type="date" max={localDate()} value={date} onChange={(e) => setDate(e.target.value)} />
          </span>
        </div>
      </div>
      <div className="pm-row">
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-note`}>
            {t('payments.note')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-note`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </span>
        </div>
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-proof`}>
            {t('payments.proof')}
          </label>
          <input
            id={`${uid}-proof`}
            type="file"
            accept={FILE_TYPES.join(',')}
            multiple
            onChange={(e) => {
              // Copy now: the input may be cleared, which empties its live FileList.
              const chosen = Array.from(e.target.files ?? []).slice(0, 5);
              setFiles(chosen);
            }}
          />
        </div>
      </div>
      {error && (
        <span className="jl-field__error" role="alert">
          {error}
        </span>
      )}
      <div>
        <Button type="submit" icon={Banknote} loading={busy} disabled={!valid}>
          {t('payments.save')}
        </Button>
      </div>
    </form>
  );
}

function PaymentItem({ payment: p, projectId, onChange }: { payment: PaymentView; projectId: string; onChange: (o: PaymentsOverview) => void }) {
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
            params: { path: { id: projectId, paymentId: p.id }, header: { 'If-Match': `"${p.version}"`, 'Idempotency-Key': crypto.randomUUID() } },
            body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
          }),
        ),
      ),
    );
  return (
    <li className="rc-expense">
      <div className="rc-expense__head">
        <span>
          <strong>
            {formatRwf(p.amount)} · {t(`payments.method_${p.method}`)}
          </strong>
          <small>
            {p.number} · {formatDate(locale, fromIsoDate(p.paymentDate))} · {p.payer} → {p.beneficiary}
            {p.claimNumber ? ` · ${p.claimNumber}` : ` · ${t('payments.advance')}`}
          </small>
        </span>
        <span className={`qt-status pm-status is-${p.status}`}>{t(`payments.status_${p.status}`)}</span>
      </div>
      <div className="rc-details">
        {p.reference && (
          <span>
            {t('payments.reference')}: <strong>{p.reference}</strong>
          </span>
        )}
        {p.note && <span>“{p.note}”</span>}
        {p.files.length > 0 && (
          <ul className="cl-files">
            {p.files.map((f) => {
              const Icon = f.status === 'processing' ? Loader : f.status === 'ready' ? FileText : ShieldAlert;
              return (
                <li key={f.id} className="cl-file">
                  <span className="cl-file__icon">
                    <Icon size={20} aria-hidden />
                  </span>
                  <span className="cl-file__text">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {f.fileName ?? 'PDF'}
                      </a>
                    ) : (
                      <strong>{f.fileName ?? 'PDF'}</strong>
                    )}
                    <small>{f.status === 'ready' ? t('claims.open') : t(`claims.file_${f.status}`)}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {p.sameReference.length > 0 && (
          <p className="rc-warn">
            <TriangleAlert size={16} aria-hidden /> {t('payments.sameReference', { numbers: p.sameReference.join(', ') })}
          </p>
        )}
        <small className="jl-field__hint">
          {t('payments.recordedLine', { name: p.recordedByName ?? t('claims.someone'), date: formatDate(locale, p.recordedAt) })}
          {p.verifiedAt && ` · ${t('payments.verifiedLine', { status: t(`payments.status_${p.status}`), name: p.verifiedByName ?? t('claims.someone'), date: formatDate(locale, p.verifiedAt) })}`}
          {p.verificationNote && ` · “${p.verificationNote}”`}
        </small>
      </div>
      {p.canVerify && (
        <div className="rc-review">
          <strong>{t('payments.confirmTitle')}</strong>
          <span className="jl-field__hint">{t('payments.confirmHint')}</span>
          {disputing ? (
            <>
              <label className="jl-field__label" htmlFor={`pm-note-${p.id}`}>
                {t('payments.disputeLabel')}
              </label>
              <textarea id={`pm-note-${p.id}`} className="pl-textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="iv-share">
                <Button variant="secondary" onClick={() => setDisputing(false)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="danger" loading={busy} disabled={note.trim().length < 3} onClick={() => void verify('dispute')}>
                  {t('payments.sendDispute')}
                </Button>
              </div>
            </>
          ) : (
            <div className="iv-share">
              <Button icon={Check} loading={busy} onClick={() => void verify('settle')}>
                {t('payments.confirm', { amount: formatRwf(p.amount) })}
              </Button>
              <Button variant="secondary" onClick={() => setDisputing(true)}>
                {t('payments.dispute')}
              </Button>
            </div>
          )}
        </div>
      )}
      {p.canCancel && (
        <div>
          <Button
            variant="ghost"
            icon={Undo2}
            loading={busy}
            onClick={() =>
              void run(() =>
                withRefresh(() =>
                  request(() => api.POST('/v1/projects/{id}/payments/{paymentId}/cancel', { params: { path: { id: projectId, paymentId: p.id }, header: { 'If-Match': `"${p.version}"` } } })),
                ),
              )
            }
          >
            {t('payments.withdraw')}
          </Button>
        </div>
      )}
      {error && (
        <span className="jl-field__error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
