import { Check, CircleCheck, Flag, TriangleAlert, Wallet } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useI18n } from '@jengalink/i18n/react';
import {
  claimSentence,
  claimSteps,
  moneySegments,
  moneySentence,
  ringGeometry,
  ringSentence,
  stageStatusLabel,
  towerLayout,
  towerSentence,
  walletSummary,
  type ClaimInput,
  type MoneyBarInput,
  type RingInput,
  type StageBlockInput,
  type StageStatus,
  type WalletInput,
} from '../charts';
import { groupDigits } from '../format';

/* Each visual: picture first, exact number beside it, one plain sentence. */

function Caption({ children }: { children: ReactNode }) {
  return <p className="jl-viz__caption">{children}</p>;
}

/** Diagonal stripes: "reported, not yet accepted" reads without colour. */
function Hatch({
  id,
  color,
  background,
  lineOpacity = 1,
  size = 6,
}: {
  id: string;
  color: string;
  background?: string;
  lineOpacity?: number;
  size?: number;
}) {
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      {background ? (
        <rect width={size} height={size} fill={background} />
      ) : (
        <rect width={size} height={size} fill={color} opacity="0.28" />
      )}
      <line x1="0" y1="0" x2="0" y2={size} stroke={color} strokeWidth="2.5" opacity={lineOpacity} />
    </pattern>
  );
}

/* ---------- Progress ring ---------- */

export function ProgressRing({
  accepted,
  reported,
  size = 168,
  label,
}: RingInput & { size?: number; label?: string }) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const stroke = Math.round(size * 0.1);
  const g = ringGeometry({ accepted, reported }, size, stroke);
  const hatch = useId();
  return (
    <figure className="jl-viz jl-ring" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ringSentence({ accepted, reported }, lang)}>
        <defs>
          <Hatch id={hatch} color="var(--jl-accent)" />
        </defs>
        <g transform={`rotate(-90 ${g.center} ${g.center})`} fill="none" strokeWidth={stroke}>
          <circle cx={g.center} cy={g.center} r={g.radius} stroke="var(--jl-surface-sunken)" />
          {g.reportedPct > 0 && (
            <circle
              cx={g.center}
              cy={g.center}
              r={g.radius}
              stroke={`url(#${hatch})`}
              strokeDasharray={g.reported.dash}
              strokeDashoffset={g.reported.offset}
            />
          )}
          {g.acceptedPct > 0 && (
            <circle
              cx={g.center}
              cy={g.center}
              r={g.radius}
              stroke="var(--jl-accent)"
              strokeLinecap={g.acceptedPct < 100 ? 'round' : 'butt'}
              strokeDasharray={g.accepted.dash}
            />
          )}
        </g>
      </svg>
      <div className="jl-ring__center" aria-hidden>
        {/* Small rings (lists) show just the number, sized to fit inside. */}
        <span className={size < 100 ? 'jl-text-body-strong' : 'jl-text-display'}>{g.acceptedPct}%</span>
        {size >= 100 && <span className="jl-ring__label">{label ?? t('charts.accepted')}</span>}
      </div>
    </figure>
  );
}

export function RingLegend({ accepted, reported }: RingInput) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const hatch = useId();
  return (
    <div className="jl-legend">
      <span>
        <i style={{ background: 'var(--jl-accent)' }} /> {t('charts.legendAccepted')} <b>{Math.round(accepted)}%</b>
      </span>
      <span>
        <svg width="12" height="12" aria-hidden>
          <defs>
            <Hatch id={hatch} color="var(--jl-accent)" />
          </defs>
          <rect width="12" height="12" rx="3" fill={`url(#${hatch})`} />
        </svg>
        {t('charts.legendReported')} <b>{Math.round(reported)}%</b>
      </span>
    </div>
  );
}

/* ---------- Jenga tower ---------- */

const towerLook = (s: StageStatus) => {
  switch (s) {
    case 'accepted':
      return { fill: 'var(--jl-primary)', stroke: 'var(--jl-primary)', ink: 'var(--jl-on-primary)', dash: undefined };
    case 'ready_for_review':
      return { fill: 'hatch', stroke: 'var(--jl-accent)', ink: 'var(--jl-ink)', dash: undefined };
    case 'in_progress':
      return { fill: 'var(--jl-primary-soft)', stroke: 'var(--jl-accent)', ink: 'var(--jl-ink)', dash: '6 4' };
    case 'blocked':
    case 'changes_required':
      return { fill: 'var(--jl-status-problem-soft)', stroke: 'var(--jl-status-problem)', ink: 'var(--jl-status-problem)', dash: undefined };
    default:
      return { fill: 'var(--jl-surface-sunken)', stroke: 'var(--jl-border-strong)', ink: 'var(--jl-ink-muted)', dash: '4 4' };
  }
};

/** The brand's signature visual: one block per stage, bottom to top. Tap a block to open it. */
export function JengaTower({
  stages,
  width = 340,
  onSelect,
}: {
  stages: StageBlockInput[];
  width?: number;
  onSelect?: (stageId: string) => void;
}) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const layout = towerLayout(stages, width, 44, 6, 16);
  const hatch = useId();
  return (
    <figure className="jl-viz jl-tower" style={{ maxWidth: width }}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width="100%"
        role="group"
        aria-label={towerSentence(stages, lang)}
      >
        <defs>
          <Hatch id={hatch} color="var(--jl-accent)" background="var(--jl-primary-soft)" lineOpacity={0.3} size={10} />
        </defs>
        {layout.blocks.map((b) => {
          const look = towerLook(b.status);
          const problem = b.status === 'blocked' || b.status === 'changes_required';
          return (
            <g
              key={b.id}
              className={onSelect ? 'jl-tower__block is-tappable' : 'jl-tower__block'}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={`Stage ${b.index + 1}, ${b.name}: ${stageStatusLabel(b.status, lang)}`}
              onClick={onSelect ? () => onSelect(b.id) : undefined}
              onKeyDown={
                onSelect
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(b.id);
                      }
                    }
                  : undefined
              }
            >
              <rect
                x={b.x + 1}
                y={b.y + 1}
                width={b.width - 2}
                height={b.height - 2}
                rx="9"
                fill={look.fill === 'hatch' ? `url(#${hatch})` : look.fill}
                stroke={look.stroke}
                strokeWidth="1.5"
                strokeDasharray={look.dash}
              />
              <text x={b.x + 16} y={b.y + b.height / 2 + 5} className="jl-tower__name" fill={look.ink}>
                {b.name}
              </text>
              <text
                x={b.x + b.width - 14}
                y={b.y + b.height / 2 + 4}
                textAnchor="end"
                className="jl-tower__status"
                fill={look.ink}
              >
                {b.status === 'accepted' ? '✓ ' : problem ? '! ' : ''}
                {stageStatusLabel(b.status, lang)}
              </text>
            </g>
          );
        })}
      </svg>
      <Caption>{towerSentence(stages, lang)}</Caption>
    </figure>
  );
}

/* ---------- Contract money bar ---------- */

export function MoneyBar(input: MoneyBarInput) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const segments = moneySegments(input, lang);
  const hatch = useId();
  const fills = {
    paid: 'var(--jl-status-paid)',
    approved: 'var(--jl-status-approved)',
    remaining: `url(#${hatch})`,
  } as const;
  let x = 0;
  return (
    <figure className="jl-viz jl-moneybar">
      <svg width="100%" height="20" role="img" aria-label={moneySentence(input, lang)} preserveAspectRatio="none" viewBox="0 0 100 20">
        <defs>
          <pattern id={hatch} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="var(--jl-surface-sunken)" />
          </pattern>
          <clipPath id={`${hatch}-clip`}>
            <rect width="100" height="20" rx="4" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${hatch}-clip)`}>
          {segments.map((s) => {
            const w = s.fraction * 100;
            const el = <rect key={s.key} x={x} width={w} height="20" fill={fills[s.key]} />;
            x += w;
            return el;
          })}
        </g>
      </svg>
      <dl className="jl-moneybar__legend">
        {segments.map((s) => (
          <div key={s.key}>
            <dt>
              <i className={`jl-swatch jl-swatch--${s.key}`} /> {s.label}
            </dt>
            <dd className="jl-money">
              <span className="jl-money__cur">RWF</span>
              {groupDigits(s.amount)}
            </dd>
          </div>
        ))}
      </dl>
      <Caption>{moneySentence(input, lang)}</Caption>
    </figure>
  );
}

/* ---------- Payment claim step tracker ---------- */

export function ClaimTracker(claim: ClaimInput) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const steps = claimSteps(claim, lang);
  return (
    <figure className="jl-viz">
      <ol className="jl-steps" aria-label={claimSentence(claim, lang)}>
        {steps.map((s, i) => (
          <li key={s.key} className={`jl-step jl-step--${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            {i > 0 && <span className="jl-step__line" aria-hidden />}
            <span className="jl-step__dot" aria-hidden>
              {s.state === 'done' && <Check size={16} strokeWidth={3} />}
              {s.state === 'disputed' && <Flag size={14} strokeWidth={2.5} />}
            </span>
            <span className="jl-step__label">{s.label}</span>
            <span className="jl-step__date">{s.state === 'disputed' ? t('status.disputed') : (s.date ?? '—')}</span>
          </li>
        ))}
      </ol>
      <Caption>{claimSentence(claim, lang)}</Caption>
    </figure>
  );
}

/* ---------- Site float wallet card ---------- */

export function WalletCard({ expected, counted, custodian }: WalletInput & { custodian?: string }) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const w = walletSummary({ expected, counted }, lang);
  return (
    <figure className="jl-viz jl-wallet">
      <div className="jl-wallet__head">
        <span className="jl-wallet__icon" aria-hidden>
          <Wallet size={20} />
        </span>
        <div>
          <strong className="jl-text-body-strong">{t('charts.walletTitle')}</strong>
          {custodian && <span className="jl-wallet__who">{t('charts.walletHeldBy', { name: custodian })}</span>}
        </div>
      </div>
      <dl className="jl-wallet__rows">
        <div>
          <dt>{t('charts.walletExpected')}</dt>
          <dd className="jl-money">
            <span className="jl-money__cur">RWF</span>
            {groupDigits(expected)}
          </dd>
        </div>
        <div>
          <dt>{t('charts.walletCounted')}</dt>
          <dd className="jl-money">
            <span className="jl-money__cur">RWF</span>
            {groupDigits(counted)}
          </dd>
        </div>
        <div className={w.balanced ? 'is-ok' : 'is-explain'}>
          <dt>
            {w.balanced ? <CircleCheck size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
            {w.balanced ? t('charts.walletDifference') : t('charts.walletToExplain')}
          </dt>
          <dd className="jl-money">
            <span className="jl-money__cur">RWF</span>
            {w.difference < 0 ? '−' : w.difference > 0 ? '+' : ''}
            {groupDigits(Math.abs(w.difference))}
          </dd>
        </div>
      </dl>
      <Caption>{w.sentence}</Caption>
    </figure>
  );
}
