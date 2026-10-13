import {
  type AttachedFile,
  type ExpenseView,
  type ReceiptView,
  type BudgetLine,
  lineAmount,
  MAX_SPENDING_FILES,
  MAX_SPENDING_LINES,
  type ProjectBudget,
  type ProjectStage,
  type ProjectSummary,
  type SpendingStatus,
  type SpendingSummary,
  type SpendingView,
  spendingTotal,
} from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { AmountInput, Button, StateView, Text } from '@jengalink/ui/web';
import { Check, FileText, Loader, Paperclip, Plus, ReceiptText, Send, ShieldAlert, TriangleAlert, Undo2, Wallet, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const REQUESTERS = ['contractor', 'manager'];
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

function StatusChip({ status }: { status: SpendingStatus }) {
  const { t } = useI18n();
  return <span className={`qt-status sp-status is-${status}`}>{t(`spending.status_${status}`)}</span>;
}

/** One package's money: spent, reserved, waiting and free out of its cost budget (computed by the server). */
function LineBar({ line }: { line: BudgetLine }) {
  const { t } = useI18n();
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, line.costBudget)) * 100))}%`;
  return (
    <div className="sp-line">
      <div className="sp-line__head">
        <strong>{line.name}</strong>
        <small>{t('spending.costBudget', { amount: formatRwf(line.costBudget) })}</small>
      </div>
      <div
        className="sp-bar"
        role="img"
        aria-label={`${t('spending.spent')} ${formatRwf(line.posted)}, ${t('spending.reserved')} ${formatRwf(line.committed)}, ${t('spending.free')} ${formatRwf(line.headroom)}`}
      >
        <span className="sp-bar__posted" style={{ width: pct(line.posted) }} />
        <span className="sp-bar__committed" style={{ width: pct(line.committed) }} />
      </div>
      <dl className="sp-figures">
        <div>
          <dt>{t('spending.spent')}</dt>
          <dd>{formatRwf(line.posted)}</dd>
        </div>
        <div>
          <dt>{t('spending.reserved')}</dt>
          <dd>{formatRwf(line.committed)}</dd>
        </div>
        <div>
          <dt>{t('spending.waiting')}</dt>
          <dd>{formatRwf(line.pending)}</dd>
        </div>
        <div>
          <dt>{t('spending.free')}</dt>
          <dd className={line.headroom <= 0 ? 'is-problem' : undefined}>{formatRwf(line.headroom)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Spending requests on cost + fee packages (Phase 4), with each package's budget. */
export default function SpendingPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<SpendingSummary[] | null>(null);
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/spending', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/budget', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
    ])
      .then(([l, b, p]) => {
        setList(l);
        setBudget(b);
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
  if (!list || !budget || !project) return null;
  const requester = project.myRoles.some((r) => REQUESTERS.includes(r));
  const ready = budget.lines.length > 0;

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">{project.name}</p>
          <Text variant="screenTitle" as="h1">
            {t('spending.title')}
          </Text>
        </div>
        {requester && ready && project.status === 'active' && (
          <Link className="jl-btn jl-btn--primary" to={`/projects/${id}/spending/new`}>
            <Plus size={18} aria-hidden /> {t('spending.newRequest')}
          </Link>
        )}
      </header>
      <p className="jl-field__hint">{t('spending.recordOnly')}</p>
      {budget.agreementVersion === null ? (
        <Text muted>{t('spending.noAgreement')}</Text>
      ) : !ready ? (
        <Text muted>{t('spending.noPackages')}</Text>
      ) : (
        <section className="jl-card sp-budget">
          <Text variant="sectionTitle" as="h2">
            {t('spending.budgetTitle')}
          </Text>
          {budget.lines.map((l) => (
            <LineBar key={l.index} line={l} />
          ))}
        </section>
      )}
      {ready && list.length === 0 && <Text muted>{t('spending.empty')}</Text>}
      {list.length > 0 && (
        <ul className="iv-list jl-card">
          {list.map((r) => (
            <li key={r.id}>
              <Link to={`/projects/${id}/spending/${r.id}`}>
                <span className="iv-list__text">
                  <small>
                    {r.number} · {r.milestoneName}
                  </small>
                  <strong>{r.purpose}</strong>
                  {(r.posted > 0 || r.committed > 0) && (
                    <small>
                      {t('spending.spent')} {formatRwf(r.posted)} · {t('spending.reserved')} {formatRwf(r.committed)}
                    </small>
                  )}
                </span>
                <strong className="qt-amount">{formatRwf(r.amount)}</strong>
                <StatusChip status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Line {
  description: string;
  quantity: string;
  unit: string;
  unitRate: number | null;
}
const emptyLine = (): Line => ({
  description: '',
  quantity: '1',
  unit: '',
  unitRate: null,
});
const QTY = /^\d{1,7}(\.\d{1,3})?$/;

/** A request: the editor for the contractor side, the read view (and the owner's answer) for everyone else. */
export function SpendingRequestPage() {
  const { id = '', requestId = 'new' } = useParams();
  const isNew = requestId === 'new';
  const navigate = useNavigate();
  const uid = useId();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [view, setView] = useState<SpendingView | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = (r: SpendingView) => {
    setView(r);
    setIndex(r.milestoneIndex);
    setStageId(r.stageId);
    setPurpose(r.purpose);
    setRequiredDate(r.requiredDate ?? '');
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
    void Promise.all([
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

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!project || !budget || (!isNew && !view)) return null;

  const editable = isNew ? project.myRoles.some((r) => REQUESTERS.includes(r)) : !!view?.canEdit;
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
  const over = line && total !== null && total > line.headroom;
  const canSave = !!line && purpose.trim().length >= 3 && linesValid;
  const keptFiles = (view?.files ?? []).filter((f) => !removed.includes(f.id));
  const room = MAX_SPENDING_FILES - keptFiles.length - newFiles.length;

  const uploadAll = async () => {
    const out: { uploadKey: string; fileName: string | null }[] = [];
    for (const f of newFiles) {
      const contentType = (FILE_TYPES.includes(f.type) ? f.type : 'application/pdf') as 'application/pdf';
      const grant = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/spending/uploads', {
            params: { path: { id } },
            body: { contentType, sizeBytes: f.size },
          }),
        ),
      );
      const put = await fetch(grant.url, {
        method: 'PUT',
        headers: grant.headers,
        body: f,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      out.push({ uploadKey: grant.key, fileName: f.name || null });
    }
    return out;
  };

  const save = async (): Promise<SpendingView | null> => {
    if (index === null) return null;
    setError(null);
    try {
      const files = await uploadAll();
      const body = {
        milestoneIndex: index,
        stageId,
        purpose: purpose.trim(),
        requiredDate: requiredDate || null,
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
                  header: { 'Idempotency-Key': crypto.randomUUID() },
                },
                body,
              }),
            ),
          );
      load(next);
      if (isNew) navigate(`/projects/${id}/spending/${next.id}`, { replace: true });
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

  const setLine = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    touch();
  };

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">
            <Link to={`/projects/${id}/spending`}>{t('spending.title')}</Link> · {project.name}
          </p>
          <Text variant="screenTitle" as="h1">
            {view ? view.number : t('spending.newRequest')}
          </Text>
        </div>
        {view && <StatusChip status={view.status} />}
      </header>

      {!editable && view ? (
        <RequestRead view={view} projectId={id} onChange={load} />
      ) : (
        <div className="jl-card wz-card">
          {view?.status === 'changes_requested' ? (
            <p className="rv-banner is-problem">
              {t('spending.changesBanner')}
              {view.decisions[0]?.note && ` “${view.decisions[0].note}”`}
            </p>
          ) : view?.status === 'submitted' ? (
            <p className="rv-banner is-info">{t('spending.waitingOwner')}</p>
          ) : (
            <p className="rv-banner is-info">{t('spending.draftPrivate')}</p>
          )}
          <section className="wz-section">
            <Text variant="sectionTitle" as="h2">
              {t('spending.package')}
            </Text>
            <div className="cl-milestones" role="radiogroup" aria-label={t('spending.package')}>
              {budget.lines.map((l) => (
                <button
                  key={l.index}
                  type="button"
                  role="radio"
                  aria-checked={index === l.index}
                  className={`cl-ms${index === l.index ? ' is-on' : ''}`}
                  onClick={() => {
                    setIndex(l.index);
                    touch();
                  }}
                >
                  <strong>{l.name}</strong>
                  <small>
                    {t('spending.costBudget', {
                      amount: formatRwf(l.costBudget),
                    })}
                  </small>
                  <small className={l.headroom <= 0 ? 'is-problem' : undefined}>
                    {t('spending.free')} {formatRwf(l.headroom)}
                  </small>
                </button>
              ))}
            </div>
          </section>

          <section className="wz-section">
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={`${uid}-purpose`}>
                {t('spending.purpose')}
              </label>
              <span className="si-input pl-input">
                <input
                  id={`${uid}-purpose`}
                  value={purpose}
                  maxLength={300}
                  placeholder={t('spending.purposePlaceholder')}
                  onChange={(e) => {
                    setPurpose(e.target.value);
                    touch();
                  }}
                />
              </span>
            </div>
            <div className="pl-row">
              <div className="jl-field">
                <label className="jl-field__label" htmlFor={`${uid}-date`}>
                  {t('spending.requiredDate')}
                </label>
                <span className="si-input pl-input">
                  <input
                    id={`${uid}-date`}
                    type="date"
                    value={requiredDate}
                    onChange={(e) => {
                      setRequiredDate(e.target.value);
                      touch();
                    }}
                  />
                </span>
              </div>
              <div className="jl-field">
                <label className="jl-field__label" htmlFor={`${uid}-stage`}>
                  {t('spending.stage')}
                </label>
                <span className="si-input pl-input">
                  <select
                    id={`${uid}-stage`}
                    value={stageId ?? ''}
                    onChange={(e) => {
                      setStageId(e.target.value || null);
                      touch();
                    }}
                  >
                    <option value="">{t('spending.noStage')}</option>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            </div>
          </section>

          <section className="wz-section">
            <Text variant="sectionTitle" as="h2">
              {t('spending.lines')}
            </Text>
            <ol className="sp-lines">
              {lines.map((l, i) => (
                <li key={i}>
                  <span className="si-input pl-input sp-lines__desc">
                    <input
                      aria-label={`${t('spending.lineDescription')} ${i + 1}`}
                      value={l.description}
                      maxLength={200}
                      placeholder={t('spending.lineDescription')}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                    />
                  </span>
                  <label className="jl-field sp-lines__qty">
                    <span className="jl-field__label">{t('spending.quantity')}</span>
                    <span className={`si-input pl-input${l.quantity && !QTY.test(l.quantity.trim()) ? ' si-input--error' : ''}`}>
                      <input
                        aria-label={`${t('spending.quantity')} ${i + 1}`}
                        inputMode="decimal"
                        value={l.quantity}
                        placeholder={t('spending.quantity')}
                        onChange={(e) =>
                          setLine(i, {
                            quantity: e.target.value.replace(',', '.'),
                          })
                        }
                      />
                    </span>
                  </label>
                  <label className="jl-field sp-lines__unit">
                    <span className="jl-field__label">{t('spending.unit')}</span>
                    <span className="si-input pl-input">
                      <input aria-label={`${t('spending.unit')} ${i + 1}`} value={l.unit} maxLength={20} placeholder="bag, m³, piece" onChange={(e) => setLine(i, { unit: e.target.value })} />
                    </span>
                  </label>
                  <div className="sp-lines__rate">
                    <AmountInput label={t('spending.unitRate')} value={l.unitRate} onChange={(unitRate) => setLine(i, { unitRate })} />
                  </div>
                  <strong className="sp-lines__amount">{QTY.test(l.quantity.trim()) && l.unitRate ? formatRwf(lineAmount(l.quantity.trim(), l.unitRate)) : '—'}</strong>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="wz-stages__remove sp-lines__remove"
                      aria-label={t('spending.removeLine')}
                      onClick={() => {
                        setLines((ls) => ls.filter((_, j) => j !== i));
                        touch();
                      }}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ol>
            {lines.length < MAX_SPENDING_LINES && (
              <div>
                <Button
                  variant="ghost"
                  icon={Plus}
                  onClick={() => {
                    setLines((ls) => [...ls, emptyLine()]);
                    touch();
                  }}
                >
                  {t('spending.addLine')}
                </Button>
              </div>
            )}
          </section>

          <section className="wz-section">
            <h3 className="cl-sub">{t('spending.quotations')}</h3>
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
                    <small>{Math.max(1, Math.round(f.size / 1024))} KB</small>
                  </span>
                  <button
                    type="button"
                    className="wz-stages__remove"
                    aria-label={t('claims.remove')}
                    onClick={() => {
                      setNewFiles((n) => n.filter((_, j) => j !== i));
                      touch();
                    }}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {room > 0 && (
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
                    // Copy now: the input is cleared right after, which empties its live FileList.
                    const chosen = Array.from(e.target.files ?? []).slice(0, room);
                    setNewFiles((n) => [...n, ...chosen]);
                    touch();
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </section>

          <div className="qt-total">
            <span>{t('spending.total')}</span>
            <strong>{total === null ? '—' : formatRwf(total)}</strong>
          </div>
          {over && line && (
            <span className="jl-field__error" role="alert">
              {t('spending.overHeadroom', {
                amount: formatRwf(Math.max(0, line.headroom)),
              })}
            </span>
          )}
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
                disabled={!canSave || !!busy}
                onClick={async () => {
                  setBusy('save');
                  if (await save()) setSaved(true);
                  setBusy(null);
                }}
              >
                {t('spending.saveDraft')}
              </Button>
              <Button icon={Send} loading={busy === 'send'} disabled={!canSave || !!over || !!busy} onClick={() => void onSend()}>
                {t('spending.send')}
              </Button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function WithdrawButton({ view, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      icon={Undo2}
      loading={busy}
      onClick={async () => {
        if (!window.confirm(t('spending.withdrawConfirm'))) return;
        setBusy(true);
        try {
          onChange(
            await withRefresh(() =>
              request(() =>
                api.POST('/v1/projects/{id}/spending/{requestId}/withdraw', {
                  params: {
                    path: { id: projectId, requestId: view.id },
                    header: { 'If-Match': `"${view.version}"` },
                  },
                }),
              ),
            ),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {t('spending.withdraw')}
    </Button>
  );
}

/** Amount and purpose first, the items and quotations, the request's ledger, then the next step. */
function RequestRead({ view: r, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t, locale } = useI18n();
  return (
    <div className="jl-card wz-card cl-read">
      <div>
        <strong className="cl-read__amount">{formatRwf(r.amount)}</strong>
        <Text variant="sectionTitle" as="h2">
          {r.purpose}
        </Text>
        <p className="jl-field__hint">
          {r.milestoneName} · {t('claims.agreementVersion', { version: r.agreementVersion })}
          {r.stageName && ` · ${r.stageName}`}
          {r.requiredDate && ` · ${t('spending.requiredDate')} ${formatDate(locale, fromIsoDate(r.requiredDate))}`}
        </p>
        {r.submittedAt && (
          <p className="jl-field__hint">
            {t('claims.sentLine', {
              date: formatDate(locale, r.submittedAt),
              name: r.createdByName ?? t('claims.someone'),
            })}
          </p>
        )}
      </div>
      {r.status === 'submitted' && !r.canDecide && <p className="rv-banner is-info">{t('spending.waitingOwner')}</p>}
      {r.status === 'approved' && <p className="rv-banner is-ok">{t('spending.approvedBanner', { amount: formatRwf(r.reserved) })}</p>}
      {r.status === 'closed' && <p className="rv-banner is-info">{t('spending.closedBanner')}</p>}
      {r.status === 'rejected' && <p className="rv-banner is-problem">{t('spending.rejectedBanner')}</p>}

      <table className="qt-table sp-table">
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <strong>{l.description}</strong>
                <small>
                  {t('spending.lineTotal', {
                    qty: l.quantity,
                    unit: l.unit,
                    rate: formatRwf(l.unitRate),
                  })}
                </small>
              </td>
              <td>{formatRwf(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.files.length > 0 && (
        <section className="wz-section">
          <h3 className="cl-sub">{t('spending.quotations')}</h3>
          <ul className="cl-files">
            {r.files.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        </section>
      )}

      {r.reserved > 0 && (
        <section className="sp-ledger">
          <h3 className="cl-sub">{t('spending.ledgerTitle')}</h3>
          <dl>
            <dt>{t('spending.ledgerReserved')}</dt>
            <dd>{formatRwf(r.reserved)}</dd>
            <dt>{t('spending.ledgerPosted')}</dt>
            <dd>− {formatRwf(r.posted)}</dd>
            {r.released > 0 && (
              <>
                <dt>{t('spending.ledgerReleased')}</dt>
                <dd>− {formatRwf(r.released)}</dd>
              </>
            )}
            <dt className="sp-ledger__left">{t('spending.ledgerLeft')}</dt>
            <dd className="sp-ledger__left">{formatRwf(r.committed)}</dd>
          </dl>
        </section>
      )}

      {(r.status === 'approved' || r.status === 'closed') && (
        <section className="wz-section">
          <h3 className="cl-sub">{t('spending.expensesTitle')}</h3>
          {r.missingReceipts > 0 && <p className="rv-banner is-problem">{t('receipt.missingCount', { count: r.missingReceipts })}</p>}
          {r.expenses.length === 0 ? (
            <p className="jl-field__hint">{t('spending.noExpenses')}</p>
          ) : (
            <ul className="rc-expenses">
              {r.expenses.map((e) => (
                <ExpenseItem key={e.id} expense={e} projectId={projectId} onChange={onChange} />
              ))}
            </ul>
          )}
          {r.canPostExpense && <ExpenseForm view={r} projectId={projectId} onChange={onChange} />}
          {r.canClose && <CloseButton view={r} projectId={projectId} onChange={onChange} />}
        </section>
      )}

      {r.canDecide && <DecisionPanel view={r} projectId={projectId} onChange={onChange} />}
      {r.decisions.length > 0 && (
        <section className="wz-section">
          <h3 className="cl-sub">{t('claims.history')}</h3>
          <ul className="cl-history">
            {r.decisions.map((d) => (
              <li key={d.at} className={`is-${d.kind}`}>
                <strong>
                  {t(`claims.decided_${d.kind}`, {
                    name: d.byName ?? t('claims.someone'),
                    date: formatDate(locale, d.at),
                  })}
                </strong>
                <small>{formatRwf(d.amount)}</small>
                {d.note && <span>“{d.note}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ExpenseForm({ view, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const { withRefresh } = useAuth();
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(localDate());
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = amount !== null && amount > view.committed;
  const valid = description.trim().length >= 2 && !!date && date <= localDate() && !!amount && !over;

  return (
    <form
      className="sp-expense"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        try {
          const next = await withRefresh(() =>
            request(() =>
              api.POST('/v1/projects/{id}/spending/{requestId}/expenses', {
                params: {
                  path: { id: projectId, requestId: view.id },
                  header: { 'Idempotency-Key': crypto.randomUUID() },
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
    >
      <h4 className="cl-sub">
        <ReceiptText size={16} aria-hidden /> {t('spending.recordExpense')}
      </h4>
      <div className="pl-row">
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-desc`}>
            {t('spending.expenseDescription')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-desc`} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </span>
        </div>
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-supplier`}>
            {t('spending.supplier')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-supplier`} value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
          </span>
        </div>
      </div>
      <div className="pl-row">
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-date`}>
            {t('spending.expenseDate')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-date`} type="date" max={localDate()} value={date} onChange={(e) => setDate(e.target.value)} />
          </span>
        </div>
        <AmountInput label={t('spending.expenseAmount')} value={amount} onChange={setAmount} />
      </div>
      {over && <span className="jl-field__error">{t('spending.overReserved', { amount: formatRwf(view.committed) })}</span>}
      <span className="jl-field__hint">{t('spending.expenseHint')}</span>
      {error && (
        <span className="jl-field__error" role="alert">
          {error}
        </span>
      )}
      <div>
        <Button type="submit" icon={Check} loading={busy} disabled={!valid}>
          {t('spending.postExpense')}
        </Button>
      </div>
    </form>
  );
}

function CloseButton({ view, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const amount = formatRwf(view.committed);
  return (
    <div>
      <Button
        variant="secondary"
        icon={Wallet}
        loading={busy}
        onClick={async () => {
          if (!window.confirm(t('spending.closeConfirm', { amount }))) return;
          setBusy(true);
          try {
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
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('spending.closeRequest', { amount })}
      </Button>
    </div>
  );
}

/** The owner's answer: approval reserves the amount (after a locked headroom check on the server). */
function DecisionPanel({ view, projectId, onChange }: { view: SpendingView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'approve' | 'request_changes' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

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
                  'Idempotency-Key': crypto.randomUUID(),
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
      if (err instanceof ApiError && err.status === 412) setStale(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
      dialog.current?.close();
    }
  };

  if (stale)
    return (
      <div className="pl-note jl-card" role="alert">
        <span>{t('claims.staleAnswer')}</span>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t('plan.reload')}
        </Button>
      </div>
    );

  const amount = formatRwf(view.amount);
  return (
    <section className="rv-card ag-decide">
      <Text variant="sectionTitle" as="h2">
        {t('claims.decideTitle')}
      </Text>
      <p className="jl-field__hint">{t('spending.decideHint', { amount, line: view.milestoneName })}</p>
      {mode === 'approve' ? (
        <div className="iv-share">
          <Button icon={Check} onClick={() => dialog.current?.showModal()}>
            {t('spending.approveButton', { amount })}
          </Button>
          <Button variant="secondary" onClick={() => setMode('request_changes')}>
            {t('claims.askChanges')}
          </Button>
          <Button variant="ghost" onClick={() => setMode('reject')}>
            {t('claims.reject')}
          </Button>
        </div>
      ) : (
        <form
          className="ac-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void decide(mode);
          }}
        >
          <label className="jl-field__label" htmlFor="sp-note">
            {mode === 'reject' ? t('claims.rejectLabel') : t('claims.changesLabel')}
          </label>
          <textarea id="sp-note" className="pl-textarea" rows={3} maxLength={1000} value={note} placeholder={t('claims.reasonPlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <div className="wz-actions">
            <Button variant="secondary" onClick={() => setMode('approve')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={mode === 'reject' ? 'danger' : 'primary'} loading={busy} disabled={note.trim().length < 3}>
              {mode === 'reject' ? t('spending.sendReject') : t('claims.sendChanges')}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}
      <dialog ref={dialog} className="ws-dialog" aria-labelledby="sp-confirm-title">
        <form method="dialog">
          <h2 id="sp-confirm-title" className="jl-text-section-title">
            {t('spending.approveConfirmTitle', { amount })}
          </h2>
          <p className="jl-text-display">{amount}</p>
          <p className="jl-muted">
            {t('spending.approveConfirmBody', {
              amount,
              line: view.milestoneName,
            })}
          </p>
          <div className="ws-actions">
            <Button size="lg" icon={Check} loading={busy} onClick={() => void decide('approve')}>
              {t('spending.approveConfirmYes', { amount })}
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
      {f.kind === 'photo' && f.thumbUrl ? (
        <img src={f.thumbUrl} alt="" />
      ) : (
        <span className="cl-file__icon">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <span className="cl-file__text">
        {f.url ? (
          <a href={f.url} target="_blank" rel="noreferrer">
            {name}
          </a>
        ) : (
          <strong>{name}</strong>
        )}
        <small>{f.status === 'ready' ? `${t('claims.open')} · ${Math.max(1, Math.round(f.sizeBytes / 1024))} KB` : t(`claims.file_${f.status}`)}</small>
      </span>
      {onRemove && (
        <button type="button" className="wz-stages__remove" aria-label={t('claims.remove')} onClick={onRemove}>
          <X size={16} aria-hidden />
        </button>
      )}
    </li>
  );
}

/** One expense with its receipt: status, EBM details, warnings, and the next step for this person. */
function ExpenseItem({ expense: e, projectId, onChange }: { expense: ExpenseView; projectId: string; onChange: (r: SpendingView) => void }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const r = e.receipt;
  return (
    <li className="rc-expense">
      <div className="rc-expense__head">
        <span>
          <strong>
            {e.description} · {formatRwf(e.amount)}
          </strong>
          <small>
            {e.number} · {formatDate(locale, fromIsoDate(e.expenseDate))}
            {e.supplierName && ` · ${e.supplierName}`} · {e.byName ?? t('claims.someone')}
          </small>
        </span>
        <span className={`qt-status rc-status is-${e.receiptStatus}`}>{e.receiptStatus === 'not_supplied' ? t('receipt.missing') : t(`receipt.status_${e.receiptStatus}`)}</span>
      </div>
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
      {r && !editing && (
        <div className="iv-share">
          {r.canEdit && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('receipt.edit')}
            </Button>
          )}
        </div>
      )}
      {r?.canReview && !editing && <ReceiptReview expense={e} receipt={r} projectId={projectId} onChange={onChange} />}
    </li>
  );
}

function ReceiptDetails({ receipt: r, amount }: { receipt: ReceiptView; amount: number }) {
  const { t, locale } = useI18n();
  return (
    <div className="rc-details">
      <dl>
        <dt>{t('receipt.supplierName')}</dt>
        <dd>
          {r.supplierName}
          {r.supplierTin && ` · TIN ${r.supplierTin}`}
        </dd>
        <dt>{t('receipt.invoiceNumber')}</dt>
        <dd>
          {r.invoiceNumber} · {formatDate(locale, fromIsoDate(r.invoiceDate))}
        </dd>
        <dt>{t('receipt.total')}</dt>
        <dd>
          {formatRwf(r.total)}
          {r.vatAmount != null && ` · VAT ${formatRwf(r.vatAmount)}`}
        </dd>
        {r.ebmReference && (
          <>
            <dt>EBM</dt>
            <dd>{r.ebmReference}</dd>
          </>
        )}
        {r.buyerTin && (
          <>
            <dt>{t('receipt.buyerTin')}</dt>
            <dd>{r.buyerTin}</dd>
          </>
        )}
      </dl>
      {r.file && (
        <ul className="cl-files">
          <FileRow file={r.file} />
        </ul>
      )}
      {!r.totalMatches && (
        <p className="rc-warn">
          <TriangleAlert size={16} aria-hidden /> {t('receipt.totalMismatch', { total: formatRwf(r.total), amount: formatRwf(amount) })}
        </p>
      )}
      {r.duplicates.map((d, i) => (
        <p key={i} className="rc-warn">
          <TriangleAlert size={16} aria-hidden /> {t(d.kind === 'invoice' ? 'receipt.duplicateInvoice' : 'receipt.duplicateFile', { expense: d.expenseNumber, project: d.projectName })}
        </p>
      ))}
      <small className="jl-field__hint">
        {t('receipt.capturedLine', { name: r.capturedByName ?? t('claims.someone'), date: formatDate(locale, r.capturedAt) })}
        {r.reviewedAt && ` · ${t('receipt.reviewedLine', { status: t(`receipt.status_${r.status}`), name: r.reviewedByName ?? t('claims.someone'), date: formatDate(locale, r.reviewedAt) })}`}
        {r.reviewNote && ` · “${r.reviewNote}”`}
      </small>
      <small className="jl-field__hint">{t('receipt.notVerified')}</small>
    </div>
  );
}

function ReceiptForm({ expense: e, projectId, onChange, onCancel }: { expense: ExpenseView; projectId: string; onChange: (r: SpendingView) => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const uid = useId();
  const { withRefresh } = useAuth();
  const r = e.receipt;
  const [supplierName, setSupplierName] = useState(r?.supplierName ?? e.supplierName ?? '');
  const [supplierTin, setSupplierTin] = useState(r?.supplierTin ?? '');
  const [buyerTin, setBuyerTin] = useState(r?.buyerTin ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(r?.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(r?.invoiceDate ?? e.expenseDate);
  const [total, setTotal] = useState<number | null>(r?.total ?? e.amount);
  const [vat, setVat] = useState<number | null>(r?.vatAmount ?? null);
  const [ebmReference, setEbmReference] = useState(r?.ebmReference ?? '');
  const [qrPayload, setQrPayload] = useState(r?.qrPayload ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tinOk = (v: string) => v.trim() === '' || /^\d{9}$/.test(v.trim());
  const valid =
    supplierName.trim().length >= 2 &&
    invoiceNumber.trim().length >= 1 &&
    !!invoiceDate &&
    invoiceDate <= localDate() &&
    total !== null &&
    tinOk(supplierTin) &&
    tinOk(buyerTin) &&
    (vat === null || vat <= total);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let upload: { uploadKey: string; fileName: string | null } | null = null;
      if (file) {
        const contentType = (FILE_TYPES.includes(file.type) ? file.type : 'application/pdf') as 'application/pdf';
        const grant = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/receipts/uploads', { params: { path: { id: projectId } }, body: { contentType, sizeBytes: file.size } })));
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: file });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        upload = { uploadKey: grant.key, fileName: file.name || null };
      }
      onChange(
        await withRefresh(() =>
          request(() =>
            api.PUT('/v1/projects/{id}/expenses/{expenseId}/receipt', {
              params: { path: { id: projectId, expenseId: e.id }, header: { 'If-Match': r ? `"${r.version}"` : '' } },
              body: {
                supplierName: supplierName.trim(),
                supplierTin: supplierTin.trim() || null,
                buyerTin: buyerTin.trim() || null,
                invoiceNumber: invoiceNumber.trim(),
                invoiceDate,
                total: total ?? 0,
                vatAmount: vat,
                ebmReference: ebmReference.trim() || null,
                qrPayload: qrPayload.trim() || null,
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

  const text = (id: string, label: string, value: string, set: (v: string) => void, opts: { hint?: string; bad?: boolean; mode?: 'numeric' } = {}) => (
    <div className="jl-field">
      <label className="jl-field__label" htmlFor={`${uid}-${id}`}>
        {label}
      </label>
      <span className={`si-input pl-input${opts.bad ? ' si-input--error' : ''}`}>
        <input id={`${uid}-${id}`} value={value} inputMode={opts.mode} onChange={(ev) => set(ev.target.value)} />
      </span>
      {opts.hint && <span className="jl-field__hint">{opts.hint}</span>}
    </div>
  );

  return (
    <form
      className="sp-expense rc-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (valid) void submit();
      }}
    >
      <h4 className="cl-sub">
        <ReceiptText size={16} aria-hidden /> {r ? t('receipt.edit') : t('receipt.add')} · {e.number}
      </h4>
      <div className="pl-row">
        {text('supplier', t('receipt.supplierName'), supplierName, setSupplierName)}
        {text('tin', t('receipt.supplierTin'), supplierTin, setSupplierTin, { hint: t('receipt.tinHint'), bad: !tinOk(supplierTin), mode: 'numeric' })}
      </div>
      <div className="pl-row">
        {text('invoice', t('receipt.invoiceNumber'), invoiceNumber, setInvoiceNumber)}
        <div className="jl-field">
          <label className="jl-field__label" htmlFor={`${uid}-date`}>
            {t('receipt.invoiceDate')}
          </label>
          <span className="si-input pl-input">
            <input id={`${uid}-date`} type="date" max={localDate()} value={invoiceDate} onChange={(ev) => setInvoiceDate(ev.target.value)} />
          </span>
        </div>
      </div>
      <div className="pl-row">
        <AmountInput label={t('receipt.total')} value={total} onChange={setTotal} />
        <AmountInput label={t('receipt.vat')} value={vat} onChange={setVat} />
      </div>
      <div className="pl-row">
        {text('ebm', t('receipt.ebmReference'), ebmReference, setEbmReference)}
        {text('buyer', t('receipt.buyerTin'), buyerTin, setBuyerTin, { bad: !tinOk(buyerTin), mode: 'numeric' })}
      </div>
      {text('qr', t('receipt.qrPayload'), qrPayload, setQrPayload)}
      <div className="jl-field">
        <label className="jl-field__label" htmlFor={`${uid}-file`}>
          {t('receipt.file')}
        </label>
        <input id={`${uid}-file`} type="file" accept={FILE_TYPES.join(',')} onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
      </div>
      {total !== null && total !== e.amount && <p className="rc-warn">{t('receipt.totalMismatch', { total: formatRwf(total), amount: formatRwf(e.amount) })}</p>}
      <span className="jl-field__hint">{t('receipt.notVerified')}</span>
      {error && (
        <span className="jl-field__error" role="alert">
          {error}
        </span>
      )}
      <div className="iv-share">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" icon={Check} loading={busy} disabled={!valid}>
          {t('receipt.save')}
        </Button>
      </div>
    </form>
  );
}

/** The independent check (spec §26.1): reviewed, or a discrepancy with a note. Never "verified with RRA". */
function ReceiptReview({ expense: e, receipt: r, projectId, onChange }: { expense: ExpenseView; receipt: ReceiptView; projectId: string; onChange: (v: SpendingView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (status: 'manually_reviewed' | 'discrepancy_found') => {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await withRefresh(() =>
          request(() =>
            api.POST('/v1/projects/{id}/expenses/{expenseId}/receipt/review', {
              params: { path: { id: projectId, expenseId: e.id }, header: { 'If-Match': `"${r.version}"` } },
              body: { status, ...(note.trim() ? { note: note.trim() } : {}) },
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
    <div className="rc-review">
      <strong>{t('receipt.reviewTitle')}</strong>
      <span className="jl-field__hint">{t('receipt.reviewHint')}</span>
      {flagging ? (
        <>
          <label className="jl-field__label" htmlFor={`rc-note-${e.id}`}>
            {t('receipt.discrepancyLabel')}
          </label>
          <textarea id={`rc-note-${e.id}`} className="pl-textarea" rows={2} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} />
          <div className="iv-share">
            <Button variant="secondary" onClick={() => setFlagging(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} disabled={note.trim().length < 3} onClick={() => void send('discrepancy_found')}>
              {t('receipt.markDiscrepancy')}
            </Button>
          </div>
        </>
      ) : (
        <div className="iv-share">
          <Button icon={Check} loading={busy} onClick={() => void send('manually_reviewed')}>
            {t('receipt.markReviewed')}
          </Button>
          <Button variant="secondary" onClick={() => setFlagging(true)}>
            {t('receipt.markDiscrepancy')}
          </Button>
        </div>
      )}
      {error && (
        <span className="jl-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
