import type { SharedReportView } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Button, StateView } from '@jengalink/ui/web';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ReportBody } from '../components/ReportBody';
import { LanguageSelect } from '../components/LanguageSelect';
import { SharedHeader } from '../components/SharePanel';
import { ApiError, api, request } from '../lib/api';

/** A shared weekly report (spec §26.5): no account needed; the link's scope and expiry are checked by the API. */
export default function SharedReportPage() {
  const { token = '' } = useParams();
  const { t, locale } = useI18n();
  const [view, setView] = useState<SharedReportView | null>(null);
  const [failure, setFailure] = useState<'gone' | 'missing' | 'error' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void request(() => api.GET('/v1/shared/reports/{token}', { params: { path: { token } } }))
      .then(setView)
      .catch((err) => setFailure(err instanceof ApiError ? (err.status === 410 ? 'gone' : err.status === 404 ? 'missing' : 'error') : 'error'));
  }, [token]);

  return (
    <div className="sh-page">
      <header className="sh-bar">
        <span className="sh-brand">
          <svg width="26" height="22" viewBox="0 0 26 22" aria-hidden>
            <rect width="26" height="6" rx="2" fill="currentColor" />
            <rect y="8" width="26" height="6" rx="2" fill="currentColor" opacity="0.7" />
            <rect x="5" y="16" width="21" height="6" rx="2" fill="#F97316" />
          </svg>
          JengaLink
        </span>
        <LanguageSelect />
      </header>
      <main className="ws-page">
        {failure === 'gone' && <StateView kind="error" title={t('share.goneTitle')} message={t('share.goneBody')} />}
        {failure === 'missing' && <StateView kind="error" title={t('share.notFoundTitle')} />}
        {failure === 'error' && <StateView kind="error" title={t('common.somethingWrong')} />}
        {view && (
          <>
            <div className="sh-top">
              <SharedHeader view={view} />
              {view.allowDownload && (
                <Button
                  variant="secondary"
                  icon={FileText}
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const link = await request(() => api.POST('/v1/shared/reports/{token}/pdf', { params: { path: { token }, query: { lang: locale } } }));
                      window.open(link.url, '_blank', 'noopener');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('share.downloadPdf')}
                </Button>
              )}
            </div>
            <ReportBody data={view.data} photos={view.photos} sections={view.sections} />
            <p className="sh-footer">{t('share.sharedFooter', { date: formatDate(locale, view.expiresAt) })}</p>
          </>
        )}
      </main>
    </div>
  );
}
