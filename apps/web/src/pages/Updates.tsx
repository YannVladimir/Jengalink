import { StatusBadge, Text } from '@jengalink/ui/web';
import { PhotoTile } from '../components/PhotoTile';
import { formatDate, formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { project } from '../lib/demo';

/** Photo timeline, newest first (Build Plan: Site photos). */
export default function UpdatesPage() {
  const { t, locale } = useI18n();
  return (
    <div className="ws-page ws-page--narrow">
      <header className="ws-head">
        <Text variant="screenTitle" as="h1">
          {t('updates.title')}
        </Text>
        <p className="ws-head__sub">{t('updates.lead')} · {project.name}</p>
      </header>
      <ol className="ws-timeline">
        {project.updates.map((u) => (
          <li key={u.id}>
            <div className="ws-timeline__meta">
              <span>{formatDate(locale, u.createdAt)}</span>
              <span className="jl-muted">{u.stageName}</span>
            </div>
            <article className="jl-card">
              <div className="ws-photos ws-photos--sm">
                {u.photos.map((p) => (
                  <PhotoTile key={p.id} photo={p} />
                ))}
              </div>
              <div className="ws-feed__meta">
                <span>
                  {t('updates.by', { author: u.author, when: formatUpdatedAgo(t, locale, u.createdAt) })}
                </span>
                <StatusBadge
                  status={u.status === 'accepted' ? 'paid' : u.status === 'problem' ? 'problem' : 'reported'}
                  label={t(u.status === 'accepted' ? 'status.accepted' : u.status === 'problem' ? 'status.blocker' : 'status.reported')}
                />
              </div>
              <p style={{ margin: '4px 0 0' }}>{u.note}</p>
              {u.blockers && <p className="ws-blocker">{t('updates.blocker', { text: u.blockers })}</p>}
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}
