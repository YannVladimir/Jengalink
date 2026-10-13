import type { ProjectOverview } from '@jengalink/contracts';
import { formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { ProgressRing, StateView, Text } from '@jengalink/ui/web';
import { Activity, Banknote, FileText, FolderPlus, HandCoins, Download, ListChecks, Newspaper, TriangleAlert, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { NextActionLink } from '../components/Dashboard';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

/**
 * Contractor multi-project list (Phase 3): every project with progress, blockers and the
 * one next action for your role. Projects needing something come first.
 */
export default function ProjectsPage() {
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<ProjectOverview[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/overview')))
      .then(setList)
      .catch(() => setFailed(true));
  }, [withRefresh]);

  return (
    <div className="ws-page pj">
      <header className="ws-head fd-head">
        <Text variant="screenTitle" as="h1">
          {t('plan.projectsTitle')}
        </Text>
        <Link className="jl-btn jl-btn--secondary" to="/projects/new">
          <FolderPlus size={18} aria-hidden /> {t('wizard.startProject')}
        </Link>
      </header>
      {failed ? (
        <StateView kind="error" title={t('common.somethingWrong')} />
      ) : !list ? null : (
        <ul className="pj-list">
          {list.map((p) => (
            <li key={p.id} className="jl-card pj-card">
              <div className="pj-card__top">
                <ProgressRing accepted={p.acceptedPercent} reported={p.reportedPercent} size={72} />
                <div className="pj-card__text">
                  <strong>{p.name}</strong>
                  <span>
                    <span className={`fd-status is-${p.status === 'active' ? 'accepted' : 'draft'}`}>{t(`dash.status_${p.status}`)}</span> {p.organizationName} ·{' '}
                    {t('dash.percentAccepted', { percent: p.acceptedPercent })}
                  </span>
                  <small>
                    {p.lastUpdateAt ? t('dash.lastUpdate', { when: formatUpdatedAgo(t, locale, p.lastUpdateAt) }) : t('dash.noUpdatesYet')}
                    {p.waitingReview > 0 ? ` · ${t('dash.waitingReview', { count: p.waitingReview })}` : ''}
                  </small>
                </div>
              </div>
              {p.blockers.length > 0 && (
                <ul className="db-blockers">
                  {p.blockers.map((b) => (
                    <li key={b.stageId}>
                      <TriangleAlert size={16} aria-hidden /> {b.stageName}: {b.text}
                    </li>
                  ))}
                </ul>
              )}
              <NextActionLink projectId={p.id} action={p.nextAction} />
              <div className="pj-card__links">
                <Link to={`/projects/${p.id}/updates`}>
                  <Activity size={16} aria-hidden /> {t('feed.activity')}
                </Link>
                {p.seesMoney && (
                  <Link to={`/projects/${p.id}/quotes`}>
                    <FileText size={16} aria-hidden /> {t('quote.title')}
                  </Link>
                )}
                {p.status === 'active' && p.seesMoney && (
                  <Link to={`/projects/${p.id}/claims`}>
                    <HandCoins size={16} aria-hidden /> {t('claims.title')}
                  </Link>
                )}
                {p.status === 'active' && p.seesMoney && (
                  <Link to={`/projects/${p.id}/spending`}>
                    <Wallet size={16} aria-hidden /> {t('spending.title')}
                  </Link>
                )}
                {p.status === 'active' && p.seesMoney && (
                  <Link to={`/projects/${p.id}/money`}>
                    <Wallet size={16} aria-hidden /> {t('money.title')}
                  </Link>
                )}
                {p.status === 'active' && p.seesMoney && (
                  <Link to={`/projects/${p.id}/payments`}>
                    <Banknote size={16} aria-hidden /> {t('payments.title')}
                  </Link>
                )}
                {p.status === 'active' && (
                  <Link to={`/projects/${p.id}/reports`}>
                    <Newspaper size={16} aria-hidden /> {t('report.list')}
                  </Link>
                )}
                <Link to={`/projects/${p.id}/exports`}>
                  <Download size={16} aria-hidden /> {t('exports.title')}
                </Link>
                <Link to={`/projects/${p.id}/plan`}>
                  <ListChecks size={16} aria-hidden /> {t('plan.planStages')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
