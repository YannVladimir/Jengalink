import {
  MAX_EXCLUSIONS,
  MAX_MILESTONES,
  marginOf,
  milestonesFromStages,
  type ProjectStage,
  type ProjectSummary,
  quoteTotal,
  type AgreementView,
  type QuoteSummary,
  type QuoteView,
} from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { AmountInput, Button, StateView, Text } from '@jengalink/ui/web';
import { Check, FilePlus2, FileText, ListChecks, Lock, Plus, Send, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const EDITORS = ['contractor', 'manager'];
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function StatusChip({ status }: { status: QuoteSummary['status'] }) {
  const { t } = useI18n();
  return <span className={`qt-status is-${status}`}>{t(`quote.status_${status}`)}</span>;
}

/** The project's quotes (Phase 4). Owners see only quotes that were sent to them. */
export default function QuotesPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<QuoteSummary[] | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [agreements, setAgreements] = useState<AgreementView[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/quotes', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/agreements', { params: { path: { id } } }))),
    ])
      .then(([q, p, a]) => {
        setList(q);
        setProject(p);
        setAgreements(a);
      })
      .catch(() => setFailed(true));
  }, [id, withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!list || !project) return null;
  const editor = project.myRoles.some((r) => EDITORS.includes(r));

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">{project.name}</p>
          <Text variant="screenTitle" as="h1">
            {t('quote.title')}
          </Text>
        </div>
        {editor && (
          <Link className="jl-btn jl-btn--primary" to={`/projects/${id}/quotes/new`}>
            <FilePlus2 size={18} aria-hidden /> {t('quote.newQuote')}
          </Link>
        )}
      </header>
      {agreements.length > 0 && (
        <section className="jl-card ac-value">
          <span className="jl-field__label">
            {t('agreement.current')} · {t('agreement.version', { n: agreements[0].version })}
          </span>
          <strong className="db-money">{formatRwf(agreements[0].contractValue)}</strong>
          <ul className="ag-history">
            {agreements.map((a) => (
              <li key={a.id}>
                <strong>{t('agreement.version', { n: a.version })}</strong> · {formatRwf(a.contractValue)} ·{' '}
                {a.changeNumber
                  ? t('agreement.historyChange', { change: a.changeNumber, name: a.acceptedByName ?? t('invite.someone'), date: formatDate(locale, a.acceptedAt) })
                  : t('agreement.historyRow', { quote: a.quoteNumber, revision: a.quoteRevision, name: a.acceptedByName ?? t('invite.someone'), date: formatDate(locale, a.acceptedAt) })}
              </li>
            ))}
          </ul>
        </section>
      )}
      {list.length === 0 && <Text muted>{editor ? t('quote.empty') : t('quote.emptyOwner')}</Text>}
      <ul className="iv-list jl-card">
        {list.map((q) => (
          <li key={q.id}>
            <Link to={`/projects/${id}/quotes/${q.id}`}>
              <span className="iv-list__text">
                <small>
                  {q.number} · {t('quote.revision', { n: q.currentRevision })}
                </small>
                <strong>{q.title}</strong>
                <small>{t('quote.validLine', { date: formatDate(locale, fromIsoDate(q.validUntil)) })}</small>
              </span>
              <strong className="qt-amount">{formatRwf(q.total)}</strong>
              <StatusChip status={q.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
const emptyMilestone = (): Draft['milestones'][number] => ({ name: '', description: '', amount: null, stageId: null, basis: 'fixed', feePercent: null, internalCost: null });
const blank = (): Draft => ({
  title: '',
  scope: '',
  milestones: [emptyMilestone()],
  exclusions: [],
  terms: '',
  validUntil: localDate(new Date(Date.now() + 30 * 86_400_000)),
});
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

/** Quote builder: scope, priced milestones, exclusions, terms, validity, branded PDF; owners read the sent revision. */
export function QuoteEditorPage() {
  const { id = '', quoteId = 'new' } = useParams();
  const isNew = quoteId === 'new';
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const navigate = useNavigate();
  const uid = useId();
  const [view, setView] = useState<QuoteView | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'send' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [exclusion, setExclusion] = useState('');
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([
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
  const setMilestone = (i: number, patch: Partial<Draft['milestones'][number]>) => change({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
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
      if (isNew) navigate(`/projects/${id}/quotes/${next.id}`, { replace: true });
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      return null;
    }
  };
  const onSend = async () => {
    setBusy('send');
    const current = dirty || !view ? await save() : view;
    if (current) {
      try {
        const sent = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/quotes/{quoteId}/send', { params: { path: { id, quoteId: current.id } } })));
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
    // Open the tab first (pop-up blockers allow it only during the click), then point it at the PDF.
    const tab = window.open('', '_blank');
    try {
      const link = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/quotes/{quoteId}/pdf', { params: { path: { id, quoteId: view.id }, query: { revision: view.revision } } })));
      if (tab) tab.location.href = link.url;
      else window.location.href = link.url;
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!loaded || !project) return null;
  const editable = isNew ? project.myRoles.some((r) => EDITORS.includes(r)) : !!view?.canEdit;
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const splitAmount = total > 0 ? total : (project.contractValue ?? 0);

  return (
    <div className="ws-page wz qt">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">
            <Link to={`/projects/${id}/quotes`}>{t('quote.title')}</Link> · {project.name}
          </p>
          <Text variant="screenTitle" as="h1">
            {view ? `${view.number} · ${t('quote.revision', { n: view.revision })}` : t('quote.newQuote')}
          </Text>
        </div>
        {view && <StatusChip status={view.status} />}
      </header>

      {view?.decision?.kind === 'accepted' && (
        <p className="rv-banner is-ok">
          {t('agreement.acceptedBanner', {
            name: view.decision.byName ?? t('invite.someone'),
            date: formatDate(locale, view.decision.at),
            version: view.decision.agreementVersion ?? 1,
            value: formatRwf(view.total),
          })}
        </p>
      )}
      {view?.decision?.kind === 'declined' && (
        <p className="rv-banner is-problem">
          {t('agreement.declinedBanner', { name: view.decision.byName ?? t('invite.someone'), date: formatDate(locale, view.decision.at) })}
          {view.decision.note && ` ${t('agreement.declinedReason', { note: view.decision.note })}`}
        </p>
      )}
      {view?.status === 'expired' && view.canEdit && <p className="rv-banner is-problem">{t('quote.expiredNote', { date: fmt(view.validUntil) })}</p>}
      {view?.sentAt && view.canEdit && view.status !== 'expired' && <p className="rv-banner is-info">{t('quote.sentNote', { n: view.revision, date: formatDate(locale, view.sentAt) })}</p>}
      {view && !view.sentAt && view.revisions.some((r) => r.sentAt) && <p className="rv-banner is-info">{t('quote.newRevisionNote', { n: view.revision })}</p>}

      <div className="jl-card wz-card">
        {editable ? (
          <>
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={`${uid}-title`}>
                {t('quote.titleLabel')}
              </label>
              <span className="si-input pl-input">
                <input id={`${uid}-title`} value={draft.title} maxLength={120} placeholder={t('quote.titlePlaceholder')} onChange={(e) => change({ title: e.target.value })} />
              </span>
            </div>
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={`${uid}-scope`}>
                {t('quote.scopeLabel')}
              </label>
              <textarea
                id={`${uid}-scope`}
                className="pl-textarea"
                rows={5}
                maxLength={4000}
                value={draft.scope}
                placeholder={t('quote.scopePlaceholder')}
                onChange={(e) => change({ scope: e.target.value })}
              />
            </div>

            <section className="wz-section">
              <div className="qt-row">
                <Text variant="sectionTitle" as="h2">
                  {t('quote.milestonesLabel')}
                </Text>
                {stages.length > 0 && (
                  <Button
                    variant="secondary"
                    icon={ListChecks}
                    title={t('quote.fromPlanHint', { amount: formatRwf(splitAmount) })}
                    onClick={() => change({ milestones: milestonesFromStages(stages, splitAmount).map((m) => ({ ...emptyMilestone(), name: m.name, amount: m.amount, stageId: m.stageId ?? null })) })}
                  >
                    {t('quote.fromPlan')}
                  </Button>
                )}
              </div>
              <ol className="qt-milestones">
                {draft.milestones.map((m, i) => (
                  <li key={i}>
                    <span className="wz-stages__n">{i + 1}</span>
                    <div className="qt-ms__fields">
                      <span className="si-input pl-input">
                        <input
                          aria-label={`${t('quote.milestoneName')} ${i + 1}`}
                          value={m.name}
                          maxLength={120}
                          placeholder={t('quote.milestoneName')}
                          onChange={(e) => change({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                        />
                      </span>
                      <AmountInput label={t('quote.milestoneAmount')} value={m.amount} onChange={(amount) => setMilestone(i, { amount })} />
                      <div className="si-tabs qt-basis" role="radiogroup" aria-label={t('basis.label')}>
                        {(['fixed', 'reimbursable'] as const).map((k) => (
                          <button key={k} type="button" role="radio" aria-checked={m.basis === k} className={m.basis === k ? 'is-on' : undefined} onClick={() => setMilestone(i, { basis: k })}>
                            {t(`basis.${k}`)}
                          </button>
                        ))}
                      </div>
                      {m.basis === 'reimbursable' ? (
                        <label className="jl-field qt-fee">
                          <span className="jl-field__label">{t('basis.feeLabel')}</span>
                          <span className="si-input pl-input">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              value={m.feePercent ?? ''}
                              placeholder="10"
                              onChange={(e) => setMilestone(i, { feePercent: e.target.value === '' ? null : Math.min(100, Math.round(Number(e.target.value) * 10) / 10) })}
                            />
                          </span>
                        </label>
                      ) : (
                        <span />
                      )}
                      <p className="jl-field__hint qt-explain">{t(m.basis === 'fixed' ? 'basis.explainFixed' : 'basis.explainReimbursable')}</p>
                      {showPrivate && (
                        <div className="qt-private">
                          <AmountInput label={t('basis.internalCost')} value={m.internalCost} onChange={(internalCost) => setMilestone(i, { internalCost })} />
                        </div>
                      )}
                    </div>
                    {draft.milestones.length > 1 && (
                      <button
                        type="button"
                        className="wz-stages__remove"
                        aria-label={t('quote.removeMilestone', { name: m.name })}
                        onClick={() => change({ milestones: draft.milestones.filter((_, j) => j !== i) })}
                      >
                        <X size={18} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {draft.milestones.length < MAX_MILESTONES && (
                <div>
                  <Button variant="ghost" icon={Plus} onClick={() => change({ milestones: [...draft.milestones, emptyMilestone()] })}>
                    {t('quote.addMilestone')}
                  </Button>
                </div>
              )}
            </section>

            <section className="wz-section">
              <Text variant="sectionTitle" as="h2">
                {t('quote.exclusionsLabel')}
              </Text>
              <ul className="pl-criteria">
                {draft.exclusions.map((e, i) => (
                  <li key={`${i}-${e}`}>
                    <span>• {e}</span>
                    <button
                      type="button"
                      className="wz-stages__remove"
                      aria-label={t('quote.removeExclusion', { text: e })}
                      onClick={() => change({ exclusions: draft.exclusions.filter((_, j) => j !== i) })}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {draft.exclusions.length < MAX_EXCLUSIONS && (
                <form
                  className="pl-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (exclusion.trim().length < 2) return;
                    change({ exclusions: [...draft.exclusions, exclusion.trim()] });
                    setExclusion('');
                  }}
                >
                  <span className="si-input pl-input">
                    <input aria-label={t('quote.exclusionsLabel')} value={exclusion} maxLength={200} placeholder={t('quote.exclusionPlaceholder')} onChange={(e) => setExclusion(e.target.value)} />
                  </span>
                  <Button type="submit" variant="secondary" disabled={exclusion.trim().length < 2}>
                    {t('quote.addExclusion')}
                  </Button>
                </form>
              )}
            </section>

            <div className="pl-row qt-terms">
              <div className="jl-field">
                <label className="jl-field__label" htmlFor={`${uid}-terms`}>
                  {t('quote.termsLabel')}
                </label>
                <textarea
                  id={`${uid}-terms`}
                  className="pl-textarea"
                  rows={3}
                  maxLength={2000}
                  value={draft.terms}
                  placeholder={t('quote.termsPlaceholder')}
                  onChange={(e) => change({ terms: e.target.value })}
                />
              </div>
              <div className="jl-field">
                <label className="jl-field__label" htmlFor={`${uid}-valid`}>
                  {t('quote.validUntil')}
                </label>
                <span className={`si-input pl-input${draft.validUntil < localDate() ? ' si-input--error' : ''}`}>
                  <input id={`${uid}-valid`} type="date" min={localDate()} value={draft.validUntil} onChange={(e) => e.target.value && change({ validUntil: e.target.value })} />
                </span>
                {draft.validUntil < localDate() && <span className="jl-field__error">{t('quote.pastDate')}</span>}
              </div>
            </div>
          </>
        ) : (
          view && (
            <div className="qt-read">
              <Text variant="sectionTitle" as="h2">
                {view.title}
              </Text>
              <p className="jl-field__hint">
                {view.organizationName} · {t('quote.validLine', { date: fmt(view.validUntil) })} · {t('basis.quoteBasis', { basis: t(`basis.${view.commercialBasis}`) })}
              </p>
              <h3>{t('quote.scopeLabel')}</h3>
              <p>{view.scope}</p>
              <h3>{t('quote.milestonesLabel')}</h3>
              <table className="qt-table">
                <tbody>
                  {view.milestones.map((m, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <strong>{m.name}</strong>
                        <small>{m.basis === 'reimbursable' ? t('basis.reimbursableLine', { fee: m.feePercent ?? 0 }) : t('basis.fixedLine')}</small>
                        {m.description && <small>{m.description}</small>}
                      </td>
                      <td>{formatRwf(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {view.exclusions.length > 0 && (
                <>
                  <h3>{t('quote.exclusionsLabel')}</h3>
                  <ul>
                    {view.exclusions.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </>
              )}
              {view.terms && (
                <>
                  <h3>{t('quote.termsLabel')}</h3>
                  <p>{view.terms}</p>
                </>
              )}
            </div>
          )
        )}

        {view?.canDecide && (
          <DecisionPanel
            view={view}
            projectId={id}
            onChange={(v) => {
              setView(v);
              setDraft(fromView(v));
            }}
          />
        )}
        {editable && showPrivate && (
          <section className="qt-private qt-private--summary">
            <span className="qt-private__label">
              <Lock size={16} aria-hidden /> {t('basis.privateTitle')}
            </span>
            <span className="jl-field__hint">{t('basis.privateHint')}</span>
            {privateMargin.totalCost === null ? (
              <span className="jl-field__hint">{t('basis.marginUnknown')}</span>
            ) : (
              <dl>
                <dt>{t('basis.totalCost')}</dt>
                <dd>{formatRwf(privateMargin.totalCost)}</dd>
                <dt>{t('basis.margin')}</dt>
                <dd>{t('basis.marginLine', { amount: formatRwf(privateMargin.margin ?? 0), percent: privateMargin.marginPercent ?? 0 })}</dd>
              </dl>
            )}
          </section>
        )}
        <div className="qt-total">
          <span>{t('quote.total')}</span>
          <strong>{formatRwf(editable ? total : (view?.total ?? 0))}</strong>
        </div>
        {error && (
          <p className="jl-field__error" role="alert">
            {error}
          </p>
        )}
        <div className="wz-actions">
          <span>
            {view && (
              <Button variant="secondary" icon={FileText} loading={busy === 'pdf'} onClick={() => void onPdf()}>
                {busy === 'pdf' ? t('quote.pdfPreparing') : t('quote.pdf')}
              </Button>
            )}
          </span>
          {editable && (
            <span className="iv-share">
              {saved && !dirty && <span className="jl-field__hint">{t('quote.saved')}</span>}
              <Button
                variant="secondary"
                loading={busy === 'save'}
                disabled={!valid || (!dirty && !!view) || !!busy}
                onClick={async () => {
                  setBusy('save');
                  if (await save()) setSaved(true);
                  setBusy(null);
                }}
              >
                {busy === 'save' ? t('quote.saving') : t('quote.save')}
              </Button>
              <Button icon={Send} loading={busy === 'send'} disabled={!valid || !!busy || (!!view?.sentAt && !dirty)} onClick={() => void onSend()}>
                {busy === 'send' ? t('quote.sending') : t('quote.send')}
              </Button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The owner's decision on the exact revision shown: accept (confirm dialog) or decline with a reason. */
function DecisionPanel({ view, projectId, onChange }: { view: QuoteView; projectId: string; onChange: (v: QuoteView) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

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
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
      dialog.current?.close();
    }
  };

  if (conflict)
    return (
      <div className="pl-note jl-card" role="alert">
        <span>{t('agreement.conflict')}</span>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t('plan.reload')}
        </Button>
      </div>
    );

  return (
    <section className="rv-card ag-decide">
      <Text variant="sectionTitle" as="h2">
        {t('agreement.decisionTitle')}
      </Text>
      <p className="jl-field__hint">{t('agreement.acceptLead', { value: formatRwf(view.total) })}</p>
      {declining ? (
        <form
          className="ac-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void decide('decline');
          }}
        >
          <label className="jl-field__label" htmlFor="ag-note">
            {t('agreement.declineLabel')}
          </label>
          <textarea id="ag-note" className="pl-textarea" rows={2} maxLength={500} value={note} placeholder={t('agreement.declinePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <div className="wz-actions">
            <Button variant="secondary" onClick={() => setDeclining(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              {t('agreement.sendDecline')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="iv-share">
          <Button icon={Check} onClick={() => dialog.current?.showModal()}>
            {t('agreement.acceptButton')}
          </Button>
          <Button variant="ghost" onClick={() => setDeclining(true)}>
            {t('agreement.decline')}
          </Button>
        </div>
      )}
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}
      <dialog ref={dialog} className="ws-dialog" aria-labelledby="ag-title">
        <form method="dialog">
          <h2 id="ag-title" className="jl-text-section-title">
            {t('agreement.confirmTitle', { number: view.number })}
          </h2>
          <p className="jl-text-display">{formatRwf(view.total)}</p>
          <p className="jl-muted">{t('agreement.confirmBody', { n: view.revision, value: formatRwf(view.total) })}</p>
          <div className="ws-actions">
            <Button size="lg" icon={Check} loading={busy} onClick={() => void decide('accept')}>
              {t('agreement.confirmYes')}
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
