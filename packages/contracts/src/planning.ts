// Project types, stage templates and stage contracts (spec §5.1–5.3, §19.2).
import { z } from 'zod';

export const ProjectType = z.enum(['house', 'renovation', 'apartment', 'commercial', 'civil']).meta({ id: 'ProjectType' });
export type ProjectType = z.infer<typeof ProjectType>;

/** Stage names are translated in the apps (`stageTemplate.<key>`); the chosen name is saved as text. */
export type StageTemplateKey =
  | 'sitePrep'
  | 'foundation'
  | 'walls'
  | 'roof'
  | 'openings'
  | 'services'
  | 'finishes'
  | 'painting'
  | 'assessment'
  | 'repairs'
  | 'cleaning'
  | 'structure'
  | 'external'
  | 'envelope'
  | 'fitOut'
  | 'survey'
  | 'earthworks'
  | 'drainage'
  | 'paving'
  | 'handover';

/**
 * Editable starting points, not engineering instructions (spec §5.2).
 * Weights are each stage's share of the whole job and total 100.
 */
export const stageTemplates: Record<ProjectType, { key: StageTemplateKey; weight: number }[]> = {
  house: [
    { key: 'sitePrep', weight: 5 },
    { key: 'foundation', weight: 15 },
    { key: 'walls', weight: 20 },
    { key: 'roof', weight: 15 },
    { key: 'openings', weight: 10 },
    { key: 'services', weight: 10 },
    { key: 'finishes', weight: 15 },
    { key: 'painting', weight: 10 },
  ],
  renovation: [
    { key: 'assessment', weight: 15 },
    { key: 'repairs', weight: 20 },
    { key: 'services', weight: 20 },
    { key: 'finishes', weight: 30 },
    { key: 'cleaning', weight: 15 },
  ],
  apartment: [
    { key: 'sitePrep', weight: 5 },
    { key: 'foundation', weight: 15 },
    { key: 'structure', weight: 30 },
    { key: 'roof', weight: 5 },
    { key: 'walls', weight: 15 },
    { key: 'services', weight: 15 },
    { key: 'finishes', weight: 10 },
    { key: 'external', weight: 5 },
  ],
  commercial: [
    { key: 'sitePrep', weight: 5 },
    { key: 'foundation', weight: 15 },
    { key: 'structure', weight: 25 },
    { key: 'roof', weight: 10 },
    { key: 'envelope', weight: 10 },
    { key: 'services', weight: 15 },
    { key: 'fitOut', weight: 15 },
    { key: 'handover', weight: 5 },
  ],
  civil: [
    { key: 'survey', weight: 10 },
    { key: 'earthworks', weight: 25 },
    { key: 'drainage', weight: 20 },
    { key: 'paving', weight: 35 },
    { key: 'handover', weight: 10 },
  ],
};

/**
 * Scales weights so they total exactly 100, keeping their proportions
 * (largest remainder). Used when a stage is removed from a template.
 */
export function rebalanceWeights(weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return rebalanceWeights(weights.map(() => 1));
  const exact = weights.map((w) => (w * 100) / sum);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((s, w) => s + w, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    out[i] += 1;
  }
  return out;
}

export const MAX_STAGES = 30;

export const StageDraft = z
  .object({
    name: z.string().trim().min(2).max(80),
    weight: z.number().int().min(0).max(100),
  })
  .meta({ id: 'StageDraft' });
export type StageDraft = z.infer<typeof StageDraft>;

/** 1–30 stages whose weights total 100. */
export const StageDrafts = z
  .array(StageDraft)
  .min(1)
  .max(MAX_STAGES)
  .refine((s) => s.reduce((sum, x) => sum + x.weight, 0) === 100, { message: 'Stage weights must total 100' });

export const ProjectStageStatus = z.enum(['not_started', 'in_progress', 'ready_for_review', 'accepted', 'changes_required']);
export type ProjectStageStatus = z.infer<typeof ProjectStageStatus>;

export const ProjectStage = z
  .object({
    id: z.uuid(),
    name: z.string(),
    position: z.number().int(),
    weight: z.number().int(),
    status: ProjectStageStatus,
    description: z.string().nullable(),
    plannedStart: z.iso.date().nullable(),
    plannedEnd: z.iso.date().nullable(),
    /** Measurable checks the owner uses to accept the stage. */
    criteria: z.array(z.string()),
  })
  .meta({ id: 'ProjectStage' });
export type ProjectStage = z.infer<typeof ProjectStage>;

export const MAX_CRITERIA = 10;

/** One stage in the plan editor. Stages without `id` are new; stages left out are removed. */
export const StagePlanItem = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2).max(80),
    weight: z.number().int().min(0).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    plannedStart: z.iso.date().nullable().optional(),
    plannedEnd: z.iso.date().nullable().optional(),
    criteria: z.array(z.string().trim().min(3).max(160)).max(MAX_CRITERIA).default([]),
  })
  .refine((s) => !s.plannedStart || !s.plannedEnd || s.plannedEnd >= s.plannedStart, {
    message: 'The end date must be on or after the start date',
    path: ['plannedEnd'],
  })
  .meta({ id: 'StagePlanItem' });
export type StagePlanItem = z.input<typeof StagePlanItem>;

/** One owner decision on the baseline (contract value + stage plan). */
export const AcceptanceRecord = z
  .object({
    id: z.uuid(),
    decision: z.enum(['accepted', 'changes_requested']),
    note: z.string().nullable(),
    decidedByName: z.string().nullable(),
    decidedAt: z.iso.datetime(),
    /** The project revision the owner saw. */
    projectRevision: z.number().int(),
    contractValue: z.number().int().nullable(),
    currency: z.string(),
    stageCount: z.number().int(),
  })
  .meta({ id: 'AcceptanceRecord' });
export type AcceptanceRecord = z.infer<typeof AcceptanceRecord>;

/** PUT /v1/projects/:id/plan — the whole plan, in order (send If-Match with the plan revision). */
export const SaveStagePlanRequest = z
  .object({
    /** Agreed contract value in whole units of the project currency; omit to keep it, null for "not agreed yet". */
    contractValue: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
    stages: z
      .array(StagePlanItem)
      .min(1)
      .max(MAX_STAGES)
      .refine((s) => s.reduce((sum, x) => sum + x.weight, 0) === 100, { message: 'Stage weights must total 100' }),
  })
  .meta({ id: 'SaveStagePlanRequest' });
export type SaveStagePlanRequest = z.input<typeof SaveStagePlanRequest>;

export const StagePlan = z
  .object({
    projectId: z.uuid(),
    /** The project's revision; send it back as If-Match when saving. */
    revision: z.number().int(),
    /** Whether the caller may change the plan (owner, manager or contractor). */
    canEdit: z.boolean(),
    /** Plans lock once the project starts; later changes go through a change request. */
    locked: z.boolean(),
    currency: z.string(),
    contractValue: z.number().int().nullable(),
    stages: z.array(ProjectStage),
    /** The owner's latest decision, e.g. a request for changes with its note. */
    latestDecision: AcceptanceRecord.nullable(),
  })
  .meta({ id: 'StagePlan' });
export type StagePlan = z.infer<typeof StagePlan>;

/** Weights that do not total 100, as a signed gap (positive = still to give out). */
export const weightGap = (stages: { weight: number }[]) => 100 - stages.reduce((s, x) => s + x.weight, 0);

/* ---------- locations (Rwanda: province → district → sector → cell → village) ---------- */

export const LocationLevel = z.enum(['province', 'district', 'sector', 'cell', 'village']);
export type LocationLevel = z.infer<typeof LocationLevel>;
export const locationLevels = LocationLevel.options;

/** GET /v1/locations/rw — give the levels chosen so far; returns the options for the next one. */
export const LocationQuery = z
  .object({
    province: z.string().max(60).optional(),
    district: z.string().max(60).optional(),
    sector: z.string().max(60).optional(),
    cell: z.string().max(60).optional(),
  })
  .meta({ id: 'LocationQuery' });
export type LocationQuery = z.infer<typeof LocationQuery>;

export const LocationOptions = z
  .object({ level: LocationLevel, options: z.array(z.string()) })
  .meta({ id: 'LocationOptions' });
export type LocationOptions = z.infer<typeof LocationOptions>;

/** Dataset province names → translation keys (`province.<key>`). */
export const provinceKeys: Record<string, 'kigali' | 'south' | 'west' | 'north' | 'east'> = {
  'Kigali City': 'kigali',
  'Southern Province': 'south',
  'Western Province': 'west',
  'Northern Province': 'north',
  'Eastern Province': 'east',
};

/** Removes a stage and spreads its share over the others. */
export function withStageRemoved(stages: StageDraft[], index: number): StageDraft[] {
  const rest = stages.filter((_, i) => i !== index);
  const weights = rebalanceWeights(rest.map((s) => s.weight));
  return rest.map((s, i) => ({ ...s, weight: weights[i] }));
}

/** Adds a stage with an average share; the others shrink in proportion. */
export function withStageAdded(stages: StageDraft[], name: string): StageDraft[] {
  if (stages.length >= MAX_STAGES) return stages;
  const all = [...stages, { name, weight: 100 / (stages.length + 1) }];
  const scaled = all.map((s, i) => (i < stages.length ? (s.weight * stages.length) / (stages.length + 1) : s.weight));
  const weights = rebalanceWeights(scaled);
  return all.map((s, i) => ({ ...s, weight: weights[i] }));
}

/* ---------- plan editor (shared by the phone and web screens) ---------- */

/** A stage being edited; `key` is stable for list rendering, `id` is absent for new stages. */
export interface PlanDraftStage {
  key: string;
  id?: string;
  name: string;
  weight: number;
  description: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  criteria: string[];
}

export const toPlanDraft = (stages: ProjectStage[]): PlanDraftStage[] =>
  stages.map((s) => ({
    key: s.id,
    id: s.id,
    name: s.name,
    weight: s.weight,
    description: s.description ?? '',
    plannedStart: s.plannedStart,
    plannedEnd: s.plannedEnd,
    criteria: [...s.criteria],
  }));

export const planDraftToRequest = (
  stages: PlanDraftStage[],
  contractValue?: number | null,
): z.output<typeof SaveStagePlanRequest> => ({
  ...(contractValue !== undefined ? { contractValue } : {}),
  stages: stages.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
    name: s.name.trim(),
    weight: s.weight,
    description: s.description.trim() || null,
    plannedStart: s.plannedStart,
    plannedEnd: s.plannedEnd,
    criteria: s.criteria.map((c) => c.trim()).filter(Boolean),
  })),
});

/** What stops the plan from being saved: the weight total, short names and dates out of order. */
export function planProblems(stages: PlanDraftStage[]) {
  const total = stages.reduce((s, x) => s + x.weight, 0);
  const shortNames = stages.flatMap((s, i) => (s.name.trim().length < 2 ? [i] : []));
  const badDates = stages.flatMap((s, i) => (s.plannedStart && s.plannedEnd && s.plannedEnd < s.plannedStart ? [i] : []));
  return { total, shortNames, badDates, ok: stages.length > 0 && total === 100 && !shortNames.length && !badDates.length };
}

/** Scales the shares back to exactly 100, keeping their proportions. */
export function spreadTo100(stages: PlanDraftStage[]): PlanDraftStage[] {
  const w = rebalanceWeights(stages.map((s) => s.weight));
  return stages.map((s, i) => ({ ...s, weight: w[i] }));
}

export function moveStage<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export const clampWeight = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

/* ---------- owner acceptance of the baseline (spec §5.1, §13.2) ---------- */

/** POST /v1/projects/:id/acceptance (owner only; send If-Match with the revision you reviewed). */
export const AcceptanceDecisionRequest = z
  .object({
    decision: z.enum(['accept', 'request_changes']),
    /** Required when asking for changes: what should change. */
    note: z.string().trim().max(500).optional(),
  })
  .refine((r) => r.decision === 'accept' || (r.note?.length ?? 0) >= 3, {
    message: 'Say what should change',
    path: ['note'],
  })
  .meta({ id: 'AcceptanceDecisionRequest' });
export type AcceptanceDecisionRequest = z.infer<typeof AcceptanceDecisionRequest>;

/** GET /v1/projects/:id/acceptance — everything the owner reviews before accepting. */
export const ProjectAcceptanceView = z
  .object({
    projectId: z.uuid(),
    projectName: z.string(),
    organizationName: z.string(),
    status: z.enum(['draft', 'active', 'handover', 'archived', 'paused', 'cancelled']),
    /** Send as If-Match: an acceptance applies to exactly this version. */
    revision: z.number().int(),
    currency: z.string(),
    contractValue: z.number().int().nullable(),
    stages: z.array(ProjectStage),
    /** True for the owner while the project is a draft. */
    canDecide: z.boolean(),
    /** What must be in place before the owner can accept. */
    readiness: z.object({ stages: z.boolean(), contractValue: z.boolean() }),
    ready: z.boolean(),
    /** Newest first. */
    history: z.array(AcceptanceRecord),
  })
  .meta({ id: 'ProjectAcceptanceView' });
export type ProjectAcceptanceView = z.infer<typeof ProjectAcceptanceView>;
