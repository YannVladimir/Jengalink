import type { DecisionInbox, ProjectOverview, ProjectProgress, UpdatePhoto } from '@jengalink/contracts';
import { formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { StateView, Text } from '@jengalink/ui/web';
import { Camera, FolderPlus, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { NextActionLink, ProgressPanel } from '../components/Dashboard';
import { DecisionInboxPanel } from '../components/DecisionInbox';
import { Lightbox } from '../components/Feed';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const KEY = 'jengalink.web.project';
const REPORTERS = ['contractor', 'supervisor', 'manager'];

/**
 * Home (Phase 3), in order: what needs me, is it on track, the money, then proof.
 * The decision inbox comes first (across projects); with nothing to decide, the next action.
 */
export default function HomePage() {
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [overview, setOverview] = useState<ProjectOverview[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [photos, setPhotos] = useState<UpdatePhoto[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const [inbox, setInbox] = useState<{ data: DecisionInbox; at: number } | null>(null);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/overview')))
      .then(setOverview)
      .catch(() => setFailed(true));
    // What waits on me, across all my projects (the clock is read when the list arrives).
    void withRefresh(() => request(() => api.GET('/v1/decisions')))
      .then((data) => setInbox({ data, at: Date.now() }))
      .catch(() => undefined);
  }, [withRefresh]);

  const project = overview?.find((p) => p.id === chosen) ?? overview?.find((p) => p.status === 'active') ?? overview?.[0];
  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}/progress', { params: { path: { id: projectId } } })))
      .then((p) => live && setProgress(p))
      .catch(() => undefined);
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}/updates', { params: { path: { id: projectId }, query: { limit: 10 } } })))
      .then((list) => live && setPhotos(list.flatMap((u) => u.photos.filter((p) => p.status === 'ready')).slice(0, 8)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId, withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!overview) return null;
  if (!project)
    return (
      <div className="ws-page">
        <StateView
          kind="empty"
          title={t('feed.noProjectsTitle')}
          message={t('dash.emptyLead')}
          action={
            <Link className="jl-btn jl-btn--primary" to="/projects/new">
              <FolderPlus size={18} aria-hidden /> {t('wizard.startProject')}
            </Link>
          }
        />
      </div>
    );

  const canReport = project.status === 'active' && project.myRoles.some((r) => REPORTERS.includes(r));

  return (
    <div className="ws-page db">
      <header className="ws-head fd-head">
        <div>
          {overview.length > 1 ? (
            <select
              className="db-switch"
              aria-label={t('feed.switchProject')}
              value={project.id}
              onChange={(e) => {
                setChosen(e.target.value);
                setProgress(null);
                setPhotos([]);
                try {
                  localStorage.setItem(KEY, e.target.value);
                } catch {
                  // Remembering the choice is only a convenience.
                }
              }}
            >
              {overview.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <Text variant="screenTitle" as="h1">
              {project.name}
            </Text>
          )}
          <p className="ws-head__sub">
            {project.organizationName} · {project.lastUpdateAt ? t('dash.lastUpdate', { when: formatUpdatedAgo(t, locale, project.lastUpdateAt) }) : t('dash.noUpdatesYet')}
            {overview.length > 1 && (
              <>
                {' · '}
                <Link to="/projects">{t('dash.allProjects', { count: overview.length })}</Link>
              </>
            )}
          </p>
        </div>
        {canReport && (
          <Link className="jl-btn jl-btn--primary" to={`/projects/${project.id}/updates/new`}>
            <Camera size={18} aria-hidden /> {t('home.addSiteUpdate')}
          </Link>
        )}
      </header>

      {inbox && inbox.data.count > 0 ? (
        <DecisionInboxPanel inbox={inbox.data} now={inbox.at} multiProject={overview.length > 1} />
      ) : (
        <NextActionLink projectId={project.id} action={project.nextAction} />
      )}

      {project.blockers.length > 0 && (
        <ul className="db-blockers">
          {project.blockers.map((b) => (
            <li key={b.stageId}>
              <TriangleAlert size={16} aria-hidden />
              <Link to={`/projects/${project.id}/stages/${b.stageId}`}>{b.stageName}</Link>: {b.text}
            </li>
          ))}
        </ul>
      )}

      <div className="db-grid">
        {progress?.projectId === project.id && <ProgressPanel projectId={project.id} progress={progress} />}
        <div className="db-side">
          {project.seesMoney && (
            <section className="jl-card ac-value">
              <Text variant="sectionTitle" as="h2">
                {t('home.money')}
              </Text>
              <span className="jl-field__label">{t('dash.contractValue')}</span>
              <strong className="db-money">{project.contractValue !== null ? formatRwf(project.contractValue) : t('accept.noValue')}</strong>
              <span className="db-moneybar" aria-hidden />
              <span className="jl-field__hint">{t('dash.moneyPlaceholder')}</span>
            </section>
          )}
          <section className="jl-card ac-value">
            <div className="db-row">
              <Text variant="sectionTitle" as="h2">
                {t('home.latestPhotos')}
              </Text>
              <Link to={`/projects/${project.id}/updates`}>{t('dash.seeAll')}</Link>
            </div>
            {photos.length === 0 ? (
              <span className="jl-field__hint">{t('dash.noPhotos')}</span>
            ) : (
              <div className="fd-photos">
                {photos.map((p, i) => (
                  <button key={p.id} type="button" className="fd-thumb db-thumb" onClick={() => setViewing(i)} aria-label={t('feed.openOriginal')}>
                    <img src={p.thumbUrl ?? ''} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <Lightbox photos={photos} index={viewing} onIndex={setViewing} />
    </div>
  );
}
