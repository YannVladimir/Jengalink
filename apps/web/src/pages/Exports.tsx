import type { ExportFormat, ExportKind, ExportList, ProjectSummary } from '@jengalink/contracts';
import { formatDateTime } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Button, Card, StateView, Text } from '@jengalink/ui/web';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const KINDS: ExportKind[] = ['project_summary', 'money_history'];

/** Exports (spec §12): ask, the file is made in the background, then download it (only you can). */
export default function ExportsPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<ExportList | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => withRefresh(() => request(() => api.GET('/v1/projects/{id}/exports', { params: { path: { id } } }))).then(setList), [id, withRefresh]);
  useEffect(() => {
    void Promise.all([load(), withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))).then(setProject)]).catch(() => setFailed(true));
  }, [id, load, withRefresh]);
  // While something is being made, look again every 2 seconds.
  const making = list?.items.some((x) => x.status === 'queued');
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => void load().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [making, load]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!list || !project) return null;

  const ask = async (kind: ExportKind, format: ExportFormat) => {
    setBusy(`${kind}-${format}`);
    setError(null);
    try {
      await withRefresh(() => request(() => api.POST('/v1/projects/{id}/exports', { params: { path: { id } }, body: { kind, format } })));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };
  const download = async (exportId: string) => {
    setBusy(exportId);
    setError(null);
    try {
      const link = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/exports/{exportId}/download', { params: { path: { id, exportId } } })));
      window.open(link.url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ws-page">
      <header className="ws-head fd-head">
        <div>
          <p className="ws-head__sub">{project.name}</p>
          <Text variant="screenTitle" as="h1">
            {t('exports.title')}
          </Text>
        </div>
      </header>
      <p className="jl-field__hint">{t('exports.hint')}</p>
      <div className="ex-kinds">
        {KINDS.filter((k) => k === 'project_summary' || list.canExportMoney).map((k) => (
          <Card key={k} title={t(`exports.kind_${k}`)}>
            <p className="jl-field__hint">{t(`exports.kindHint_${k}`)}</p>
            {k === 'project_summary' && !list.canExportMoney && <p className="jl-field__hint">{t('exports.noMoney')}</p>}
            <span className="iv-share">
              <Button variant="secondary" icon={FileText} loading={busy === `${k}-pdf`} onClick={() => void ask(k, 'pdf')}>
                PDF
              </Button>
              <Button variant="secondary" icon={FileSpreadsheet} loading={busy === `${k}-csv`} onClick={() => void ask(k, 'csv')}>
                CSV
              </Button>
            </span>
          </Card>
        ))}
      </div>
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}
      {list.items.length === 0 ? (
        <Text muted>{t('exports.empty')}</Text>
      ) : (
        <ul className="ex-list jl-card">
          {list.items.map((x) => (
            <li key={x.id}>
              <span className="ex-text">
                <strong>
                  {t(`exports.kind_${x.kind}`)} · {x.format.toUpperCase()}
                </strong>
                <small>{t('exports.madeOn', { date: formatDateTime(locale, x.createdAt) })}</small>
              </span>
              <span className={`qt-status ex-status--${x.status}`}>{t(`exports.status_${x.status}`)}</span>
              {x.status === 'ready' && (
                <Button icon={Download} loading={busy === x.id} onClick={() => void download(x.id)}>
                  {t('exports.download')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
