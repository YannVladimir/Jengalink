import { type BudgetChangesOverview, type BudgetChangeView, type ChangeCategory, type ChangeStatus, type CommercialBasis, type AttachedFile, MAX_CHANGE_LINES } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { AmountInput, Button, StateView, Text } from '@jengalink/ui/web';
import { Check, FileText, Loader, Paperclip, Plus, Send, ShieldAlert, TriangleAlert, Undo2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const CATEGORIES: ChangeCategory[] = ['owner_request', 'unforeseen_conditions', 'specification_change', 'quantity_correction'];
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatRwf(Math.abs(n))}`;

function StatusChip({ status }: { status: ChangeStatus }) {
  const { t } = useI18n();
  return <span className={`qt-status ch-status is-${status}`}>{t(`changes.status_${status}`)}</span>;
}

/** The budget per package (original → approved changes → current) and every change (Phase 4). */
export default function ChangesPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [ov, setOv] = useState<BudgetChangesOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}/changes', { params: { path: { id } } })))
      .then(setOv)
      .catch(() => setFailed(true));
  }, [id, withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="no-permission" title={t('common.somethingWrong')} />
      </div>
    );
  if (!ov) return null;

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">
            <Link to={`/projects/${id}/money`}>{t('money.title')}</Link>
          </p>
          <Text variant="screenTitle" as="h1">
            {t('changes.title')}
          </Text>
        </div>
        {ov.canPropose && (
          <Link className="jl-btn jl-btn--primary" to={`/projects/${id}/changes/new`}>
            <Plus size={18} aria-hidden /> {t('changes.newChange')}
          </Link>
        )}
      </header>
      <p className="jl-field__hint">{t('changes.hint')}</p>
      {ov.agreementVersion === null ? (
        <Text muted>{t('changes.noAgreement')}</Text>
      ) : (
        <section className="jl-card">
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="ch-caption">
                {t('changes.historyTitle')} · {t('claims.agreementVersion', { version: ov.agreementVersion })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('changes.lines')}</th>
                  <th scope="col" className="num">
                    {t('changes.original')}
                  </th>
                  <th scope="col" className="num">
                    {t('changes.changesCol')}
                  </th>
                  <th scope="col" className="num">
                    {t('changes.current')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ov.lines.map((l) => (
                  <tr key={l.index}>
                    <td>
                      {l.name}
                      {l.basis === 'reimbursable' && <small className="muted"> · {t('basis.reimbursable')}</small>}
                    </td>
                    <td className="num">{formatRwf(l.original)}</td>
                    <td className="num">{l.changes === 0 ? '—' : signed(l.changes)}</td>
                    <td className="num">
                      <strong>{formatRwf(l.current)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{t('quote.total')}</td>
                  <td className="num">{formatRwf(ov.original)}</td>
                  <td className="num">{signed(ov.additions + ov.reductions)}</td>
                  <td className="num">{formatRwf(ov.current)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
      {ov.agreementVersion !== null && ov.changes.length === 0 && <Text muted>{t('changes.empty')}</Text>}
      {ov.changes.length > 0 && (
        <ul className="iv-list jl-card">
          {ov.changes.map((c) => (
            <li key={c.id}>
              <Link to={`/projects/${id}/changes/${c.id}`}>
                <span className="iv-list__text">
                  <small>
                    {c.number}
                    {c.appliedVersion ? ` · ${t('claims.agreementVersion', { version: c.appliedVersion })}` : ''}
                  </small>
                  <strong>{t(`changes.category_${c.category}`)}</strong>
                </span>
                <strong className="qt-amount">{signed(c.netDelta)}</strong>
                <StatusChip status={c.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Line =
  { kind: 'existing'; milestoneIndex: number | null; sign: 1 | -1; amount: number | null } | { kind: 'new'; name: string; basis: CommercialBasis; feePercent: number | null; amount: number | null };

/** A change: the editor for the contractor side, the read view and the owner's answer otherwise. */
export function ChangePage() {
  const { id = '', changeId = 'new' } = useParams();
  const isNew = changeId === 'new';
  const navigate = useNavigate();
  const uid = useId();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [ov, setOv] = useState<BudgetChangesOverview | null>(null);
  const [view, setView] = useState<BudgetChangeView | null>(null);
  const [category, setCategory] = useState<ChangeCategory>('owner_request');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [lines, setLines] = useState<Line[]>([{ kind: 'existing', milestoneIndex: null, sign: 1, amount: null }]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
    setRemoved([]);
  };

  useEffect(() => {
    let live = true;
    void Promise.all([
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

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!ov || (!isNew && !view)) return null;

  const editable = isNew ? ov.canPropose : !!view?.canEdit;
  const touch = () => setSaved(false);
  const deltaOf = (l: Line) => (l.amount ?? 0) * (l.kind === 'existing' ? l.sign : 1);
  const net = lines.reduce((s, l) => s + deltaOf(l), 0);
  const valid =
    reason.trim().length >= 10 &&
    lines.length > 0 &&
    lines.every((l) => !!l.amount && (l.kind === 'existing' ? l.milestoneIndex !== null : l.name.trim().length >= 2 && (l.basis === 'fixed' || l.feePercent !== null))) &&
    new Set(lines.filter((l) => l.kind === 'existing').map((l) => (l as { milestoneIndex: number }).milestoneIndex)).size === lines.filter((l) => l.kind === 'existing').length;
  const setLine = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? ({ ...l, ...patch } as Line) : l)));
    touch();
  };

  const save = async (): Promise<BudgetChangeView | null> => {
    setError(null);
    try {
      const files: { uploadKey: string; fileName: string | null }[] = [];
      for (const f of newFiles) {
        const contentType = (FILE_TYPES.includes(f.type) ? f.type : 'application/pdf') as 'application/pdf';
        const grant = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/changes/uploads', { params: { path: { id } }, body: { contentType, sizeBytes: f.size } })));
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: f });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        files.push({ uploadKey: grant.key, fileName: f.name || null });
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
        removeFileIds: removed,
      };
      const next = view
        ? await withRefresh(() => request(() => api.PUT('/v1/projects/{id}/changes/{changeId}', { params: { path: { id, changeId: view.id }, header: { 'If-Match': `"${view.version}"` } }, body })))
        : await withRefresh(() => request(() => api.POST('/v1/projects/{id}/changes', { params: { path: { id }, header: { 'Idempotency-Key': crypto.randomUUID() } }, body })));
      load(next);
      if (isNew) navigate(`/projects/${id}/changes/${next.id}`, { replace: true });
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      return null;
    }
  };

  const onSend = async () => {
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
  };

  const keptFiles = (view?.files ?? []).filter((f) => !removed.includes(f.id));
  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">
            <Link to={`/projects/${id}/changes`}>{t('changes.title')}</Link>
          </p>
          <Text variant="screenTitle" as="h1">
            {view ? view.number : t('changes.newChange')}
          </Text>
        </div>
        {view && <StatusChip status={view.status} />}
      </header>

      {!editable && view ? (
        <ChangeRead view={view} projectId={id} onChange={load} />
      ) : (
        <div className="jl-card wz-card">
          {view?.stale ? (
            <p className="rv-banner is-problem">{t('changes.stale', { version: ov.agreementVersion ?? 1 })}</p>
          ) : (
            <p className="rv-banner is-info">{view?.status === 'submitted' ? t('changes.waitingOwner') : t('changes.draftPrivate')}</p>
          )}
          <section className="wz-section">
            <div className="jl-field">
              <span className="jl-field__label">{t('changes.category')}</span>
              <div className="si-tabs ch-cats" role="radiogroup" aria-label={t('changes.category')}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={category === c}
                    className={category === c ? 'is-on' : undefined}
                    onClick={() => {
                      setCategory(c);
                      touch();
                    }}
                  >
                    {t(`changes.category_${c}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={`${uid}-reason`}>
                {t('changes.reason')}
              </label>
              <textarea
                id={`${uid}-reason`}
                className="pl-textarea"
                rows={3}
                maxLength={2000}
                value={reason}
                placeholder={t('changes.reasonPlaceholder')}
                onChange={(e) => {
                  setReason(e.target.value);
                  touch();
                }}
              />
            </div>
            <div className="jl-field ch-days">
              <label className="jl-field__label" htmlFor={`${uid}-days`}>
                {t('changes.scheduleDays')}
              </label>
              <span className="si-input pl-input">
                <input
                  id={`${uid}-days`}
                  type="number"
                  min={-365}
                  max={365}
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value);
                    touch();
                  }}
                />
              </span>
            </div>
          </section>

          <section className="wz-section">
            <Text variant="sectionTitle" as="h2">
              {t('changes.lines')}
            </Text>
            <ul className="ch-lines">
              {lines.map((l, i) => {
                const pkg = l.kind === 'existing' && l.milestoneIndex !== null ? ov.lines.find((x) => x.index === l.milestoneIndex) : undefined;
                const now = pkg?.current ?? 0;
                const floor = view?.lines.find((x) => (l.kind === 'existing' ? x.milestoneIndex === l.milestoneIndex : x.milestoneIndex === null && x.name === l.name))?.floor ?? 0;
                const after = now + deltaOf(l);
                return (
                  <li key={i}>
                    {l.kind === 'existing' ? (
                      <span className="si-input pl-input ch-lines__pick">
                        <select
                          aria-label={`${t('changes.choosePackage')} ${i + 1}`}
                          value={l.milestoneIndex ?? ''}
                          onChange={(e) => setLine(i, { milestoneIndex: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                          <option value="">{t('changes.choosePackage')}</option>
                          {ov.lines.map((x) => (
                            <option key={x.index} value={x.index}>
                              {x.name} · {formatRwf(x.current)}
                            </option>
                          ))}
                        </select>
                      </span>
                    ) : (
                      <div className="ch-lines__new">
                        <span className="si-input pl-input">
                          <input
                            aria-label={`${t('changes.newName')} ${i + 1}`}
                            value={l.name}
                            maxLength={120}
                            placeholder={t('changes.newName')}
                            onChange={(e) => setLine(i, { name: e.target.value })}
                          />
                        </span>
                        <div className="si-tabs" role="radiogroup" aria-label={t('basis.label')}>
                          {(['fixed', 'reimbursable'] as const).map((k) => (
                            <button key={k} type="button" role="radio" aria-checked={l.basis === k} className={l.basis === k ? 'is-on' : undefined} onClick={() => setLine(i, { basis: k })}>
                              {t(`basis.${k}`)}
                            </button>
                          ))}
                        </div>
                        {l.basis === 'reimbursable' && (
                          <span className="si-input pl-input ch-fee">
                            <input
                              type="number"
                              aria-label={t('basis.feeLabel')}
                              placeholder={t('basis.feeLabel')}
                              min={0}
                              max={100}
                              step={0.1}
                              value={l.feePercent ?? ''}
                              onChange={(e) => setLine(i, { feePercent: e.target.value === '' ? null : Math.round(Number(e.target.value) * 10) / 10 })}
                            />
                          </span>
                        )}
                      </div>
                    )}
                    <div className="ch-lines__amount">
                      {l.kind === 'existing' && (
                        <div className="si-tabs" role="radiogroup" aria-label={t('changes.delta')}>
                          {([1, -1] as const).map((sg) => (
                            <button key={sg} type="button" role="radio" aria-checked={l.sign === sg} className={l.sign === sg ? 'is-on' : undefined} onClick={() => setLine(i, { sign: sg })}>
                              {sg === 1 ? '+' : '−'}
                            </button>
                          ))}
                        </div>
                      )}
                      <AmountInput label={t('changes.delta')} value={l.amount} onChange={(amount) => setLine(i, { amount })} />
                    </div>
                    <span className="ch-lines__result">
                      {l.kind === 'new' ? <span className="qt-status">{t('changes.newTag')}</span> : `${t('changes.before')} ${formatRwf(now)}`} → <strong>{formatRwf(after)}</strong>
                      {floor > 0 && <small className={after < floor ? 'is-problem' : undefined}>{t('changes.floorLine', { amount: formatRwf(floor) })}</small>}
                    </span>
                    <button
                      type="button"
                      className="wz-stages__remove"
                      aria-label={t('spending.removeLine')}
                      onClick={() => {
                        setLines((ls) => ls.filter((_, j) => j !== i));
                        touch();
                      }}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            {lines.length < MAX_CHANGE_LINES && (
              <div className="iv-share">
                <Button variant="ghost" icon={Plus} onClick={() => setLines((ls) => [...ls, { kind: 'existing', milestoneIndex: null, sign: 1, amount: null }])}>
                  {t('changes.addExisting')}
                </Button>
                <Button variant="ghost" icon={Plus} onClick={() => setLines((ls) => [...ls, { kind: 'new', name: '', basis: 'fixed', feePercent: null, amount: null }])}>
                  {t('changes.addNew')}
                </Button>
              </div>
            )}
          </section>

          <section className="wz-section">
            <h3 className="cl-sub">{t('changes.evidence')}</h3>
            <ul className="cl-files">
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
                <li key={`${f.name}-${i}`} className="cl-file">
                  <span className="cl-file__icon">
                    <FileText size={20} aria-hidden />
                  </span>
                  <span className="cl-file__text">
                    <strong>{f.name}</strong>
                  </span>
                  <button type="button" className="wz-stages__remove" aria-label={t('claims.remove')} onClick={() => setNewFiles((n) => n.filter((_, j) => j !== i))}>
                    <X size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <Button variant="secondary" icon={Paperclip} onClick={() => fileInput.current?.click()}>
                {t('claims.addDocument')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept={FILE_TYPES.join(',')}
                multiple
                hidden
                onChange={(e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  setNewFiles((n) => [...n, ...chosen]);
                  touch();
                  e.target.value = '';
                }}
              />
            </div>
          </section>

          <div className="qt-total">
            <span>{t('changes.net')}</span>
            <strong>{signed(net)}</strong>
          </div>
          <p className="jl-field__hint">{t('changes.contractLine', { before: formatRwf(ov.current), after: formatRwf(ov.current + net) })}</p>
          {error && (
            <p className="jl-field__error" role="alert">
              {error}
            </p>
          )}
          <div className="wz-actions">
            <span>{view?.canWithdraw && <WithdrawButton view={view} projectId={id} onChange={load} />}</span>
            <span className="iv-share">
              {saved && <span className="jl-field__hint">{t('quote.saved')}</span>}
              <Button
                variant="secondary"
                loading={busy === 'save'}
                disabled={!valid || !!busy}
                onClick={async () => {
                  setBusy('save');
                  if (await save()) setSaved(true);
                  setBusy(null);
                }}
              >
                {t('changes.saveDraft')}
              </Button>
              {(!view || view.status === 'draft') && (
                <Button icon={Send} loading={busy === 'send'} disabled={!valid || !!busy} onClick={() => void onSend()}>
                  {t('changes.send')}
                </Button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function WithdrawButton({ view, projectId, onChange }: { view: BudgetChangeView; projectId: string; onChange: (c: BudgetChangeView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  return (
    <Button
      variant="ghost"
      icon={Undo2}
      onClick={async () => {
        if (!window.confirm(t('changes.withdrawConfirm'))) return;
        onChange(
          await withRefresh(() =>
            request(() => api.POST('/v1/projects/{id}/changes/{changeId}/withdraw', { params: { path: { id: projectId, changeId: view.id }, header: { 'If-Match': `"${view.version}"` } } })),
          ),
        );
      }}
    >
      {t('changes.withdraw')}
    </Button>
  );
}

/** Net change and contract first, each package before → after, why, evidence, then the owner's answer. */
function ChangeRead({ view: c, projectId, onChange }: { view: BudgetChangeView; projectId: string; onChange: (c: BudgetChangeView) => void }) {
  const { t, locale } = useI18n();
  return (
    <div className="jl-card wz-card cl-read">
      <div>
        <strong className="cl-read__amount">{signed(c.netDelta)}</strong>
        <Text variant="sectionTitle" as="h2">
          {t(`changes.category_${c.category}`)}
        </Text>
        <p className="jl-field__hint">
          {t('changes.contractLine', { before: formatRwf(c.contractBefore), after: formatRwf(c.contractAfter) })} · {t('claims.agreementVersion', { version: c.baseVersion })}
          {c.scheduleDays != null && ` · ${t('changes.scheduleLine', { days: c.scheduleDays })}`}
        </p>
        {c.submittedAt && <p className="jl-field__hint">{t('claims.sentLine', { date: formatDate(locale, c.submittedAt), name: c.createdByName ?? t('claims.someone') })}</p>}
      </div>
      {c.stale && <p className="rv-banner is-problem">{t('changes.stale', { version: c.baseVersion + 1 })}</p>}
      {c.status === 'applied' && <p className="rv-banner is-ok">{t('changes.appliedBanner', { version: c.appliedVersion ?? 0 })}</p>}
      {c.status === 'rejected' && <p className="rv-banner is-problem">{t('changes.rejectedBanner')}</p>}
      {c.status === 'submitted' && !c.canDecide && !c.stale && <p className="rv-banner is-info">{t('changes.waitingOwner')}</p>}
      <section>
        <h3 className="cl-sub">{t('changes.reason')}</h3>
        <p>{c.reason}</p>
      </section>
      <table className="qt-table">
        <tbody>
          {c.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <strong>
                  {l.name} {l.milestoneIndex == null && <span className="qt-status">{t('changes.newTag')}</span>}
                </strong>
                <small>
                  {formatRwf(l.before)} → {formatRwf(l.after)}
                </small>
                {l.after < l.floor && (
                  <small className="rc-warn">
                    <TriangleAlert size={14} aria-hidden /> {t('changes.belowFloor')}
                  </small>
                )}
              </td>
              <td>{signed(l.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.files.length > 0 && (
        <section className="wz-section">
          <h3 className="cl-sub">{t('changes.evidence')}</h3>
          <ul className="cl-files">
            {c.files.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        </section>
      )}
      {c.canDecide && !c.stale && <DecisionPanel view={c} projectId={projectId} onChange={onChange} />}
      {c.decisions.length > 0 && (
        <section className="wz-section">
          <h3 className="cl-sub">{t('claims.history')}</h3>
          <ul className="cl-history">
            {c.decisions.map((d) => (
              <li key={d.at} className={`is-${d.kind}`}>
                <strong>{t(`changes.decided_${d.kind}`, { name: d.byName ?? t('claims.someone'), date: formatDate(locale, d.at) })}</strong>
                <small>{signed(d.netDelta)}</small>
                {d.note && <span>“{d.note}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The owner's answer: a dialog repeats old and new contract values before applying. */
function DecisionPanel({ view, projectId, onChange }: { view: BudgetChangeView; projectId: string; onChange: (c: BudgetChangeView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/changes/{changeId}/decision', {
              params: { path: { id: projectId, changeId: view.id }, header: { 'If-Match': `"${view.version}"`, 'Idempotency-Key': crypto.randomUUID() } },
              body: { decision, netDelta: view.netDelta, ...(note.trim() ? { note: note.trim() } : {}) },
            }),
          ),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
      dialog.current?.close();
    }
  };
  const before = formatRwf(view.contractBefore);
  const after = formatRwf(view.contractAfter);
  return (
    <section className="rv-card ag-decide">
      <Text variant="sectionTitle" as="h2">
        {t('claims.decideTitle')}
      </Text>
      <p className="jl-field__hint">{t('changes.decideHint', { version: view.baseVersion + 1, amount: after })}</p>
      {rejecting ? (
        <form
          className="ac-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void decide('reject');
          }}
        >
          <label className="jl-field__label" htmlFor="ch-note">
            {t('changes.rejectLabel')}
          </label>
          <textarea id="ch-note" className="pl-textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="wz-actions">
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={note.trim().length < 3}>
              {t('changes.sendReject')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="iv-share">
          <Button icon={Check} onClick={() => dialog.current?.showModal()}>
            {t('changes.approveButton')}
          </Button>
          <Button variant="ghost" onClick={() => setRejecting(true)}>
            {t('claims.reject')}
          </Button>
        </div>
      )}
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}
      <dialog ref={dialog} className="ws-dialog" aria-labelledby="ch-confirm-title">
        <form method="dialog">
          <h2 id="ch-confirm-title" className="jl-text-section-title">
            {t('changes.approveConfirmTitle')}
          </h2>
          <p className="jl-text-display">{signed(view.netDelta)}</p>
          <p className="jl-muted">{t('changes.approveConfirmBody', { before, after })}</p>
          <div className="ws-actions">
            <Button size="lg" icon={Check} loading={busy} onClick={() => void decide('approve')}>
              {t('changes.approveConfirmYes')}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => dialog.current?.close()}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

function FileRow({ file: f, onRemove }: { file: AttachedFile; onRemove?: () => void }) {
  const { t } = useI18n();
  const bad = f.status === 'blocked' || f.status === 'failed';
  const Icon = f.status === 'processing' ? Loader : bad ? ShieldAlert : FileText;
  const name = f.fileName ?? (f.kind === 'photo' ? t('claims.photo') : 'PDF');
  return (
    <li className={`cl-file${bad ? ' is-problem' : ''}`}>
      <span className="cl-file__icon">
        <Icon size={20} aria-hidden />
      </span>
      <span className="cl-file__text">
        {f.url ? (
          <a href={f.url} target="_blank" rel="noreferrer">
            {name}
          </a>
        ) : (
          <strong>{name}</strong>
        )}
        <small>{f.status === 'ready' ? t('claims.open') : t(`claims.file_${f.status}`)}</small>
      </span>
      {onRemove && (
        <button type="button" className="wz-stages__remove" aria-label={t('claims.remove')} onClick={onRemove}>
          <X size={16} aria-hidden />
        </button>
      )}
    </li>
  );
}
