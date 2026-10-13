import { DECISION_LATE_DAYS, type DecisionInbox, daysWaiting, webPathOf } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

const SHOWN = 5;

/**
 * The decision inbox on Home (spec §4.2, §5): what waits on me across my projects, oldest first,
 * with how long the oldest has waited. One click opens the page where it is decided.
 */
export function DecisionInboxPanel({ inbox, now, multiProject }: { inbox: DecisionInbox; now: number; multiProject: boolean }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const oldest = inbox.oldestSince ? daysWaiting(inbox.oldestSince, now) : 0;
  const items = all ? inbox.items : inbox.items.slice(0, SHOWN);
  return (
    <section className="db-decisions di" aria-label={t('home.decisions', { count: inbox.count })}>
      <div className="di-head">
        <h2>{t('home.decisions', { count: inbox.count })}</h2>
        <span className={`di-oldest${oldest > DECISION_LATE_DAYS ? ' is-late' : ''}`}>{oldest < 1 ? t('inbox.oldestToday') : t('inbox.oldest', { count: oldest })}</span>
      </div>
      <ul>
        {items.map((d, i) => {
          const days = daysWaiting(d.since, now);
          return (
            <li key={`${d.kind}-${d.path}-${i}`}>
              <Link to={webPathOf(d.path)}>
                <span className="di-text">
                  <small>
                    {t(`inbox.kind_${d.kind}`)}
                    {multiProject ? ` · ${d.projectName}` : ''}
                  </small>
                  <strong>{d.title}</strong>
                </span>
                {d.amount !== null && <span className="di-amount">{formatRwf(d.amount)}</span>}
                <span className={`di-wait${days > DECISION_LATE_DAYS ? ' is-late' : ''}`}>{days < 1 ? t('inbox.waitingToday') : t('inbox.waiting', { count: days })}</span>
                <ChevronRight size={18} aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      {inbox.items.length > SHOWN && (
        <button type="button" className="di-more" onClick={() => setAll((x) => !x)}>
          {all ? t('inbox.showLess') : t('inbox.showAll', { count: inbox.count })}
        </button>
      )}
    </section>
  );
}
