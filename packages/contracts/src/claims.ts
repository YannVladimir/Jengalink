// Payment claims (spec §37.1, §41): the contractor asks to be paid for an agreed milestone, with
// evidence. A record only: the owner pays outside JengaLink.
import { z } from "zod";
import { CommercialBasis } from "./quotes";
import { MAX_PHOTO_BYTES, PhotoContentType, SiteUpdate } from "./updates";

export const MAX_CLAIM_FILES = 10;
export const MAX_CLAIM_UPDATES = 20;
export const MAX_CLAIM_FILE_BYTES = MAX_PHOTO_BYTES;
/** Photos, or a PDF (invoice, delivery note, measurement sheet). */
export const ClaimFileType = z.enum([...PhotoContentType.options, "application/pdf"]);
export type ClaimFileType = z.infer<typeof ClaimFileType>;

/** POST /v1/projects/:id/claims/uploads — a short-lived signed PUT for one claim file. */
export const RequestClaimUploadRequest = z
  .object({
    contentType: ClaimFileType,
    sizeBytes: z.number().int().min(1).max(MAX_CLAIM_FILE_BYTES).optional(),
  })
  .meta({ id: "RequestClaimUploadRequest" });
export type RequestClaimUploadRequest = z.infer<typeof RequestClaimUploadRequest>;

export const ClaimFileInput = z
  .object({
    uploadKey: z.string().min(8).max(300),
    fileName: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .meta({ id: "ClaimFileInput" });
export type ClaimFileInput = z.infer<typeof ClaimFileInput>;

/** POST /v1/projects/:id/claims and PUT …/claims/:claimId (drafts only). */
export const SaveClaimRequest = z
  .object({
    /** Position of the milestone in the current agreement. */
    milestoneIndex: z.number().int().min(0).max(99),
    amount: z.number().int().min(1).max(1_000_000_000_000),
    note: z.string().trim().max(2000).nullable().optional(),
    /** Site updates offered as evidence (this project's). */
    siteUpdateIds: z.array(z.uuid()).max(MAX_CLAIM_UPDATES).default([]),
    /** New files to attach (from claim uploads). */
    files: z.array(ClaimFileInput).max(MAX_CLAIM_FILES).default([]),
    /** Saving a draft: files to take off it. */
    removeFileIds: z.array(z.uuid()).max(MAX_CLAIM_FILES).default([]),
    /** Editing a claim already sent: what changed (required then; it starts the next revision). */
    changeNote: z.string().trim().max(500).nullable().optional(),
  })
  .meta({ id: "SaveClaimRequest" });
export type SaveClaimRequest = z.input<typeof SaveClaimRequest>;

/**
 * draft: only the contractor's side sees it. submitted: waiting for the owner.
 * approved / rejected / changes_requested: the owner's answer. paid: payment recorded.
 */
export const ClaimStatus = z.enum(["draft", "submitted", "approved", "rejected", "changes_requested", "paid", "cancelled"]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

/** A milestone of the current agreement, with what was claimed on it so far. */
export const ClaimableMilestone = z
  .object({
    index: z.number().int(),
    name: z.string(),
    amount: z.number().int(),
    basis: CommercialBasis,
    feePercent: z.number().nullable(),
    stageId: z.uuid().nullable(),
    /** Claims still standing on it (submitted, approved, paid; and the caller's drafts). */
    claimed: z.number().int(),
    /** Fixed price: what is left to claim. Reimbursable: null (the amount is an estimate). */
    remaining: z.number().int().nullable(),
  })
  .meta({ id: "ClaimableMilestone" });
export type ClaimableMilestone = z.infer<typeof ClaimableMilestone>;

/** GET /v1/projects/:id/claims/milestones — what can be claimed (empty before any agreement). */
export const ClaimMilestones = z
  .object({
    agreementId: z.uuid().nullable(),
    agreementVersion: z.number().int().nullable(),
    currency: z.string(),
    milestones: z.array(ClaimableMilestone),
  })
  .meta({ id: "ClaimMilestones" });
export type ClaimMilestones = z.infer<typeof ClaimMilestones>;

export const ClaimFile = z
  .object({
    id: z.uuid(),
    kind: z.enum(["photo", "document"]),
    fileName: z.string().nullable(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    /** processing: being scanned; ready: links available; blocked: the virus scan found a threat; failed: unreadable. */
    status: z.enum(["processing", "ready", "blocked", "failed"]),
    url: z.url().nullable(),
    thumbUrl: z.url().nullable(),
    uploadedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "ClaimFile" });
export type ClaimFile = z.infer<typeof ClaimFile>;

/** POST …/claims/:claimId/decision (If-Match: the version read). The owner answers what they saw. */
export const ClaimDecisionRequest = z
  .object({
    decision: z.enum(["approve", "reject", "request_changes"]),
    /** The amount shown on screen: approval fails if the claim changed since. */
    amount: z.number().int().min(1),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((d) => d.decision === "approve" || (d.note ?? "").length >= 3, {
    message: "Say what is wrong or what should change",
    path: ["note"],
  })
  .meta({ id: "ClaimDecisionRequest" });
export type ClaimDecisionRequest = z.input<typeof ClaimDecisionRequest>;

export const ClaimDecision = z
  .object({
    kind: z.enum(["approved", "rejected", "changes_requested"]),
    /** The sent revision answered. */
    revisionNo: z.number().int(),
    amount: z.number().int(),
    note: z.string().nullable(),
    byName: z.string().nullable(),
    at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "ClaimDecision" });
export type ClaimDecision = z.infer<typeof ClaimDecision>;

/** One revision sent to the owner. */
export const ClaimRevision = z
  .object({
    revisionNo: z.number().int(),
    amount: z.number().int(),
    milestoneName: z.string(),
    changeNote: z.string().nullable(),
    /** Sending it cancelled the owner's approval of the revision before. */
    cancelledApproval: z.boolean(),
    byName: z.string().nullable(),
    at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "ClaimRevision" });
export type ClaimRevision = z.infer<typeof ClaimRevision>;

export const ClaimSummary = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: ClaimStatus,
    milestoneName: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    evidenceCount: z.number().int(),
    submittedAt: z.iso.datetime({ offset: true }).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "ClaimSummary" });
export type ClaimSummary = z.infer<typeof ClaimSummary>;

export const ClaimView = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    projectName: z.string(),
    organizationName: z.string(),
    number: z.string(),
    status: ClaimStatus,
    agreementVersion: z.number().int(),
    milestoneIndex: z.number().int(),
    milestoneName: z.string(),
    /** The milestone's agreed price (or estimate, when reimbursable). */
    milestoneAmount: z.number().int(),
    basis: CommercialBasis,
    feePercent: z.number().nullable(),
    /** Other standing claims on the same milestone. */
    claimedBefore: z.number().int(),
    amount: z.number().int(),
    currency: z.string(),
    note: z.string().nullable(),
    updates: z.array(SiteUpdate),
    files: z.array(ClaimFile),
    createdByName: z.string().nullable(),
    submittedByName: z.string().nullable(),
    submittedAt: z.iso.datetime({ offset: true }).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
    canEdit: z.boolean(),
    /** The last revision sent (0 = never sent). */
    revisionNo: z.number().int(),
    /** Saving now sends the next revision at once (the claim was already sent); a change note is required. */
    savingSendsRevision: z.boolean(),
    /** Revisions sent, newest first. */
    revisions: z.array(ClaimRevision),
    /** Settled payments on this claim (cash paid). */
    paidAmount: z.number().int(),
    /** Payments recorded, waiting for verification. */
    pendingPayments: z.number().int(),
    /** The owner (or delegate) can approve, reject or ask for changes now. */
    canDecide: z.boolean(),
    /** The owner's answers, newest first. */
    decisions: z.array(ClaimDecision),
    /** For If-Match on PUT. */
    version: z.number().int(),
  })
  .meta({ id: "ClaimView" });
export type ClaimView = z.infer<typeof ClaimView>;

/** Claims that still count against a milestone: everything except rejected and cancelled. */
export const STANDING_CLAIMS: readonly ClaimStatus[] = ["draft", "submitted", "approved", "changes_requested", "paid"];

/**
 * Why a claim cannot be sent yet (empty = fine). `remaining` is what is left on a
 * fixed-price milestone without this claim, or null when reimbursable.
 */
export function claimProblems(c: { amount: number | null; evidence: number; remaining: number | null }): ("amount" | "overClaim" | "evidence")[] {
  const out: ("amount" | "overClaim" | "evidence")[] = [];
  if (!c.amount || c.amount < 1) out.push("amount");
  else if (c.remaining !== null && c.amount > c.remaining) out.push("overClaim");
  if (c.evidence < 1) out.push("evidence");
  return out;
}

/** Statuses in which the contractor's side may still change a claim. Paid, rejected and withdrawn are final. */
export const EDITABLE_CLAIMS: readonly ClaimStatus[] = ["draft", "changes_requested", "submitted", "approved"];
/** Editing in these statuses sends the next revision at once (and cancels an approval). */
export const RESENT_ON_EDIT: readonly ClaimStatus[] = ["submitted", "approved"];
