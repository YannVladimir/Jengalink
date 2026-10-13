// Budget changes (spec §2 A0, §6.1, §7): deltas to named packages with a reason; the owner's
// approval creates the next agreement version. The approved budget is never edited in place.
import { z } from "zod";
import { ClaimFile, ClaimFileInput } from "./claims";
import { CommercialBasis } from "./quotes";

export const MAX_CHANGE_LINES = 30;
export const MAX_CHANGE_FILES = 10;
export const ChangeCategory = z.enum(["owner_request", "unforeseen_conditions", "specification_change", "quantity_correction"]);
export type ChangeCategory = z.infer<typeof ChangeCategory>;
export const ChangeStatus = z.enum(["draft", "submitted", "applied", "rejected", "withdrawn"]);
export type ChangeStatus = z.infer<typeof ChangeStatus>;

/** One line: an existing package by its position, or a new package; and how much to add (negative removes). */
export const ChangeLineInput = z
  .object({
    milestoneIndex: z.number().int().min(0).max(99).nullable().optional(),
    newPackage: z
      .object({
        name: z.string().trim().min(2).max(120),
        basis: CommercialBasis.default("fixed"),
        feePercent: z.number().min(0).max(100).multipleOf(0.1).nullable().optional(),
      })
      .nullable()
      .optional(),
    delta: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  })
  .refine((l) => (l.milestoneIndex != null) !== (l.newPackage != null), {
    message: "Pick an existing package or describe a new one",
    path: ["milestoneIndex"],
  })
  .refine((l) => l.delta !== 0, { message: "Enter an amount to add or remove", path: ["delta"] })
  .refine((l) => l.newPackage == null || l.delta > 0, { message: "A new package needs a positive amount", path: ["delta"] })
  .refine((l) => l.newPackage == null || l.newPackage.basis === "fixed" || l.newPackage.feePercent != null, {
    message: "Enter the fee percentage",
    path: ["newPackage", "feePercent"],
  })
  .meta({ id: "ChangeLineInput" });
export type ChangeLineInput = z.input<typeof ChangeLineInput>;

/** POST /v1/projects/:id/changes and PUT …/changes/:changeId (drafts and changes not yet answered). */
export const SaveBudgetChangeRequest = z
  .object({
    category: ChangeCategory,
    reason: z.string().trim().min(10).max(2000),
    /** Days added to the schedule (negative = days saved); null = none stated. */
    scheduleDays: z.number().int().min(-365).max(365).nullable().optional(),
    lines: z.array(ChangeLineInput).min(1).max(MAX_CHANGE_LINES),
    files: z.array(ClaimFileInput).max(MAX_CHANGE_FILES).default([]),
    removeFileIds: z.array(z.uuid()).max(MAX_CHANGE_FILES).default([]),
  })
  .refine((c) => new Set(c.lines.filter((l) => l.milestoneIndex != null).map((l) => l.milestoneIndex)).size === c.lines.filter((l) => l.milestoneIndex != null).length, {
    message: "Each package appears once",
    path: ["lines"],
  })
  .meta({ id: "SaveBudgetChangeRequest" });
export type SaveBudgetChangeRequest = z.input<typeof SaveBudgetChangeRequest>;

/** POST …/changes/:changeId/decision (If-Match): the owner answers the exact net change on screen. */
export const BudgetChangeDecisionRequest = z
  .object({
    decision: z.enum(["approve", "reject"]),
    netDelta: z.number().int(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((d) => d.decision === "approve" || (d.note ?? "").length >= 3, { message: "Say why", path: ["note"] })
  .meta({ id: "BudgetChangeDecisionRequest" });
export type BudgetChangeDecisionRequest = z.input<typeof BudgetChangeDecisionRequest>;

export const BudgetChangeLine = z
  .object({
    milestoneIndex: z.number().int().nullable(),
    name: z.string(),
    basis: CommercialBasis,
    feePercent: z.number().nullable(),
    /** The package amount in the agreement the change is based on (0 for a new package). */
    before: z.number().int(),
    delta: z.number().int(),
    after: z.number().int(),
    /** The lowest it may go: already claimed (fixed price) or spent and reserved (cost + fee). */
    floor: z.number().int(),
  })
  .meta({ id: "BudgetChangeLine" });
export type BudgetChangeLine = z.infer<typeof BudgetChangeLine>;

export const BudgetChangeDecision = z
  .object({
    kind: z.enum(["approved", "rejected"]),
    netDelta: z.number().int(),
    note: z.string().nullable(),
    byName: z.string().nullable(),
    at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "BudgetChangeDecision" });
export type BudgetChangeDecision = z.infer<typeof BudgetChangeDecision>;

export const BudgetChangeView = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: ChangeStatus,
    category: ChangeCategory,
    reason: z.string(),
    scheduleDays: z.number().int().nullable(),
    baseVersion: z.number().int(),
    /** The agreement moved on since this change was written: it must be redone on the new version. */
    stale: z.boolean(),
    lines: z.array(BudgetChangeLine),
    netDelta: z.number().int(),
    contractBefore: z.number().int(),
    contractAfter: z.number().int(),
    currency: z.string(),
    files: z.array(ClaimFile),
    decisions: z.array(BudgetChangeDecision),
    createdByName: z.string().nullable(),
    submittedAt: z.iso.datetime({ offset: true }).nullable(),
    /** The agreement version this change created, once applied. */
    appliedVersion: z.number().int().nullable(),
    canEdit: z.boolean(),
    canDecide: z.boolean(),
    canWithdraw: z.boolean(),
    version: z.number().int(),
  })
  .meta({ id: "BudgetChangeView" });
export type BudgetChangeView = z.infer<typeof BudgetChangeView>;

export const BudgetChangeSummary = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: ChangeStatus,
    category: ChangeCategory,
    netDelta: z.number().int(),
    appliedVersion: z.number().int().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "BudgetChangeSummary" });
export type BudgetChangeSummary = z.infer<typeof BudgetChangeSummary>;

/** One package across versions: what was first agreed, approved changes, and now. */
export const BudgetHistoryLine = z
  .object({
    index: z.number().int(),
    name: z.string(),
    basis: CommercialBasis,
    original: z.number().int(),
    changes: z.number().int(),
    current: z.number().int(),
  })
  .meta({ id: "BudgetHistoryLine" });
export type BudgetHistoryLine = z.infer<typeof BudgetHistoryLine>;

/** GET /v1/projects/:id/changes — the budget's history (spec §7 "original, additions, reductions, current") and every change. */
export const BudgetChangesOverview = z
  .object({
    agreementVersion: z.number().int().nullable(),
    currency: z.string(),
    lines: z.array(BudgetHistoryLine),
    original: z.number().int(),
    additions: z.number().int(),
    reductions: z.number().int(),
    current: z.number().int(),
    changes: z.array(BudgetChangeSummary),
    canPropose: z.boolean(),
  })
  .meta({ id: "BudgetChangesOverview" });
export type BudgetChangesOverview = z.infer<typeof BudgetChangesOverview>;

/** The lowest estimate whose cost budget (without the fee) still covers what is spent and reserved. */
export function reimbursableFloor(used: number, feePercent: number | null): number {
  if (used <= 0) return 0;
  const f = 1000 + Math.round((feePercent ?? 0) * 10);
  // Start just below the exact value (rounding can make a smaller estimate enough), then step up.
  let e = Math.max(0, Math.floor((used * f) / 1000) - 1);
  while (Math.round((e * 1000) / f) < used) e += 1;
  return e;
}
