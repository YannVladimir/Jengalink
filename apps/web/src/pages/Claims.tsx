import { type ClaimFile, type ClaimMilestones, claimProblems, type ClaimStatus, type ClaimSummary, type ClaimView, MAX_CLAIM_FILES, type ProjectSummary, type SiteUpdate } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { AmountInput, Button, StateView, Text } from '@jengalink/ui/web';
import { Check, FileText, HandCoins, ImagePlus, Loader, Paperclip, Send, ShieldAlert, Undo2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FeedCard } from '../components/Feed';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const CLAIMERS = ['contractor', 'manager'];
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

function StatusChip({ status }: { status: ClaimStatus }) {
  const { t } = useI18n();
  return <span className={`qt-status cl-status is-${status}`}>{t(`claims.status_${status}`)}</span>;
}

function leftLine(t: ReturnType<typeof useI18n>['t'], m: ClaimMilestones['milestones'][number]) {
  if (m.remaining === null) return t('claims.claimedSoFar', { amount: formatRwf(m.claimed) });
  return m.remaining === 0 ? t('claims.fullyClaimed') : t('claims.left', { amount: formatRwf(m.remaining) });
}

/** The project's payment claims (Phase 4). Owners see claims once they are sent. */
export default function ClaimsPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<ClaimSummary[] | null>(null);
  const [milestones, setMilestones] = useState<ClaimMilestones | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/claims', { params: { path: { id } } }))),
      withRefresh(() =>
        request(() =>
          api.GET('/v1/projects/{id}/claims/milestones', {
            params: { path: { id } },
          }),
        ),
      ),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
    ])
      .then(([c, m, p]) => {
        setList(c);
        setMilestones(m);
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
  if (!list || !project || !milestones) return null;
  const claimer = project.myRoles.some((r) => CLAIMERS.includes(r));
  const agreed = milestones.agreementVersion !== null;

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">{project.name}</p>
          <Text variant="screenTitle" as="h1">
            {t('claims.title')}
          </Text>
        </div>
        {claimer && agreed && project.status === 'active' && (
          <Link className="jl-btn jl-btn--primary" to={`/projects/${id}/claims/new`}>
            <HandCoins size={18} aria-hidden /> {t('claims.newClaim')}
          </Link>
        )}
      </header>
      <p className="jl-field__hint">{t('claims.recordOnly')}</p>
      {!agreed && <Text muted>{t('claims.noAgreement')}</Text>}
      {agreed && (
        <section className="jl-card cl-ceilings">
          <span className="jl-field__label">
            {t('agreement.current')} ·{' '}
            {t('claims.agreementVersion', {
              version: milestones.agreementVersion ?? 1,
            })}
          </span>
          <ul>
            {milestones.milestones.map((m) => (
              <li key={m.index}>
                <span>{m.name}</span>
                <small>{leftLine(t, m)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {agreed && list.length === 0 && <Text muted>{claimer ? t('claims.empty') : t('claims.emptyOwner')}</Text>}
      {list.length > 0 && (
        <ul className="iv-list jl-card">
          {list.map((c) => (
            <li key={c.id}>
              <Link to={`/projects/${id}/claims/${c.id}`}>
                <span className="iv-list__text">
                  <small>
                    {c.number}
                    {c.submittedAt ? ` · ${formatDate(locale, c.submittedAt)}` : ''}
                  </small>
                  <strong>{c.milestoneName}</strong>
                  <small>{t('claims.evidenceCount', { count: c.evidenceCount })}</small>
                </span>
                <strong className="qt-amount">{formatRwf(c.amount)}</strong>
                <StatusChip status={c.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Claim editor for the contractor side; a read view for everyone else (and once sent). */
export function ClaimEditorPage() {
  const { id = '', claimId = 'new' } = useParams();
  const isNew = claimId === 'new';
  const navigate = useNavigate();
  const uid = useId();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [milestones, setMilestones] = useState<ClaimMilestones | null>(null);
  const [updates, setUpdates] = useState<SiteUpdate[]>([]);
  const [view, setView] = useState<ClaimView | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'send' | 'withdraw' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    let live = true;
    void Promise.all([
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
        if (isNew || c?.canEdit) {
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

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!project || !milestones || (!isNew && !view)) return null;

  const editable = isNew ? project.myRoles.some((r) => CLAIMERS.includes(r)) : !!view?.canEdit;
  // A claim already sent opens as the owner sees it; editing it sends the next revision.
  const resend = !!view?.savingSendsRevision;
  const touch = () => setSaved(false);
  const milestone = index === null ? undefined : milestones.milestones[index];
  // What is left without this claim (the milestone list already counts a saved claim).
  const left = milestone?.remaining == null ? null : milestone.remaining + (view && view.milestoneIndex === index && view.status !== 'cancelled' ? view.amount : 0);
  const keptFiles = (view?.files ?? []).filter((f) => !removed.includes(f.id));
  const evidence = picked.length + newFiles.length + keptFiles.filter((f) => f.status === 'processing' || f.status === 'ready').length;
  const problems = claimProblems({ amount, evidence, remaining: left });
  const canSave = milestone !== undefined && amount !== null && amount > 0 && !problems.includes('overClaim');
  const room = MAX_CLAIM_FILES - keptFiles.length - newFiles.length;

  const uploadAll = async () => {
    const out: { uploadKey: string; fileName: string | null }[] = [];
    for (const f of newFiles) {
      const contentType = f.type === 'application/pdf' ? 'application/pdf' : (PHOTO_TYPES.find((p) => p === f.type) ?? 'image/jpeg');
      const grant = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/claims/uploads', {
            params: { path: { id } },
            body: {
              contentType: contentType as 'application/pdf',
              sizeBytes: f.size,
            },
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
                  header: { 'Idempotency-Key': crypto.randomUUID() },
                },
                body,
              }),
            ),
          );
      load(next);
      if (isNew) navigate(`/projects/${id}/claims/${next.id}`, { replace: true });
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      return null;
    }
  };

  const onSend = async () => {
    setBusy('send');
    const current = await save();
    if (current) {
      try {
        load(
          await withRefresh(() =>
            request(() =>
              api.POST('/v1/projects/{id}/claims/{claimId}/submit', {
                params: {
                  path: { id, claimId: current.id },
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

  const onWithdraw = async () => {
    if (!view || !window.confirm(t('claims.withdrawConfirm'))) return;
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
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    // Copy now: the input is cleared right after, which empties its live FileList.
    const chosen = Array.from(list).slice(0, room);
    setNewFiles((f) => [...f, ...chosen]);
    touch();
  };

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">
            <Link to={`/projects/${id}/claims`}>{t('claims.title')}</Link> · {project.name}
          </p>
          <Text variant="screenTitle" as="h1">
            {view ? view.number : t('claims.newClaim')}
          </Text>
        </div>
        {view && <StatusChip status={view.status} />}
      </header>

      {(!editable || (resend && !editing)) && view ? (
        <ClaimRead view={view} projectId={id} onChange={load} onEdit={view.canEdit && resend ? () => setEditing(true) : undefined} />
      ) : (
        <div className="jl-card wz-card">
          {resend && view ? (
            <p className={`rv-banner ${view.status === 'approved' ? 'is-problem' : 'is-info'}`}>
              {t('claims.reviseBanner', { n: view.revisionNo + 1 })}
              {view.status === 'approved' && ` ${t('claims.reviseCancelsApproval', { prev: view.revisionNo })}`}
            </p>
          ) : view?.status === 'changes_requested' ? (
            <p className="rv-banner is-problem">
              {t('claims.changesBanner')}
              {view.decisions[0]?.note && ` “${view.decisions[0].note}”`}
            </p>
          ) : (
            <p className="rv-banner is-info">{t('claims.draftPrivate')}</p>
          )}
          <section className="wz-section">
            <Text variant="sectionTitle" as="h2">
              {t('claims.stepMilestone')}
            </Text>
            <div className="cl-milestones" role="radiogroup" aria-label={t('claims.stepMilestone')}>
              {milestones.milestones.map((m) => {
                const on = index === m.index;
                const locked = (view?.status === 'changes_requested' || resend) && !on;
                return (
                  <button
                    key={m.index}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={locked}
                    className={`cl-ms${on ? ' is-on' : ''}`}
                    onClick={() => {
                      setIndex(m.index);
                      touch();
                    }}
                  >
                    <strong>{m.name}</strong>
                    <small>
                      {m.basis === 'fixed'
                        ? t('claims.agreed', { amount: formatRwf(m.amount) })
                        : t('claims.estimate', {
                            amount: formatRwf(m.amount),
                            fee: m.feePercent ?? 0,
                          })}
                    </small>
                    <small className={m.remaining === 0 ? 'is-problem' : undefined}>{leftLine(t, m)}</small>
                  </button>
                );
              })}
            </div>
          </section>

          {milestone && (
            <section className="wz-section">
              <Text variant="sectionTitle" as="h2">
                {t('claims.stepAmount')}
              </Text>
              <div className="cl-amount">
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
                    variant="secondary"
                    onClick={() => {
                      setAmount(left);
                      touch();
                    }}
                  >
                    {t('claims.claimRest', { amount: formatRwf(left) })}
                  </Button>
                )}
              </div>
              {problems.includes('overClaim') && left !== null && (
                <span className="jl-field__error" role="alert">
                  {t('claims.overClaim', { amount: formatRwf(left) })}
                </span>
              )}
              {milestone.basis === 'reimbursable' && amount !== null && amount + milestone.claimed > milestone.amount && <span className="jl-field__hint">{t('claims.overEstimate')}</span>}
              <div className="jl-field">
                <label className="jl-field__label" htmlFor={`${uid}-note`}>
                  {t('claims.note')}
                </label>
                <textarea
                  id={`${uid}-note`}
                  className="pl-textarea"
                  rows={3}
                  maxLength={2000}
                  value={note}
                  placeholder={t('claims.notePlaceholder')}
                  onChange={(e) => {
                    setNote(e.target.value);
                    touch();
                  }}
                />
              </div>
            </section>
          )}

          {milestone && (
            <section className="wz-section">
              <div>
                <Text variant="sectionTitle" as="h2">
                  {t('claims.stepEvidence')}
                </Text>
                <p className="jl-field__hint">{t('claims.evidenceHint')}</p>
              </div>
              <h3 className="cl-sub">{t('claims.siteUpdates')}</h3>
              {updates.length === 0 && <p className="jl-field__hint">{t('claims.noUpdates')}</p>}
              <ul className="cl-updates">
                {updates.map((u) => {
                  const on = picked.includes(u.id);
                  const thumb = u.photos.find((p) => p.status === 'ready' && p.thumbUrl);
                  return (
                    <li key={u.id}>
                      <label className={on ? 'is-on' : undefined}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setPicked((p) => (on ? p.filter((x) => x !== u.id) : [...p, u.id]));
                            touch();
                          }}
                        />
                        {thumb ? <img src={thumb.thumbUrl!} alt="" /> : <span className="cl-file__icon" />}
                        <span>
                          <strong>
                            {u.stageName} · {formatDate(locale, u.submittedAt)}
                          </strong>
                          <small>{u.note ?? `${t('claims.photo')} × ${u.photos.length}`}</small>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <h3 className="cl-sub">{t('claims.files')}</h3>
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
                    <span className="cl-file__icon">{f.type === 'application/pdf' ? <FileText size={20} aria-hidden /> : <ImagePlus size={20} aria-hidden />}</span>
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
                <div className="iv-share">
                  <Button variant="secondary" icon={ImagePlus} onClick={() => photoInput.current?.click()}>
                    {t('claims.addPhoto')}
                  </Button>
                  <Button variant="secondary" icon={Paperclip} onClick={() => pdfInput.current?.click()}>
                    {t('claims.addDocument')}
                  </Button>
                  <input ref={photoInput} type="file" accept={PHOTO_TYPES.join(',')} multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
                  <input ref={pdfInput} type="file" accept="application/pdf" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
                </div>
              )}
              {problems.includes('evidence') && <p className="jl-field__hint">{t('claims.needEvidence')}</p>}
            </section>
          )}

          {resend && (
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={`${uid}-change`}>
                {t('claims.changeNote')}
              </label>
              <span className="si-input pl-input">
                <input id={`${uid}-change`} value={changeNote} maxLength={500} placeholder={t('claims.changeNotePlaceholder')} onChange={(e) => setChangeNote(e.target.value)} />
              </span>
            </div>
          )}
          <div className="qt-total">
            <span>{milestone?.name ?? t('claims.stepAmount')}</span>
            <strong>{formatRwf(amount ?? 0)}</strong>
          </div>
          {error && (
            <p className="jl-field__error" role="alert">
              {error}
            </p>
          )}
          {busy && newFiles.length > 0 && <p className="jl-field__hint">{t('claims.uploading')}</p>}
          <div className="wz-actions">
            <span>
              {view && view.status !== 'approved' && (
                <Button variant="ghost" icon={Undo2} loading={busy === 'withdraw'} onClick={() => void onWithdraw()}>
                  {t('claims.withdraw')}
                </Button>
              )}
            </span>
            {resend && view ? (
              <span className="iv-share">
                <Button variant="secondary" disabled={!!busy} onClick={() => load(view)}>
                  {t('claims.stopEditing')}
                </Button>
                <Button
                  icon={Send}
                  loading={busy === 'save'}
                  disabled={!canSave || problems.length > 0 || changeNote.trim().length < 3 || !!busy}
                  onClick={async () => {
                    setBusy('save');
                    await save();
                    setBusy(null);
                  }}
                >
                  {t('claims.sendRevision', { n: view.revisionNo + 1 })}
                </Button>
              </span>
            ) : (
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
                  {t('claims.saveDraft')}
                </Button>
                <Button icon={Send} loading={busy === 'send'} disabled={!canSave || problems.length > 0 || !!busy} onClick={() => void onSend()}>
                  {t('claims.send')}
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Amount first, then what it pays for and the evidence. */
function ClaimRead({ view: c, projectId, onChange, onEdit }: { view: ClaimView; projectId: string; onChange: (c: ClaimView) => void; onEdit?: () => void }) {
  const { t, locale } = useI18n();
  return (
    <div className="jl-card wz-card cl-read">
      <div>
        <strong className="cl-read__amount">{formatRwf(c.amount)}</strong>
        {c.revisionNo > 1 && <span className="qt-status cl-rev">{t('claims.revisionBadge', { n: c.revisionNo })}</span>}
        <Text variant="sectionTitle" as="h2">
          {c.milestoneName}
        </Text>
        <p className="jl-field__hint">
          {c.organizationName} ·{' '}
          {c.basis === 'fixed'
            ? t('claims.agreed', { amount: formatRwf(c.milestoneAmount) })
            : t('claims.estimate', {
                amount: formatRwf(c.milestoneAmount),
                fee: c.feePercent ?? 0,
              })}{' '}
          · {t('claims.agreementVersion', { version: c.agreementVersion })}
        </p>
        {c.claimedBefore > 0 && <p className="jl-field__hint">{t('claims.claimedBefore', { amount: formatRwf(c.claimedBefore) })}</p>}
        {c.submittedAt && (
          <p className="jl-field__hint">
            {t('claims.sentLine', {
              date: formatDate(locale, c.submittedAt),
              name: c.submittedByName ?? t('claims.someone'),
            })}
          </p>
        )}
      </div>
      {c.status === 'submitted' && !c.canDecide && <p className="rv-banner is-info">{t('claims.waitingOwner')}</p>}
      {c.status === 'approved' && <p className="rv-banner is-ok">{t('claims.approvedBanner')}</p>}
      {c.status === 'paid' && <p className="rv-banner is-ok">{t('payments.claimPaid')}</p>}
      {(c.status === 'approved' || c.status === 'paid') && (c.paidAmount > 0 || c.pendingPayments > 0) && (
        <p className="jl-field__hint">{t('payments.claimPartly', { paid: formatRwf(c.paidAmount), amount: formatRwf(c.amount), pending: formatRwf(c.pendingPayments) })}</p>
      )}
      {c.status === 'approved' && (
        <div>
          <Link className="jl-btn jl-btn--secondary" to={`/projects/${projectId}/payments?claim=${c.id}`}>
            {t('payments.recordForClaim')}
          </Link>
        </div>
      )}
      {c.status === 'rejected' && <p className="rv-banner is-problem">{t('claims.rejectedBanner')}</p>}
      {onEdit && (
        <div>
          <Button variant="secondary" onClick={onEdit}>
            {t('claims.editClaim')}
          </Button>
        </div>
      )}
      <p className="jl-field__hint">{t('claims.recordOnly')}</p>
      {c.note && (
        <section>
          <h3 className="cl-sub">{t('claims.note')}</h3>
          <p>{c.note}</p>
        </section>
      )}
      <section className="wz-section">
        <h3 className="cl-sub">{t('claims.evidence')}</h3>
        {c.files.length > 0 && (
          <ul className="cl-files">
            {c.files.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        )}
        {c.updates.map((u) => (
          <FeedCard key={u.id} update={u} />
        ))}
      </section>
      {c.canDecide && <DecisionPanel view={c} projectId={projectId} onChange={onChange} />}
      {c.revisions.length + c.decisions.length > 1 && (
        <section className="wz-section">
          <h3 className="cl-sub">{t('claims.history')}</h3>
          <ul className="cl-history">
            {history(c).map((h) =>
              h.type === 'revision' ? (
                <li key={`r${h.r.revisionNo}`} className="is-revision">
                  <strong>
                    {t('claims.revisionLine', {
                      n: h.r.revisionNo,
                      name: h.r.byName ?? t('claims.someone'),
                      date: formatDate(locale, h.r.at),
                    })}
                  </strong>
                  <small>{formatRwf(h.r.amount)}</small>
                  {h.r.changeNote && <span>“{h.r.changeNote}”</span>}
                  {h.r.cancelledApproval && (
                    <small>
                      {t('claims.approvalCancelled', {
                        prev: h.r.revisionNo - 1,
                      })}
                    </small>
                  )}
                </li>
              ) : (
                <li key={`d${h.d.at}`} className={`is-${h.d.kind}`}>
                  <strong>
                    {t(`claims.decided_${h.d.kind}`, {
                      name: h.d.byName ?? t('claims.someone'),
                      date: formatDate(locale, h.d.at),
                    })}
                  </strong>
                  <small>
                    {t('claims.answeredRevision', { n: h.d.revisionNo })} · {formatRwf(h.d.amount)}
                  </small>
                  {h.d.note && <span>“{h.d.note}”</span>}
                </li>
              ),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The owner's answer (spec §41): approve through a dialog that repeats the amount, or send it back
 * or reject it with a reason. The answer names the exact version and amount on screen.
 */
function DecisionPanel({ view, projectId, onChange }: { view: ClaimView; projectId: string; onChange: (c: ClaimView) => void }) {
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
      if (err instanceof ApiError && (err.status === 412 || err.status === 409)) setStale(true);
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
  const label = mode === 'reject' ? t('claims.rejectLabel') : t('claims.changesLabel');
  return (
    <section className="rv-card ag-decide">
      <Text variant="sectionTitle" as="h2">
        {t('claims.decideTitle')}
      </Text>
      <p className="jl-field__hint">{t('claims.decideHint', { amount })}</p>
      {mode === 'approve' ? (
        <div className="iv-share">
          <Button icon={Check} onClick={() => dialog.current?.showModal()}>
            {t('claims.approveButton', { amount })}
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
          <label className="jl-field__label" htmlFor="cl-note">
            {label}
          </label>
          <textarea id="cl-note" className="pl-textarea" rows={3} maxLength={1000} value={note} placeholder={t('claims.reasonPlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <div className="wz-actions">
            <Button variant="secondary" onClick={() => setMode('approve')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={mode === 'reject' ? 'danger' : 'primary'} loading={busy} disabled={note.trim().length < 3}>
              {mode === 'reject' ? t('claims.sendReject') : t('claims.sendChanges')}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}
      <dialog ref={dialog} className="ws-dialog" aria-labelledby="cl-confirm-title">
        <form method="dialog">
          <h2 id="cl-confirm-title" className="jl-text-section-title">
            {t('claims.approveConfirmTitle', { amount })}
          </h2>
          <p className="jl-text-display">{amount}</p>
          <p className="jl-muted">{t('claims.approveConfirmBody', { milestone: view.milestoneName })}</p>
          <div className="ws-actions">
            <Button size="lg" icon={Check} loading={busy} onClick={() => void decide('approve')}>
              {t('claims.approveConfirmYes', { amount })}
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

function FileRow({ file: f, onRemove }: { file: ClaimFile; onRemove?: () => void }) {
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

/** Revisions sent and the owner's answers, newest first. */
function history(c: ClaimView) {
  return [...c.revisions.map((r) => ({ type: 'revision' as const, at: r.at, r })), ...c.decisions.map((d) => ({ type: 'decision' as const, at: d.at, d }))].sort((a, b) => b.at.localeCompare(a.at));
}
