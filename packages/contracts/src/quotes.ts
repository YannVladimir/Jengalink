// Quotations (spec §37.1): scope, exclusions, priced milestones, expiry; revisions are frozen once sent.
import { z } from "zod";
import { rebalanceWeights } from "./planning";

export const MAX_MILESTONES = 30;
export const MAX_EXCLUSIONS = 20;

/** How a work package is priced (spec §37.1). */
export const CommercialBasis = z.enum(["fixed", "reimbursable"]);
export type CommercialBasis = z.infer<typeof CommercialBasis>;

export const QuoteMilestoneInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(300).nullable().optional(),
    /** Fixed: the agreed price. Reimbursable: the estimate, fee included. */
    amount: z.number().int().min(0).max(1_000_000_000_000),
    stageId: z.uuid().nullable().optional(),
    basis: CommercialBasis.default("fixed"),
    /** Reimbursable only: the contractor's fee on actual cost, in percent (one decimal). */
    feePercent: z
      .number()
      .min(0)
      .max(100)
      .multipleOf(0.1)
      .nullable()
      .optional(),
    /** The contractor's own expected cost: private to their company, never shown to the owner. */
    internalCost: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000_000)
      .nullable()
      .optional(),
  })
  .refine((m) => m.basis === "fixed" || m.feePercent != null, {
    message: "Enter the fee percentage",
    path: ["feePercent"],
  })
  .meta({ id: "QuoteMilestoneInput" });
export type QuoteMilestoneInput = z.input<typeof QuoteMilestoneInput>;

/** POST /v1/projects/:id/quotes and PUT …/quotes/:quoteId (a sent revision is never edited: saving starts a new one). */
export const SaveQuoteRequest = z
  .object({
    title: z.string().trim().min(2).max(120),
    scope: z.string().trim().min(3).max(4000),
    exclusions: z
      .array(z.string().trim().min(2).max(200))
      .max(MAX_EXCLUSIONS)
      .default([]),
    milestones: z.array(QuoteMilestoneInput).min(1).max(MAX_MILESTONES),
    terms: z.string().trim().max(2000).nullable().optional(),
    validUntil: z.iso.date(),
  })
  .refine((q) => q.milestones.reduce((t, m) => t + m.amount, 0) > 0, {
    message: "The quote total must be more than zero",
    path: ["milestones"],
  })
  .meta({ id: "SaveQuoteRequest" });
export type SaveQuoteRequest = z.input<typeof SaveQuoteRequest>;

export const QuoteStatus = z.enum([
  "draft",
  "sent",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
]);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

export const QuoteSummary = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: QuoteStatus,
    currentRevision: z.number().int(),
    title: z.string(),
    currency: z.string(),
    total: z.number().int(),
    validUntil: z.iso.date(),
    sentAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "QuoteSummary" });
export type QuoteSummary = z.infer<typeof QuoteSummary>;

export const QuoteMilestoneView = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    amount: z.number().int(),
    stageId: z.uuid().nullable(),
    basis: CommercialBasis,
    feePercent: z.number().nullable(),
  })
  .meta({ id: "QuoteMilestoneView" });
export type QuoteMilestoneView = z.infer<typeof QuoteMilestoneView>;
export const QuoteBasis = z.enum(["fixed", "reimbursable", "hybrid"]);
export type QuoteBasis = z.infer<typeof QuoteBasis>;

export const QuoteView = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    projectName: z.string(),
    organizationName: z.string(),
    /** Who the quote is for: the owner's name once they joined. */
    clientName: z.string().nullable(),
    number: z.string(),
    status: QuoteStatus,
    /** The revision shown. */
    revision: z.number().int(),
    /** Every revision, newest first, with whether and when it was sent. */
    revisions: z.array(
      z.object({
        revision: z.number().int(),
        sentAt: z.iso.datetime().nullable(),
        total: z.number().int(),
      }),
    ),
    title: z.string(),
    scope: z.string(),
    exclusions: z.array(z.string()),
    milestones: z.array(QuoteMilestoneView),
    /** Fixed, reimbursable, or hybrid when packages differ. */
    commercialBasis: QuoteBasis,
    /**
     * The contractor's private costs and estimated margin. Present only for members of the
     * contractor's company who write quotes; null for the owner and everyone else.
     */
    internal: z
      .object({
        costs: z.array(z.number().int().nullable()),
        totalCost: z.number().int().nullable(),
        margin: z.number().int().nullable(),
        marginPercent: z.number().nullable(),
      })
      .nullable(),
    terms: z.string().nullable(),
    currency: z.string(),
    total: z.number().int(),
    validUntil: z.iso.date(),
    sentAt: z.iso.datetime().nullable(),
    /** Send as If-Match when saving. */
    version: z.number().int(),
    /** The contractor or manager may edit and send. */
    canEdit: z.boolean(),
    /** The owner may accept or decline the revision shown (sent, not expired, not decided). */
    canDecide: z.boolean(),
    /** The owner's decision, if any. */
    decision: z
      .object({
        kind: z.enum(["accepted", "declined"]),
        revision: z.number().int(),
        byName: z.string().nullable(),
        at: z.iso.datetime(),
        note: z.string().nullable(),
        /** The agreement version created by the acceptance. */
        agreementVersion: z.number().int().nullable(),
      })
      .nullable(),
  })
  .meta({ id: "QuoteView" });
export type QuoteView = z.infer<typeof QuoteView>;

/** POST …/quotes/:quoteId/pdf — a short-lived private link to the branded PDF. */
export const QuotePdfLink = z
  .object({ url: z.url(), expiresAt: z.iso.datetime() })
  .meta({ id: "QuotePdfLink" });
export type QuotePdfLink = z.infer<typeof QuotePdfLink>;

export const quoteTotal = (milestones: { amount: number }[]) =>
  milestones.reduce((t, m) => t + m.amount, 0);

/**
 * One milestone per plan stage, splitting `total` by the stages' shares; amounts
 * always add up to exactly `total` (largest remainder on whole RWF).
 */
export function milestonesFromStages(
  stages: { id: string; name: string; weight: number }[],
  total: number,
): QuoteMilestoneInput[] {
  if (!stages.length) return [];
  const shares = rebalanceWeights(stages.map((s) => s.weight));
  const exact = shares.map((w) => (w * total) / 100);
  const amounts = exact.map(Math.floor);
  let left = total - amounts.reduce((t, a) => t + a, 0);
  const order = exact
    .map((e, i) => [e - Math.floor(e), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    amounts[i] += 1;
  }
  return stages.map((s, i) => ({
    name: s.name,
    description: null,
    amount: amounts[i],
    stageId: s.id,
  }));
}

/** A sent quote past its date is shown as expired (the date is in the project's time zone). */
export const isExpired = (validUntil: string, today: string) =>
  validUntil < today;

/**
 * POST …/quotes/:quoteId/decision — the owner accepts or declines the exact revision they read
 * (If-Match: the quote's version). Accepting creates the next agreement version and sets the contract value.
 */
export const QuoteDecisionRequest = z
  .object({
    decision: z.enum(["accept", "decline"]),
    revision: z.number().int().min(1),
    note: z.string().trim().max(500).optional(),
  })
  .meta({ id: "QuoteDecisionRequest" });
export type QuoteDecisionRequest = z.infer<typeof QuoteDecisionRequest>;

/** GET /v1/projects/:id/agreements — what was agreed, version by version (newest first). */
export const AgreementView = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    quoteId: z.uuid(),
    quoteNumber: z.string(),
    quoteRevision: z.number().int(),
    title: z.string(),
    contractValue: z.number().int(),
    currency: z.string(),
    milestones: z.array(QuoteMilestoneView),
    commercialBasis: QuoteBasis,
    acceptedByName: z.string().nullable(),
    acceptedAt: z.iso.datetime(),
    /** Set when this version came from an approved budget change. */
    changeNumber: z.string().nullable(),
  })
  .meta({ id: "AgreementView" });
export type AgreementView = z.infer<typeof AgreementView>;

/** Fixed or reimbursable when every package agrees; hybrid otherwise. */
export function quoteBasisOf(
  milestones: { basis?: CommercialBasis }[],
): QuoteBasis {
  const kinds = new Set(milestones.map((m) => m.basis ?? "fixed"));
  return kinds.size > 1
    ? "hybrid"
    : ((kinds.values().next().value as CommercialBasis | undefined) ?? "fixed");
}

/** The contractor's estimated margin from their private costs; null until every package has a cost. */
export function marginOf(
  milestones: { amount: number }[],
  costs: (number | null | undefined)[],
) {
  const known = milestones.every((_, i) => costs[i] != null);
  if (!known || !milestones.length)
    return { totalCost: null, margin: null, marginPercent: null };
  const totalCost = costs.reduce<number>((t, c) => t + (c ?? 0), 0);
  const total = milestones.reduce((t, m) => t + m.amount, 0);
  const margin = total - totalCost;
  return {
    totalCost,
    margin,
    marginPercent: total ? Math.round((margin * 1000) / total) / 10 : null,
  };
}

/** Estimate for a reimbursable package: cost plus the fee. */
export const withFee = (cost: number, feePercent: number) =>
  Math.round(cost * (1 + feePercent / 100));
