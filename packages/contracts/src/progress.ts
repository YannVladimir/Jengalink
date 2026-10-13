// Project progress from real stages (spec §5.3): accepted progress is the weighted sum of
// accepted stages; "reported" is work said to be complete but not yet accepted. Money spent
// never counts as progress.
import { z } from 'zod';

/** What the tower shows for a stage (the shared chart vocabulary). */
export const StageDisplayStatus = z.enum(['planned', 'in_progress', 'ready_for_review', 'accepted', 'blocked', 'changes_required']);
export type StageDisplayStatus = z.infer<typeof StageDisplayStatus>;

export const StageProgress = z
  .object({
    id: z.uuid(),
    name: z.string(),
    position: z.number().int(),
    weight: z.number().int(),
    /** The stage's own status (changes when it is submitted for review and accepted). */
    status: z.enum(['not_started', 'in_progress', 'ready_for_review', 'accepted', 'changes_required']),
    /** Send as If-Match when reviewing the stage. */
    revision: z.number().int(),
    /** What to show: also "in progress" once work is reported and "blocked" when the latest update reports a blocker. */
    displayStatus: StageDisplayStatus,
    updateCount: z.number().int(),
    lastUpdateAt: z.iso.datetime().nullable(),
    /** The blocker from the stage's latest update, if any. */
    blocker: z.string().nullable(),
    /** The owner's note when they asked for changes. */
    changesNote: z.string().nullable(),
  })
  .meta({ id: 'StageProgress' });
export type StageProgress = z.infer<typeof StageProgress>;

export const ProjectProgress = z
  .object({
    projectId: z.uuid(),
    /** 0–100: accepted stages' weights. The big number. */
    acceptedPercent: z.number().int(),
    /** 0–100: stages ready for review, not yet accepted. Drawn light. */
    reportedPercent: z.number().int(),
    stages: z.array(StageProgress),
    /** The latest site update, for "updated 2 h ago". */
    lastUpdateAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ProjectProgress' });
export type ProjectProgress = z.infer<typeof ProjectProgress>;

type StageFacts = Pick<StageProgress, 'weight' | 'status' | 'updateCount' | 'blocker'>;

export function displayStatusOf(s: StageFacts): StageDisplayStatus {
  if (s.status === 'accepted') return 'accepted';
  if (s.status === 'ready_for_review') return 'ready_for_review';
  if (s.status === 'changes_required') return 'changes_required';
  if (s.blocker) return 'blocked';
  if (s.status === 'in_progress' || s.updateCount > 0) return 'in_progress';
  return 'planned';
}

/** Accepted and reported percentages; weights total 100, but stay safe if they do not. */
export function progressPercents(stages: StageFacts[]) {
  const total = stages.reduce((t, s) => t + s.weight, 0) || 1;
  const pct = (filter: (s: StageFacts) => boolean) =>
    Math.round((stages.filter(filter).reduce((t, s) => t + s.weight, 0) * 100) / total);
  const acceptedPercent = pct((s) => s.status === 'accepted');
  const reportedPercent = Math.min(100 - acceptedPercent, pct((s) => s.status === 'ready_for_review'));
  return { acceptedPercent, reportedPercent };
}

/* ---------- stage review (spec §13.2) ---------- */

/** POST /v1/projects/:id/stages/:stageId/submit — the contractor says the stage is done. */
export const SubmitStageRequest = z
  .object({ note: z.string().trim().max(500).optional() })
  .meta({ id: 'SubmitStageRequest' });
export type SubmitStageRequest = z.infer<typeof SubmitStageRequest>;

/** POST /v1/projects/:id/stages/:stageId/review — the owner decides (If-Match: the stage revision). */
export const StageReviewRequest = z
  .object({
    decision: z.enum(['accept', 'request_changes']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((r) => r.decision === 'accept' || (r.note?.length ?? 0) >= 3, { message: 'Say what should change', path: ['note'] })
  .meta({ id: 'StageReviewRequest' });
export type StageReviewRequest = z.infer<typeof StageReviewRequest>;

export const StageReview = z
  .object({
    id: z.uuid(),
    kind: z.enum(['submitted', 'accepted', 'changes_requested']),
    note: z.string().nullable(),
    actorName: z.string().nullable(),
    stageRevision: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'StageReview' });
export type StageReview = z.infer<typeof StageReview>;

/* ---------- multi-project overview (contractors and owners) ---------- */

export const NextActionKind = z.enum([
  'review_stage',
  'accept_project',
  'invite_owner',
  'plan_project',
  'await_owner',
  'fix_changes',
  'clear_blocker',
  'post_update',
  'none',
]);
export type NextActionKind = z.infer<typeof NextActionKind>;

export const NextAction = z
  .object({ kind: NextActionKind, stageId: z.uuid().nullable(), stageName: z.string().nullable() })
  .meta({ id: 'NextAction' });
export type NextAction = z.infer<typeof NextAction>;

export const ProjectOverview = z
  .object({
    id: z.uuid(),
    name: z.string(),
    organizationName: z.string(),
    status: z.enum(['draft', 'active', 'handover', 'archived', 'paused', 'cancelled']),
    myRoles: z.array(z.string()),
    hasOwner: z.boolean(),
    contractValue: z.number().int().nullable(),
    /** The caller may see this project's money. */
    seesMoney: z.boolean(),
    acceptedPercent: z.number().int(),
    reportedPercent: z.number().int(),
    stageCount: z.number().int(),
    /** Stages whose latest update reports a blocker. */
    blockers: z.array(z.object({ stageId: z.uuid(), stageName: z.string(), text: z.string() })),
    waitingReview: z.number().int(),
    changesRequested: z.number().int(),
    lastUpdateAt: z.iso.datetime().nullable(),
    nextAction: NextAction,
  })
  .meta({ id: 'ProjectOverview' });
export type ProjectOverview = z.infer<typeof ProjectOverview>;

/** Days without a site update before "post an update" becomes the next action. */
export const QUIET_DAYS = 3;

/**
 * The single most useful next step for this person on this project, by role.
 * Owners decide; contractors keep the project moving; supervisors report.
 */
export function nextActionFor(
  p: {
    status: ProjectOverview['status'];
    myRoles: string[];
    hasOwner: boolean;
    contractValue: number | null;
    lastUpdateAt: string | null;
    stages: Pick<StageProgress, 'id' | 'name' | 'status' | 'displayStatus'>[];
  },
  now = Date.now(),
): NextAction {
  const act = (kind: NextActionKind, stage?: { id: string; name: string }): NextAction => ({
    kind,
    stageId: stage?.id ?? null,
    stageName: stage?.name ?? null,
  });
  const has = (...roles: string[]) => p.myRoles.some((r) => roles.includes(r));
  const ready = p.stages.find((s) => s.status === 'ready_for_review');
  const changes = p.stages.find((s) => s.status === 'changes_required');
  const blocked = p.stages.find((s) => s.displayStatus === 'blocked');
  const quiet = !p.lastUpdateAt || now - Date.parse(p.lastUpdateAt) > QUIET_DAYS * 86_400_000;
  const planned = p.stages.length > 0 && p.contractValue !== null;

  if (has('owner', 'delegate')) {
    if (p.status === 'active' && ready) return act('review_stage', ready);
    if (p.status === 'draft' && has('owner') && planned) return act('accept_project');
  }
  if (has('contractor', 'manager')) {
    if (p.status === 'draft') {
      if (!p.hasOwner) return act('invite_owner');
      if (!planned) return act('plan_project');
      return act('await_owner');
    }
    if (p.status === 'active') {
      if (changes) return act('fix_changes', changes);
      if (blocked) return act('clear_blocker', blocked);
      if (quiet) return act('post_update');
    }
  }
  if (has('supervisor') && p.status === 'active') {
    if (blocked) return act('clear_blocker', blocked);
    if (quiet) return act('post_update');
  }
  return act('none');
}
