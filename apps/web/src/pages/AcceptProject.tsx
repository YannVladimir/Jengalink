import type { ProjectAcceptanceView } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { Button, Money, StateView, Text } from '@jengalink/ui/web';
import { Check, CheckCircle2, CircleAlert, MessageSquare, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PromiseList } from '../components/Invitation';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/**
 * The owner reviews the contract value and the stage plan, then accepts the exact
 * version they saw (the project starts and the plan locks) or asks for changes.
 */
export default function AcceptProjectPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const navigate = useNavigate();
  const noteId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  const [view, setView] = useState<ProjectAcceptanceView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [outcome, setOutcome] = useState<'accepted' | 'changes' | null>(null);

  const fetchView = useCallback(
    () => withRefresh(() => request(() => api.GET('/v1/projects/{id}/acceptance', { params: { path: { id } } }))),
    [id, withRefresh],
  );
  useEffect(() => {
    let live = true;
    fetchView()
      .then((v) => live && setView(v))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [fetchView]);

  const reload = () => {
    setLoadFailed(false);
    setConflict(false);
    setError(null);
    fetchView()
      .then(setView)
      .catch(() => setLoadFailed(true));
  };

  const decide = async (decision: 'accept' | 'request_changes') => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const next = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/acceptance', {
            params: { path: { id }, header: { 'If-Match': `"${view.revision}"` } },
            body: decision === 'accept' ? { decision } : { decision, note: note.trim() },
          }),
        ),
      );
      setView(next);
      setOutcome(decision === 'accept' ? 'accepted' : 'changes');
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
      dialog.current?.close();
    }
  };

  if (loadFailed)
    return (
      <div className="ws-page">
        <StateView
          kind="error"
          title={t('common.somethingWrong')}
          action={
            <Button variant="secondary" onClick={reload}>
              {t('common.tryAgain')}
            </Button>
          }
        />
      </div>
    );
  if (!view) return null;

  if (outcome === 'changes' || outcome === 'accepted' || view.status !== 'draft') {
    const accepted = outcome !== 'changes';
    return (
      <div className="ws-page wz">
        <div className="wz-done">
          <span className={`wz-done__icon${accepted ? '' : ' iv-done--neutral'}`} aria-hidden>
            {accepted ? <Check size={32} /> : <MessageSquare size={30} />}
          </span>
          <Text variant="screenTitle" as="h1">
            {accepted ? t('accept.acceptedTitle') : t('accept.changesSentTitle', { org: view.organizationName })}
          </Text>
          <Text muted>{accepted ? t('accept.acceptedLead') : t('accept.changesSentLead')}</Text>
          <Button size="lg" onClick={() => navigate('/projects')}>
            {t('wizard.doneButton')}
          </Button>
        </div>
      </div>
    );
  }

  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const value = view.contractValue;

  return (
    <div className="ws-page wz ac">
      <header className="ws-head">
        <p className="ws-head__sub">
          {view.projectName} · {view.organizationName}
        </p>
        <Text variant="screenTitle" as="h1">
          {t('accept.title')}
        </Text>
        <p className="ws-head__sub">{t('accept.lead')}</p>
      </header>

      <section className="jl-card ac-value">
        <span className="jl-field__label">{t('accept.valueLabel')}</span>
        {value !== null ? <Money amount={value} variant="moneyLarge" /> : <strong>{t('accept.noValue')}</strong>}
        <span className="jl-field__hint">{t('accept.valueNote', { org: view.organizationName })}</span>
      </section>

      <section className="ac-stages">
        <Text variant="sectionTitle" as="h2">
          {t('accept.stagesTitle')}
        </Text>
        <ol>
          {view.stages.map((s) => (
            <li key={s.id} className="jl-card">
              <div className="ac-stage__head">
                <span className="pl-stage__n">{s.position}</span>
                <strong>{s.name}</strong>
                <span className="pl-stage__weight">{s.weight}%</span>
              </div>
              <p className="ac-stage__dates">
                {s.plannedStart || s.plannedEnd
                  ? `${s.plannedStart ? fmt(s.plannedStart) : '…'} – ${s.plannedEnd ? fmt(s.plannedEnd) : '…'}`
                  : t('plan.noDates')}
              </p>
              {s.description && <p className="ac-stage__desc">{s.description}</p>}
              {s.criteria.length > 0 && (
                <ul className="ac-stage__criteria">
                  {s.criteria.map((c) => (
                    <li key={c}>
                      <CheckCircle2 size={15} aria-hidden /> {c}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>

      <PromiseList icon={ShieldCheck} tone="keep" title={t('accept.meansTitle')} items={[t('accept.means1'), t('accept.means2'), t('accept.means3')]} />

      {!view.ready && (
        <div className="iv-pending" role="status">
          <CircleAlert size={20} aria-hidden />
          <div>
            <strong>{t('accept.notReadyTitle')}</strong>
            {!view.readiness.contractValue && <p>{t('accept.missingValue')}</p>}
            {!view.readiness.stages && <p>{t('accept.missingStages')}</p>}
            <p>{t('accept.askContractor', { org: view.organizationName })}</p>
          </div>
        </div>
      )}

      {view.history.length > 0 && (
        <section className="ac-history">
          <Text variant="sectionTitle" as="h2">
            {t('accept.historyTitle')}
          </Text>
          <ul>
            {view.history.map((h) => (
              <li key={h.id}>
                <strong>
                  {t(h.decision === 'accepted' ? 'accept.historyAccepted' : 'accept.historyChanges', {
                    name: h.decidedByName ?? t('invite.someone'),
                    date: formatDate(locale, h.decidedAt),
                  })}
                </strong>
                {h.note && <span>“{h.note}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!view.canDecide && <p className="jl-field__hint">{t('accept.waitingOwner')}</p>}

      {conflict && (
        <div className="pl-note jl-card" role="alert">
          <span>{t('accept.conflict')}</span>
          <Button variant="secondary" onClick={reload}>
            {t('accept.seeNewVersion')}
          </Button>
        </div>
      )}
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}

      {view.canDecide && !conflict && (
        <div className="pl-save ac-actions">
          {asking ? (
            <form
              className="ac-ask"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim().length >= 3) void decide('request_changes');
              }}
            >
              <label className="jl-field__label" htmlFor={noteId}>
                {t('accept.changesLabel')}
              </label>
              <textarea
                id={noteId}
                className="pl-textarea"
                rows={3}
                maxLength={500}
                autoFocus
                value={note}
                placeholder={t('accept.changesPlaceholder')}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="wz-actions">
                <Button variant="secondary" onClick={() => setAsking(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" loading={busy} disabled={note.trim().length < 3}>
                  {busy ? t('accept.sending') : t('accept.sendChanges', { org: view.organizationName })}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <Button variant="ghost" icon={MessageSquare} onClick={() => setAsking(true)}>
                {t('accept.requestChanges')}
              </Button>
              <Button size="lg" icon={Check} disabled={!view.ready} onClick={() => dialog.current?.showModal()}>
                {t('accept.acceptButton')}
              </Button>
            </>
          )}
        </div>
      )}

      <dialog ref={dialog} className="ws-dialog" aria-labelledby="accept-title">
        <form method="dialog">
          <h2 id="accept-title" className="jl-text-section-title">
            {t('accept.confirmTitle')}
          </h2>
          {value !== null && <Money amount={value} variant="display" />}
          <p className="jl-muted">{t('accept.confirmBody', { value: value !== null ? formatRwf(value) : '', count: view.stages.length })}</p>
          <div className="ws-actions">
            <Button size="lg" icon={Check} loading={busy} onClick={() => void decide('accept')}>
              {t('accept.confirmYes')}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => dialog.current?.close()}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
