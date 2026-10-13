// Shared geometry and wording for the infographics (Build Plan: Infographics).
// Web (SVG) and mobile (react-native-svg) draw from these, so they look identical,
// and every visual ships with its exact number and a one-line sentence.

import { createTranslator, formatShortDate, type Locale, type Translate } from '@jengalink/i18n';
import { formatRwf, percent } from './format';

/** Language for the sentences; defaults to English so plain calls still work. */
export interface Lang {
  t: Translate;
  locale: Locale;
}
const english: Lang = { t: createTranslator('en'), locale: 'en' };

/* ---------- Progress ring ---------- */

export interface RingInput {
  /** Accepted progress, 0–100. The big number shows this only. */
  accepted: number;
  /** Reported but not yet accepted, 0–100 (drawn light, after accepted). */
  reported: number;
}

export function ringGeometry({ accepted, reported }: RingInput, size: number, stroke: number) {
  const a = clamp(accepted, 0, 100);
  const r = clamp(reported, 0, 100 - a);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const len = (p: number) => (p / 100) * circumference;
  return {
    center: size / 2,
    radius,
    circumference,
    accepted: { dash: `${len(a)} ${circumference}`, offset: 0 },
    // Starts where accepted ends (rotate by the accepted arc).
    reported: { dash: `${len(r)} ${circumference}`, offset: -len(a) },
    acceptedPct: Math.round(a),
    reportedPct: Math.round(r),
  };
}

export function ringSentence({ accepted, reported }: RingInput, { t }: Lang = english): string {
  const a = Math.round(clamp(accepted, 0, 100));
  const r = Math.round(clamp(reported, 0, 100 - a));
  if (a >= 100) return t('charts.ringAll');
  const first = t('charts.ringAccepted', { accepted: a });
  return r > 0 ? `${first} ${t('charts.ringReported', { reported: r })}` : first;
}

/* ---------- Jenga tower (stages) ---------- */

export type StageStatus =
  | 'planned'
  | 'in_progress'
  | 'ready_for_review'
  | 'accepted'
  | 'blocked'
  | 'changes_required';

export interface StageBlockInput {
  id: string;
  name: string;
  status: StageStatus;
}

/** "In progress", "Ready for review"… in the given language. */
export const stageStatusLabel = (status: StageStatus, { t }: Lang = english) => t(`stage.${status}`);

export interface TowerBlock extends StageBlockInput {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

/**
 * Stacks stages bottom (first) to top (last), alternating a small offset like a
 * real Jenga tower. Returns blocks in stage order with SVG coordinates.
 */
export function towerLayout(
  stages: StageBlockInput[],
  width: number,
  blockHeight = 40,
  gap = 6,
  offset = 14,
) {
  const height = stages.length * blockHeight + Math.max(0, stages.length - 1) * gap;
  const blocks: TowerBlock[] = stages.map((s, i) => ({
    ...s,
    index: i,
    x: i % 2 === 0 ? 0 : offset,
    y: height - (i + 1) * blockHeight - i * gap,
    width: width - offset,
    height: blockHeight,
  }));
  return { width, height, blocks };
}

export function towerSentence(stages: StageBlockInput[], lang: Lang = english): string {
  const accepted = stages.filter((s) => s.status === 'accepted').length;
  const current = stages.find((s) => s.status !== 'accepted');
  const head = lang.t('charts.towerHead', { accepted, total: stages.length });
  if (!current) return `${head}.`;
  return `${head} · ${lang.t('charts.towerCurrent', { stage: current.name, status: stageStatusLabel(current.status, lang).toLowerCase() })}`;
}

/* ---------- Contract money bar ---------- */

export interface MoneyBarInput {
  /** Agreed contract value: the bar's total. Never mixed with contractor costs. */
  contract: number;
  paid: number;
  approvedUnpaid: number;
}

export function moneySegments({ contract, paid, approvedUnpaid }: MoneyBarInput, { t }: Lang = english) {
  const total = Math.max(contract, 0);
  const p = clamp(paid, 0, total);
  const a = clamp(approvedUnpaid, 0, total - p);
  const rest = total - p - a;
  const frac = (n: number) => (total ? n / total : 0);
  return [
    { key: 'paid', label: t('charts.moneyPaid'), amount: p, fraction: frac(p) },
    { key: 'approved', label: t('charts.moneyApproved'), amount: a, fraction: frac(a) },
    { key: 'remaining', label: t('charts.moneyRemaining'), amount: rest, fraction: frac(rest) },
  ] as const;
}

export function moneySentence(input: MoneyBarInput, lang: Lang = english): string {
  const [paid, approved] = moneySegments(input, lang);
  const head = lang.t('charts.moneySentence', {
    paid: formatRwf(paid.amount),
    contract: formatRwf(input.contract),
    percent: percent(paid.amount, input.contract),
  });
  return approved.amount > 0 ? `${head} ${lang.t('charts.moneyApprovedSentence', { approved: formatRwf(approved.amount) })}` : head;
}

/* ---------- Payment claim step tracker ---------- */

export interface ClaimInput {
  requestedAt: string;
  approvedAt?: string | null;
  paidAt?: string | null;
  /** The step a dispute is raised on shows a red flag. */
  disputedStep?: ClaimStepKey | null;
}

export type ClaimStepKey = 'requested' | 'approved' | 'paid';
export type ClaimStepState = 'done' | 'current' | 'upcoming' | 'disputed';

export function claimSteps(c: ClaimInput, { t, locale }: Lang = english) {
  const raw: { key: ClaimStepKey; label: string; at?: string | null }[] = [
    { key: 'requested', label: t('charts.claimRequested'), at: c.requestedAt },
    { key: 'approved', label: t('charts.claimApproved'), at: c.approvedAt },
    { key: 'paid', label: t('charts.claimPaid'), at: c.paidAt },
  ];
  const firstOpen = raw.findIndex((s) => !s.at);
  return raw.map((s, i) => ({
    ...s,
    date: s.at ? formatShortDate(locale, s.at) : null,
    state: (c.disputedStep === s.key
      ? 'disputed'
      : s.at
        ? 'done'
        : i === firstOpen
          ? 'current'
          : 'upcoming') as ClaimStepState,
  }));
}

export function claimSentence(c: ClaimInput, { t, locale }: Lang = english): string {
  if (c.disputedStep) return t('charts.claimDisputed', { step: t(`charts.claim${c.disputedStep[0].toUpperCase()}${c.disputedStep.slice(1)}` as 'charts.claimRequested') });
  if (c.paidAt) return t('charts.claimPaidOn', { date: formatShortDate(locale, c.paidAt) });
  if (c.approvedAt) return t('charts.claimApprovedOn', { date: formatShortDate(locale, c.approvedAt) });
  return t('charts.claimRequestedOn', { date: formatShortDate(locale, c.requestedAt) });
}

/* ---------- Site float wallet ---------- */

export interface WalletInput {
  expected: number;
  counted: number;
}

/** A difference is "to explain", never "lost" (Build Plan). */
export function walletSummary({ expected, counted }: WalletInput, { t }: Lang = english) {
  const difference = counted - expected;
  return {
    difference,
    balanced: difference === 0,
    sentence:
      difference === 0
        ? t('charts.walletMatches')
        : t(difference < 0 ? 'charts.walletLess' : 'charts.walletMore', { amount: formatRwf(Math.abs(difference)) }),
  };
}

/* ---------- helpers ---------- */

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
