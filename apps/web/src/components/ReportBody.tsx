import type { ReportPhoto, ShareSection, WeeklyReportData } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { Card, JengaTower, MoneyBar, ProgressRing } from '@jengalink/ui/web';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { fromIsoDate } from '../lib/dates';

/**
 * A weekly report's content: ring, tower, money, the week, photos, decisions, what comes next.
 * `sections` set = a shared copy: only those optional parts are drawn (progress and the tower always are).
 */
export function ReportBody({ data: d, photos, sections }: { data: WeeklyReportData; photos: ReportPhoto[]; sections?: readonly ShareSection[] }) {
  const { t, locale } = useI18n();
  const [now] = useState(() => Date.now());
  const show = (s: ShareSection) => !sections || sections.includes(s);
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const days = (since: string) => Math.floor((now - new Date(since).getTime()) / 86_400_000);

  return (
    <>
      <div className={`rp-grid${d.money ? '' : ' rp-grid--two'}`}>
        <Card title={t('report.progressTitle')}>
          <ProgressRing accepted={d.progress.accepted} reported={d.progress.reported} size={150} />
          <p className="rp-change">
            {d.progress.acceptedChange === null
              ? t('report.firstReport')
              : d.progress.acceptedChange > 0
                ? t('report.acceptedChange', { points: d.progress.acceptedChange })
                : t('report.acceptedSame')}
          </p>
        </Card>
        <Card title={t('report.towerTitle')}>
          <JengaTower stages={d.stages.map((s, i) => ({ id: String(i), name: s.name, status: s.status }))} width={300} />
        </Card>
        {d.money && (
          <Card title={t('report.moneyTitle')}>
            <MoneyBar contract={d.money.contract} paid={d.money.paid} approvedUnpaid={d.money.approvedUnpaid} />
            <p className="jl-field__hint">
              {t('money.waitingForDecision')}: {formatRwf(d.money.awaitingDecision)}
              {d.money.pendingVerification > 0 && ` · ${t('money.pendingVerification')}: ${formatRwf(d.money.pendingVerification)}`}
            </p>
          </Card>
        )}
      </div>

      {show('work') && (
        <Card title={t('report.thisWeek')}>
          {d.work.updates === 0 ? (
            <p className="jl-field__hint">{t('report.noWork')}</p>
          ) : (
            <>
              <p>
                <strong>{t('report.updatesLine', { updates: d.work.updates, photos: d.work.photos })}</strong>
              </p>
              {d.work.authors.length > 0 && <p className="jl-field__hint">{t('report.byLine', { names: d.work.authors.join(', ') })}</p>}
              {d.work.stagesWorked.length > 0 && <p className="jl-field__hint">{t('report.stagesWorked', { stages: d.work.stagesWorked.join(', ') })}</p>}
            </>
          )}
          {d.work.blockers.map((b) => (
            <p key={b.stage} className="rc-warn">
              <TriangleAlert size={16} aria-hidden /> {b.stage}: {b.text}
            </p>
          ))}
        </Card>
      )}

      {show('photos') && (
        <Card title={t('report.photosTitle')}>
          {photos.length === 0 ? (
            <p className="jl-field__hint">{t('report.noPhotos')}</p>
          ) : (
            <div className="rp-photos">
              {photos.map((p) => (
                <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noreferrer">
                  {p.thumbUrl && <img src={p.thumbUrl} alt="" />}
                  {p.takenAt && <small>{formatDate(locale, p.takenAt)}</small>}
                </a>
              ))}
            </div>
          )}
        </Card>
      )}

      {show('decisions') && (
        <Card title={t('report.decisionsTitle')}>
          {d.decisions.length === 0 ? (
            <p className="jl-field__hint">{t('report.noDecisions')}</p>
          ) : (
            <ul className="rp-decisions">
              {d.decisions.map((x, i) => (
                <li key={i}>
                  <span>
                    <strong>{t(`report.decision_${x.kind}`)}</strong> · {x.title}
                  </span>
                  {x.amount !== null && <span>{formatRwf(x.amount)}</span>}
                  <small>{days(x.since) < 1 ? t('report.waitingToday') : t('report.waitingDays', { days: days(x.since) })}</small>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {d.next.length > 0 && (
        <Card title={t('report.nextTitle')}>
          <ul className="rp-next">
            {d.next.map((n) => (
              <li key={n.stage}>{n.plannedStart ? t('report.nextLine', { stage: n.stage, date: fmt(n.plannedStart) }) : n.stage}</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
