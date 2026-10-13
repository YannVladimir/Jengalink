import { type CreatedReportShare, type ReportShareView, SHARE_EXPIRY_DAYS, SHARE_SECTIONS, type ShareSection, type SharedReportView, type WeeklyReportView } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Button, Card } from '@jengalink/ui/web';
import { Copy, Eye, Link2, MessageCircle, Share2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { fromIsoDate } from '../lib/dates';
import { ReportBody } from './ReportBody';

type Days = (typeof SHARE_EXPIRY_DAYS)[number];

/** Share a report outside the project (spec §26.5): pick sections and expiry, preview, then send the link. */
export function SharePanel({ projectId, report }: { projectId: string; report: WeeklyReportView }) {
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<ShareSection[]>(['work', 'photos', 'next']);
  const [days, setDays] = useState<Days>(7);
  const [allowDownload, setAllowDownload] = useState(false);
  const [preview, setPreview] = useState<SharedReportView | null>(null);
  const [made, setMade] = useState<CreatedReportShare | null>(null);
  const [links, setLinks] = useState<ReportShareView[]>([]);
  const [busy, setBusy] = useState<'preview' | 'create' | string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = { id: projectId, reportId: report.id };
  // Money can only be shared by someone who sees it (the API refuses it otherwise).
  const choices = SHARE_SECTIONS.filter((s) => s !== 'money' || report.data.money);
  const body = { sections, expiresInDays: days, allowDownload };

  const loadLinks = () => withRefresh(() => request(() => api.GET('/v1/projects/{id}/reports/{reportId}/shares', { params: { path } }))).then(setLinks);
  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };
  const changed = () => {
    setPreview(null);
    setMade(null);
  };
  const message = made
    ? t('share.message', {
        project: report.data.projectName,
        week: t('report.weekLine', { start: formatDate(locale, fromIsoDate(report.weekStart)), end: formatDate(locale, fromIsoDate(report.weekEnd)) }),
        url: made.url,
      })
    : '';

  if (!open)
    return (
      <Card title={t('share.title')}>
        <p className="jl-field__hint">{t('share.hint')}</p>
        <Button
          variant="secondary"
          icon={Share2}
          onClick={() => {
            setOpen(true);
            void loadLinks().catch(() => undefined);
          }}
        >
          {t('share.button')}
        </Button>
      </Card>
    );

  return (
    <Card title={t('share.title')}>
      <div className="sh-form">
        <p className="jl-field__hint">{t('share.hint')}</p>
        <fieldset className="sh-sections">
          <legend className="jl-field__label">{t('share.whatToShare')}</legend>
          <p className="jl-field__hint">{t('share.always')}</p>
          {choices.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={sections.includes(s)}
                onChange={() => {
                  setSections((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
                  changed();
                }}
              />
              {t(`share.section_${s}`)}
            </label>
          ))}
          {sections.length === 0 && <p className="jl-field__hint">{t('share.pickOne')}</p>}
        </fieldset>
        <fieldset className="up-chips">
          <legend className="jl-field__label">{t('share.expiryTitle')}</legend>
          {SHARE_EXPIRY_DAYS.map((d) => (
            <label key={d} className={d === days ? 'is-on' : undefined}>
              <input
                type="radio"
                name="share-days"
                checked={d === days}
                onChange={() => {
                  setDays(d);
                  changed();
                }}
              />
              {t(`share.expiry_${d}`)}
            </label>
          ))}
        </fieldset>
        <label className="sh-check">
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => {
              setAllowDownload(e.target.checked);
              changed();
            }}
          />
          {t('share.allowDownload')}
        </label>
        <p className="sh-never">{t('share.neverShown')}</p>
        <span className="iv-share">
          <Button
            variant="secondary"
            icon={Eye}
            loading={busy === 'preview'}
            onClick={() => run('preview', async () => setPreview(await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/shares/preview', { params: { path }, body })))))}
          >
            {t('share.preview')}
          </Button>
          <Button
            icon={Link2}
            loading={busy === 'create'}
            onClick={() =>
              run('create', async () => {
                setMade(await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/shares', { params: { path }, body }))));
                setCopied(false);
                await loadLinks();
              })
            }
          >
            {t('share.createLink')}
          </Button>
        </span>
        {error && (
          <p className="jl-field__error" role="alert">
            {error}
          </p>
        )}

        {made && (
          <div className="sh-made">
            <p className="rv-banner is-ok">{t('share.linkReady', { date: formatDate(locale, made.expiresAt) })}</p>
            <span className="si-input">
              <input readOnly value={made.url} aria-label={t('share.copy')} onFocus={(e) => e.target.select()} />
            </span>
            <span className="iv-share">
              {typeof navigator.share === 'function' && (
                <Button icon={Share2} onClick={() => void navigator.share({ text: message }).catch(() => undefined)}>
                  {t('share.shareVia')}
                </Button>
              )}
              <a className="jl-btn jl-btn--secondary sh-wa" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                <MessageCircle size={18} aria-hidden /> {t('share.whatsapp')}
              </a>
              <Button
                variant="secondary"
                icon={Copy}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(message)
                    .then(() => setCopied(true))
                    .catch(() => undefined)
                }
              >
                {copied ? t('share.copied') : t('share.copy')}
              </Button>
            </span>
          </div>
        )}

        {preview && (
          <section className="sh-preview" aria-label={t('share.previewTitle')}>
            <p className="rv-banner is-info">{t('share.previewBanner')}</p>
            <SharedHeader view={preview} />
            <ReportBody data={preview.data} photos={preview.photos} sections={preview.sections} />
          </section>
        )}

        <h3 className="sh-links-title">{t('share.linksTitle')}</h3>
        {links.length === 0 ? (
          <p className="jl-field__hint">{t('share.noLinks')}</p>
        ) : (
          <ul className="sh-links">
            {links.map((l) => (
              <li key={l.id}>
                <span>
                  <strong>{l.sections.length ? l.sections.map((s) => t(`share.section_${s}`)).join(' · ') : t('report.progressTitle')}</strong>
                  <small>
                    {t('share.linkLine', { name: l.createdByName ?? t('claims.someone'), date: formatDate(locale, l.createdAt), until: formatDate(locale, l.expiresAt) })} ·{' '}
                    {t('share.opens', { count: l.viewCount })}
                  </small>
                </span>
                <span className={`qt-status sh-status--${l.status}`}>{t(`share.status_${l.status}`)}</span>
                {l.canRevoke && (
                  <Button
                    variant="secondary"
                    loading={busy === l.id}
                    onClick={() => {
                      if (!window.confirm(t('share.revokeConfirm'))) return;
                      void run(l.id, async () => {
                        const v = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/shares/{shareId}/revoke', { params: { path: { ...path, shareId: l.id } } })));
                        setLinks((x) => x.map((y) => (y.id === v.id ? v : y)));
                      });
                    }}
                  >
                    {t('share.revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** The top of a shared report: project, district, week, who shared it. */
export function SharedHeader({ view }: { view: SharedReportView }) {
  const { t, locale } = useI18n();
  const d = view.data;
  return (
    <header className="sh-head">
      <p className="ws-head__sub">{[d.projectName, d.place].filter(Boolean).join(' · ')}</p>
      <h2 className="sh-week">{t('report.weekLine', { start: formatDate(locale, fromIsoDate(view.weekStart)), end: formatDate(locale, fromIsoDate(view.weekEnd)) })}</h2>
      <p className="ws-head__sub">{t('share.sharedBy', { name: view.sharedByName ?? t('claims.someone'), org: d.organizationName })}</p>
    </header>
  );
}
