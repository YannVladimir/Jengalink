import type { ProjectSummary, WeeklyReportSummary, WeeklyReportView } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Button, StateView, Text } from '@jengalink/ui/web';
import { Check, FileText, Newspaper } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ReportBody } from '../components/ReportBody';
import { SharePanel } from '../components/SharePanel';
import { ApiError, api, request } from '../lib/api';
import { fromIsoDate } from '../lib/dates';
import { useAuth } from '../lib/auth-context';

const REPORTERS = ['contractor', 'supervisor', 'manager'];

/** Weekly reports (Phase 5): one tap freezes the week from records. */
export default function ReportsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<WeeklyReportSummary[] | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/reports', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
    ])
      .then(([l, p]) => {
        setList(l);
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
  if (!list || !project) return null;
  const reporter = project.myRoles.some((r) => REPORTERS.includes(r));
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));

  return (
    <div className="ws-page wz">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">{project.name}</p>
          <Text variant="screenTitle" as="h1">
            {t('report.list')}
          </Text>
        </div>
        {reporter && (
          <Button
            icon={Newspaper}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports', { params: { path: { id } }, body: {} })));
                navigate(`/projects/${id}/reports/${r.id}`);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
                setBusy(false);
              }
            }}
          >
            {t('report.generate')}
          </Button>
        )}
      </header>
      <p className="jl-field__hint">{t('report.oneTapHint')}</p>
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}
      {list.length === 0 && <Text muted>{t('report.empty')}</Text>}
      {list.length > 0 && (
        <ul className="iv-list jl-card">
          {list.map((r) => (
            <li key={r.id}>
              <Link to={`/projects/${id}/reports/${r.id}`}>
                <span className="iv-list__text">
                  <strong>{t('report.weekLine', { start: fmt(r.weekStart), end: fmt(r.weekEnd) })}</strong>
                  <small>
                    {t('report.generatedLine', { name: r.generatedByName ?? t('claims.someone'), date: formatDate(locale, r.generatedAt) })}
                    {r.revisionNo > 1 && ` · ${t('report.revisionTag', { n: r.revisionNo })}`}
                  </small>
                </span>
                <strong className="qt-amount">{r.acceptedPercent}%</strong>
                {r.acknowledgedAt ? <Check className="rp-ok" size={18} aria-label={t('report.acknowledge')} /> : <span className="qt-status">{t('report.notReviewed')}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One report, as on paper: ring, tower, money, the week, decisions, photos, what comes next. */
export function ReportPage() {
  const { id = '', reportId = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [r, setR] = useState<WeeklyReportView | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'ack' | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}/reports/{reportId}', { params: { path: { id, reportId } } })))
      .then(setR)
      .catch(() => setFailed(true));
  }, [id, reportId, withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!r) return null;
  const d = r.data;
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));

  return (
    <div className="ws-page">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">
            <Link to={`/projects/${id}/reports`}>{t('report.list')}</Link> · {d.projectName}
          </p>
          <Text variant="screenTitle" as="h1">
            {t('report.weekLine', { start: fmt(r.weekStart), end: fmt(r.weekEnd) })}
          </Text>
          <p className="ws-head__sub">
            {t('report.generatedLine', { name: r.generatedByName ?? t('claims.someone'), date: formatDate(locale, r.generatedAt) })}
            {r.revisionNo > 1 && ` · ${t('report.revisionTag', { n: r.revisionNo })}`}
          </p>
        </div>
        <span className="iv-share">
          <Button
            variant="secondary"
            icon={FileText}
            loading={busy === 'pdf'}
            onClick={async () => {
              setBusy('pdf');
              try {
                const link = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/pdf', { params: { path: { id, reportId } } })));
                window.open(link.url, '_blank', 'noopener');
              } finally {
                setBusy(null);
              }
            }}
          >
            {t('report.openPdf')}
          </Button>
          {r.canAcknowledge && (
            <Button
              icon={Check}
              loading={busy === 'ack'}
              onClick={async () => {
                setBusy('ack');
                try {
                  setR(await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/acknowledge', { params: { path: { id, reportId } } }))));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t('report.acknowledge')}
            </Button>
          )}
        </span>
      </header>
      {r.acknowledgedAt && <p className="rv-banner is-ok">{t('report.acknowledged', { name: r.acknowledgedByName ?? t('claims.someone'), date: formatDate(locale, r.acknowledgedAt) })}</p>}

      <ReportBody data={d} photos={r.photos} />
      {r.canShare && <SharePanel projectId={id} report={r} />}
    </div>
  );
}
