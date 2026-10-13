import type { ProjectStage, ProjectSummary, SiteUpdate, StageTimeline } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Button, StateView, Text } from '@jengalink/ui/web';
import { Camera, Check, CheckCircle2, Clock, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BeforeAfter, FeedCard } from '../components/Feed';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const PAGE = 20;
const REPORTERS = ['contractor', 'supervisor', 'manager'];
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** Activity feed for one project (Phase 3): site updates newest first, by stage. */
export default function ProjectActivityPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [stageId, setStageId] = useState('');
  const [updates, setUpdates] = useState<SiteUpdate[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } })))
      .then(setProject)
      .catch(() => setFailed(true));
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}/stages', { params: { path: { id } } })))
      .then(setStages)
      .catch(() => setStages([]));
  }, [id, withRefresh]);

  const fetchPage = useCallback(
    (before?: string) =>
      withRefresh(() =>
        request(() =>
          api.GET('/v1/projects/{id}/updates', {
            params: { path: { id }, query: { limit: PAGE, ...(stageId ? { stageId } : {}), ...(before ? { before } : {}) } },
          }),
        ),
      ),
    [id, stageId, withRefresh],
  );

  useEffect(() => {
    let live = true;
    fetchPage()
      .then((page) => {
        if (!live) return;
        setUpdates(page);
        setMore(page.length === PAGE);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [fetchPage]);

  if (failed) return <div className="ws-page"><StateView kind="error" title={t('common.somethingWrong')} /></div>;
  if (!project) return null;
  const canReport = project.status === 'active' && project.myRoles.some((r) => REPORTERS.includes(r));

  return (
    <div className="ws-page wz fd">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">{project.name}</p>
          <Text variant="screenTitle" as="h1">
            {t('feed.title')}
          </Text>
        </div>
        {canReport && (
          <Link className="jl-btn jl-btn--primary" to={`/projects/${id}/updates/new`}>
            <Camera size={18} aria-hidden /> {t('nav.newUpdate')}
          </Link>
        )}
      </header>

      {stages.length > 0 && (
        <div className="up-chips" role="radiogroup" aria-label={t('feed.allStages')}>
          {[{ id: '', name: t('feed.allStages') }, ...stages].map((s) => (
            <label key={s.id || 'all'} className={s.id === stageId ? 'is-on' : undefined}>
              <input
                type="radio"
                name="stage"
                checked={s.id === stageId}
                onChange={() => {
                  setStageId(s.id);
                  setUpdates(null);
                }}
              />
              {s.name}
            </label>
          ))}
        </div>
      )}

      {updates === null ? null : updates.length === 0 ? (
        <Text muted>{t('feed.empty')}</Text>
      ) : (
        updates.map((u) => <FeedCard key={u.id} update={u} stageLink={`/projects/${id}/stages/${u.stageId}`} />)
      )}
      {more && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              const last = updates?.[updates.length - 1];
              if (!last) return;
              void fetchPage(last.submittedAt).then((page) => {
                setUpdates([...(updates ?? []), ...page]);
                setMore(page.length === PAGE);
              });
            }}
          >
            {t('feed.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One stage's photo story: before/after, the checks, and its updates in order. */
export function StageTimelinePage() {
  const { id = '', stageId = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [data, setData] = useState<StageTimeline | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}/stages/{stageId}/timeline', { params: { path: { id, stageId } } })))
      .then(setData)
      .catch(() => setFailed(true));
  }, [id, stageId, withRefresh]);

  if (failed) return <div className="ws-page"><StateView kind="error" title={t('common.somethingWrong')} /></div>;
  if (!data) return null;
  const s = data.stage;
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const range = s.plannedStart || s.plannedEnd ? `${s.plannedStart ? fmt(s.plannedStart) : '…'} – ${s.plannedEnd ? fmt(s.plannedEnd) : '…'}` : null;

  return (
    <div className="ws-page wz fd">
      <header className="ws-head">
        <p className="ws-head__sub">
          <Link to={`/projects/${id}/updates`}>{t('feed.activity')}</Link>
        </p>
        <Text variant="screenTitle" as="h1">
          {s.name}
        </Text>
        <p className="ws-head__sub">
          <span className={`fd-status is-${s.status}`}>{t(`feed.status_${s.status}`)}</span>
          {s.weight}%{range ? ` · ${t('feed.planned', { range })}` : ''} · {t('sync.photosCount', { count: data.photoCount })}
        </p>
      </header>

      <ReviewPanel data={data} projectId={id} onChange={setData} />

      <section>
        <Text variant="sectionTitle" as="h2">
          {t('feed.beforeAfter')}
        </Text>
        {data.before && data.after ? <BeforeAfter before={data.before} after={data.after} /> : <Text muted>{t('feed.notEnoughPhotos')}</Text>}
      </section>

      {s.criteria.length > 0 && (
        <section className="jl-card ac-value">
          <span className="jl-field__label">{t('plan.criteriaTitle')}</span>
          <ul className="ac-stage__criteria" style={{ marginLeft: 0 }}>
            {s.criteria.map((c) => (
              <li key={c}>
                <CheckCircle2 size={15} aria-hidden /> {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.reviews.length > 0 && (
        <section className="ac-history">
          <Text variant="sectionTitle" as="h2">
            {t('review.historyTitle')}
          </Text>
          <ul>
            {data.reviews.map((r) => (
              <li key={r.id}>
                <strong>
                  {t(`review.kind_${r.kind}`, { name: r.actorName ?? t('invite.someone') })} · {formatDate(locale, r.createdAt)}
                </strong>
                {r.note && <span>{`\u201C${r.note}\u201D`}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <Text variant="sectionTitle" as="h2">
          {t('feed.stageTimeline')}
        </Text>
        {data.updates.length === 0 && <Text muted>{t('feed.empty')}</Text>}
        <ol className="fd-rail">
          {data.updates.map((u) => (
            <li key={u.id}>
              <FeedCard update={u} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Stage review: the contractor marks it ready; the owner accepts the exact revision (confirm) or asks for changes. */
function ReviewPanel({ data, projectId, onChange }: { data: StageTimeline; projectId: string; onChange: (d: StageTimeline) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const s = data.stage;
  const lastChanges = data.reviews.find((r) => r.kind === 'changes_requested');

  const run = async (call: () => Promise<StageTimeline>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await withRefresh(call));
      setNote('');
      setAsking(false);
      setConflict(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
      dialog.current?.close();
    }
  };
  const submit = () =>
    run(() =>
      request(() =>
        api.POST('/v1/projects/{id}/stages/{stageId}/submit', {
          params: { path: { id: projectId, stageId: s.id } },
          body: note.trim() ? { note: note.trim() } : {},
        }),
      ),
    );
  const review = (decision: 'accept' | 'request_changes') =>
    run(() =>
      request(() =>
        api.POST('/v1/projects/{id}/stages/{stageId}/review', {
          params: { path: { id: projectId, stageId: s.id }, header: { 'If-Match': `"${s.revision}"` } },
          body: decision === 'accept' ? { decision } : { decision, note: note.trim() },
        }),
      ),
    );
  const reload = () =>
    run(() => request(() => api.GET('/v1/projects/{id}/stages/{stageId}/timeline', { params: { path: { id: projectId, stageId: s.id } } })));

  if (s.status === 'accepted')
    return (
      <p className="rv-banner is-ok">
        <CheckCircle2 size={18} aria-hidden /> {t('review.acceptedNote')}
      </p>
    );

  return (
    <div className="rv">
      {s.status === 'changes_required' && lastChanges?.note && (
        <p className="rv-banner is-problem">
          <MessageSquare size={18} aria-hidden /> {t('review.changesAsked', { note: lastChanges.note })}
        </p>
      )}

      {data.canSubmit && (
        <form
          className="jl-card rv-card"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Text variant="sectionTitle" as="h2">
            {t('review.submitTitle')}
          </Text>
          <p className="jl-field__hint">{t('review.submitLead')}</p>
          <label className="jl-field__label" htmlFor="rv-note">
            {t('review.submitNote')}
          </label>
          <textarea id="rv-note" className="pl-textarea" rows={2} maxLength={500} value={note} placeholder={t('review.submitNotePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <div>
            <Button type="submit" loading={busy}>
              {busy ? t('review.submitting') : t('review.submit')}
            </Button>
          </div>
        </form>
      )}

      {s.status === 'ready_for_review' && !data.canReview && (
        <p className="rv-banner is-waiting">
          <Clock size={18} aria-hidden /> {t('review.waitingOwner')}
        </p>
      )}

      {data.canReview && !conflict && (
        <section className="jl-card rv-card">
          <Text variant="sectionTitle" as="h2">
            {t('review.reviewTitle')}
          </Text>
          <p className="jl-field__hint">{t('review.reviewLead', { weight: s.weight })}</p>
          {asking ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim().length >= 3) void review('request_changes');
              }}
              className="ac-ask"
            >
              <label className="jl-field__label" htmlFor="rv-changes">
                {t('accept.changesLabel')}
              </label>
              <textarea id="rv-changes" className="pl-textarea" rows={3} maxLength={500} autoFocus value={note} placeholder={t('review.changesPlaceholder')} onChange={(e) => setNote(e.target.value)} />
              <div className="wz-actions">
                <Button variant="secondary" onClick={() => setAsking(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" loading={busy} disabled={note.trim().length < 3}>
                  {busy ? t('accept.sending') : t('review.sendChanges')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="iv-share">
              <Button icon={Check} onClick={() => dialog.current?.showModal()}>
                {t('review.acceptButton')}
              </Button>
              <Button variant="ghost" icon={MessageSquare} onClick={() => setAsking(true)}>
                {t('accept.requestChanges')}
              </Button>
            </div>
          )}
        </section>
      )}

      {conflict && (
        <div className="pl-note jl-card" role="alert">
          <span>{t('review.conflict')}</span>
          <Button variant="secondary" onClick={() => void reload()}>
            {t('plan.reload')}
          </Button>
        </div>
      )}
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}

      <dialog ref={dialog} className="ws-dialog" aria-labelledby="rv-title">
        <form method="dialog">
          <h2 id="rv-title" className="jl-text-section-title">
            {t('review.confirmTitle', { stage: s.name })}
          </h2>
          <p className="jl-muted">{t('review.confirmBody', { stage: s.name, weight: s.weight })}</p>
          <div className="ws-actions">
            <Button size="lg" icon={Check} loading={busy} onClick={() => void review('accept')}>
              {t('review.confirmYes')}
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
