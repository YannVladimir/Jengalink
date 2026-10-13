import { type NextAction, type ProjectProgress, QUIET_DAYS } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { JengaTower, ProgressRing, RingLegend, Text } from '@jengalink/ui/web';
import { ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

/** Progress ring + Jenga tower from real stages; a block opens that stage's timeline. */
export function ProgressPanel({ projectId, progress }: { projectId: string; progress: ProjectProgress }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const blocks = progress.stages.map((s) => ({ id: s.id, name: s.name, status: s.displayStatus }));
  return (
    <section className="jl-card db-progress">
      <Text variant="sectionTitle" as="h2">
        {t('home.progress')}
      </Text>
      <div className="db-progress__body">
        <ProgressRing accepted={progress.acceptedPercent} reported={progress.reportedPercent} size={168} />
        <JengaTower stages={blocks} width={320} onSelect={(stageId) => navigate(`/projects/${projectId}/stages/${stageId}`)} />
      </div>
      <RingLegend accepted={progress.acceptedPercent} reported={progress.reportedPercent} />
    </section>
  );
}

function nextActionHref(projectId: string, a: NextAction): string | null {
  switch (a.kind) {
    case 'review_stage':
    case 'fix_changes':
    case 'clear_blocker':
      return a.stageId ? `/projects/${projectId}/stages/${a.stageId}` : null;
    case 'accept_project':
      return `/projects/${projectId}/accept`;
    case 'invite_owner':
      return `/projects/${projectId}/invite`;
    case 'plan_project':
    case 'await_owner':
      return `/projects/${projectId}/plan`;
    case 'post_update':
      return `/projects/${projectId}/updates/new`;
    default:
      return null;
  }
}

/** The one next step for this person on this project. */
export function NextActionLink({ projectId, action }: { projectId: string; action: NextAction }) {
  const { t } = useI18n();
  const text = t(`dash.next_${action.kind}`, { stage: action.stageName ?? '', days: QUIET_DAYS });
  const href = nextActionHref(projectId, action);
  if (!href) return <span className="jl-field__hint">{text}</span>;
  const tone = action.kind === 'clear_blocker' || action.kind === 'fix_changes' ? 'is-problem' : action.kind === 'review_stage' || action.kind === 'accept_project' ? 'is-urgent' : '';
  return (
    <Link className={`db-next ${tone}`} to={href}>
      <span>
        <small>{t('dash.nextAction')}</small>
        {text}
      </span>
      <ChevronRight size={18} aria-hidden />
    </Link>
  );
}
