import {
  Button,
  Card,
  JengaTower,
  LastUpdated,
  Money,
  MoneyBar,
  ProgressRing,
  RingLegend,
  StatusBadge,
  Text,
} from '@jengalink/ui/web';
import { formatDuration, formatShortDate, formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { ringSentence } from '@jengalink/ui';
import { ArrowRight, CircleAlert } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { PhotoTile } from '../components/PhotoTile';
import { figures, project, webHref } from '../lib/demo';

/** Project overview (spec §4.4): what happened, what needs action, what to do next. */
export default function Overview() {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const navigate = useNavigate();
  const next = project.stages.find((s) => s.status !== 'accepted');

  return (
    <div className="ws-page">
      <header className="ws-head">
        <div>
          <Text variant="screenTitle" as="h1">
            {project.name}
          </Text>
          <p className="ws-head__sub">
            {project.location} · <LastUpdated at={project.updatedAt} />
          </p>
        </div>
      </header>

      {project.decisions.length > 0 && (
        <section className="ws-decisions" aria-labelledby="decisions-title">
          <div className="ws-decisions__head">
            <CircleAlert size={20} aria-hidden />
            <h2 id="decisions-title">
              {t('home.decisions', { count: project.decisions.length })}
            </h2>
          </div>
          <ul>
            {project.decisions.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.title}</strong>
                  <span>
                    {d.subtitle} · {t('common.waiting', { duration: formatDuration(t, d.waitingSince) })}
                  </span>
                </div>
                {d.amount != null && <Money amount={d.amount} />}
                <Button variant="secondary" onClick={() => navigate(webHref(d))}>
                  {t('home.review')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ws-kpis">
        <Kpi label={t('home.workAccepted')} value={`${figures.acceptedPct}%`} note={t('home.reportedNotAccepted', { percent: figures.reportedPct })} />
        <Kpi label={t('home.youOweNow')} value={<Money amount={figures.approvedUnpaid} variant="moneyLarge" />} note={t('home.approvedNotPaid')} />
        <Kpi label={t('home.waitingForDecision')} value={<Money amount={figures.awaitingDecision} variant="moneyLarge" />} note={t('home.decisions', { count: project.decisions.length })} />
        <Kpi label={t('home.nextStage')} value={next?.name ?? t('home.allDone')} note={next ? t('home.due', { date: formatShortDate(locale, next.currentEnd) }) : ''} small />
      </div>

      <div className="ws-grid">
        <Card title={t('home.progress')}>
          <div className="ws-progress">
            <ProgressRing accepted={figures.acceptedPct} reported={figures.reportedPct} />
            <div className="ws-progress__side">
              <RingLegend accepted={figures.acceptedPct} reported={figures.reportedPct} />
              <p className="jl-viz__caption">{ringSentence({ accepted: figures.acceptedPct, reported: figures.reportedPct }, lang)}</p>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <JengaTower stages={project.stages} width={420} onSelect={() => navigate('/updates')} />
          </div>
        </Card>

        <div className="ws-col">
          <Card title={t('home.money')} action={<Link to="/money" className="ws-link">{t('nav.money')} <ArrowRight size={14} aria-hidden /></Link>}>
            <MoneyBar contract={project.contractValue} paid={figures.paid} approvedUnpaid={figures.approvedUnpaid} />
          </Card>
          <Card title={t('home.latestUpdate')} action={<Link to="/updates" className="ws-link">{t('home.allUpdates')} <ArrowRight size={14} aria-hidden /></Link>}>
            <ul className="ws-feed">
              {project.updates.slice(0, 3).map((u) => (
                <li key={u.id}>
                  <PhotoTile photo={u.photos[0]} className="ws-feed__photo" />
                  <div>
                    <div className="ws-feed__meta">
                      <span>
                        {u.stageName} · {formatUpdatedAgo(t, locale, u.createdAt)}
                      </span>
                      <StatusBadge
                        status={u.status === 'accepted' ? 'paid' : u.status === 'problem' ? 'problem' : 'reported'}
                        label={t(u.status === 'accepted' ? 'status.accepted' : u.status === 'problem' ? 'status.blocker' : 'status.reported')}
                      />
                    </div>
                    <p>{u.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, small }: { label: string; value: React.ReactNode; note: string; small?: boolean }) {
  return (
    <div className="ws-kpi">
      <span className="ws-kpi__label">{label}</span>
      <span className={small ? 'ws-kpi__value ws-kpi__value--sm' : 'ws-kpi__value'}>{value}</span>
      <span className="ws-kpi__note">{note}</span>
    </div>
  );
}
