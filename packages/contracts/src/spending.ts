// Spending requests on cost + fee packages (spec §6.2–6.5, §19.3, A0): approval reserves budget,
// a posted direct expense turns the reservation into cost, closing releases the rest.
import { z } from "zod";
import { ClaimFile, ClaimFileInput, ClaimFileType, MAX_CLAIM_FILE_BYTES } from "./claims";

export const MAX_SPENDING_LINES = 50;
export const MAX_SPENDING_FILES = 10;
export const MAX_LINE_AMOUNT = 1_000_000_000_000;
/** Quotations and evidence: photos or PDFs, the same rules as claim files. */
export const SpendingFileType = ClaimFileType;
export const MAX_SPENDING_FILE_BYTES = MAX_CLAIM_FILE_BYTES;
/** A file on a request: same shape as on a claim. */
export const AttachedFile = ClaimFile;
export type AttachedFile = ClaimFile;

/** Quantity as text with up to 3 decimals ("40", "12.5"): never a binary float (spec §6.1). */
export const Quantity = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, "Up to 3 decimals")
  .refine((q) => Number(q) > 0, "More than zero");

export const SpendingLineInput = z
  .object({
    description: z.string().trim().min(2).max(200),
    quantity: Quantity,
    unit: z.string().trim().min(1).max(20),
    /** Price per unit in RWF (gross). */
    unitRate: z.number().int().min(1).max(1_000_000_000),
  })
  // Keeps every total an exact integer (well inside 2^53).
  .refine((l) => lineAmount(l.quantity, l.unitRate) <= MAX_LINE_AMOUNT, {
    message: "A line can be at most 1,000,000,000,000",
    path: ["unitRate"],
  })
  .meta({ id: "SpendingLineInput" });
export type SpendingLineInput = z.infer<typeof SpendingLineInput>;

/** quantity × rate, rounded to the franc, in integer arithmetic. */
export function lineAmount(quantity: string, unitRate: number): number {
  const [whole, frac = ""] = quantity.trim().split(".");
  const milli = BigInt(whole || "0") * 1000n + BigInt((frac + "000").slice(0, 3));
  return Number((milli * BigInt(unitRate) + 500n) / 1000n);
}

/** Sum of rounded lines (spec §6.1: round each line, then add). */
export const spendingTotal = (lines: { quantity: string; unitRate: number }[]) =>
  lines.reduce((t, l) => t + lineAmount(l.quantity, l.unitRate), 0);

/** The cost budget of a cost + fee package: its estimate without the fee. */
export const costBudgetOf = (estimate: number, feePercent: number | null) =>
  Math.round((estimate * 1000) / (1000 + Math.round((feePercent ?? 0) * 10)));

/** POST /v1/projects/:id/spending and PUT …/spending/:requestId (drafts and requests sent back). */
export const SaveSpendingRequest = z
  .object({
    /** A cost + fee package of the current agreement. */
    milestoneIndex: z.number().int().min(0).max(99),
    stageId: z.uuid().nullable().optional(),
    purpose: z.string().trim().min(3).max(300),
    requiredDate: z.iso.date().nullable().optional(),
    lines: z.array(SpendingLineInput).min(1).max(MAX_SPENDING_LINES),
    files: z.array(ClaimFileInput).max(MAX_SPENDING_FILES).default([]),
    removeFileIds: z.array(z.uuid()).max(MAX_SPENDING_FILES).default([]),
  })
  .meta({ id: "SaveSpendingRequest" });
export type SaveSpendingRequest = z.input<typeof SaveSpendingRequest>;

export const SpendingStatus = z.enum(["draft", "submitted", "approved", "changes_requested", "rejected", "withdrawn", "closed"]);
export type SpendingStatus = z.infer<typeof SpendingStatus>;

/** A cost + fee package as a budget line (spec §6.2 definitions, computed from the ledger). */
export const BudgetLine = z
  .object({
    index: z.number().int(),
    name: z.string(),
    feePercent: z.number().nullable(),
    /** The agreed estimate, fee included. */
    estimate: z.number().int(),
    /** The estimate without the fee: what spending is measured against. */
    costBudget: z.number().int(),
    /** Requests sent and waiting for an answer (not committed). */
    pending: z.number().int(),
    /** Approved reservations not yet turned into cost. */
    committed: z.number().int(),
    /** Posted direct expenses. */
    posted: z.number().int(),
    /** costBudget − posted − committed. */
    headroom: z.number().int(),
  })
  .meta({ id: "BudgetLine" });
export type BudgetLine = z.infer<typeof BudgetLine>;

/** GET /v1/projects/:id/budget — the cost + fee lines of the current agreement. */
export const ProjectBudget = z
  .object({
    agreementVersion: z.number().int().nullable(),
    currency: z.string(),
    lines: z.array(BudgetLine),
  })
  .meta({ id: "ProjectBudget" });
export type ProjectBudget = z.infer<typeof ProjectBudget>;

export const SpendingLine = z
  .object({
    description: z.string(),
    quantity: z.string(),
    unit: z.string(),
    unitRate: z.number().int(),
    amount: z.number().int(),
  })
  .meta({ id: "SpendingLine" });
export type SpendingLine = z.infer<typeof SpendingLine>;

export const SpendingDecisionRequest = z
  .object({
    decision: z.enum(["approve", "reject", "request_changes"]),
    /** The total shown on screen: approval fails if the request changed since. */
    amount: z.number().int().min(1),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((d) => d.decision === "approve" || (d.note ?? "").length >= 3, {
    message: "Say what is wrong or what should change",
    path: ["note"],
  })
  .meta({ id: "SpendingDecisionRequest" });
export type SpendingDecisionRequest = z.input<typeof SpendingDecisionRequest>;

export const SpendingDecision = z
  .object({
    kind: z.enum(["approved", "rejected", "changes_requested"]),
    amount: z.number().int(),
    note: z.string().nullable(),
    byName: z.string().nullable(),
    at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "SpendingDecision" });
export type SpendingDecision = z.infer<typeof SpendingDecision>;

/** POST …/spending/:requestId/expenses — a direct expense against an approved request (Idempotency-Key). */
export const PostExpenseRequest = z
  .object({
    description: z.string().trim().min(2).max(200),
    supplierName: z.string().trim().max(120).nullable().optional(),
    expenseDate: z.iso.date(),
    amount: z.number().int().min(1).max(1_000_000_000_000),
  })
  .meta({ id: "PostExpenseRequest" });
export type PostExpenseRequest = z.input<typeof PostExpenseRequest>;

/** Rwanda TIN: 9 digits. */
export const Tin = z.string().trim().regex(/^\d{9}$/, "9 digits");

/**
 * Receipt states (spec §26.1). "Not supplied" is an expense without a receipt. "Externally
 * confirmed" needs a supported RRA channel, a result reference and a time: not offered yet.
 */
export const ReceiptStatus = z.enum(["captured", "manually_reviewed", "externally_confirmed", "discrepancy_found"]);
export type ReceiptStatus = z.infer<typeof ReceiptStatus>;
export const ExpenseReceiptStatus = z.enum(["not_supplied", ...ReceiptStatus.options]);
export type ExpenseReceiptStatus = z.infer<typeof ExpenseReceiptStatus>;

/** PUT /v1/projects/:id/expenses/:expenseId/receipt — the supplier's receipt as written on it. */
export const SaveReceiptRequest = z
  .object({
    supplierName: z.string().trim().min(2).max(120),
    supplierTin: Tin.nullable().optional(),
    buyerTin: Tin.nullable().optional(),
    invoiceNumber: z.string().trim().min(1).max(60),
    invoiceDate: z.iso.date(),
    total: z.number().int().min(0).max(1_000_000_000_000),
    vatAmount: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
    /** EBM identifiers as printed (SDC ID, receipt signature…). */
    ebmReference: z.string().trim().max(120).nullable().optional(),
    /** The QR code's text: recorded, never treated as confirmation. */
    qrPayload: z.string().trim().max(2000).nullable().optional(),
    /** A new photo or PDF of the receipt (from receipt uploads); replaces the old one. */
    file: ClaimFileInput.nullable().optional(),
  })
  .refine((r) => r.vatAmount == null || r.vatAmount <= r.total, { message: "VAT cannot be more than the total", path: ["vatAmount"] })
  .meta({ id: "SaveReceiptRequest" });
export type SaveReceiptRequest = z.input<typeof SaveReceiptRequest>;

/** POST …/receipt/review — an independent reviewer's manual check (not the person who captured it). */
export const ReviewReceiptRequest = z
  .object({
    status: z.enum(["manually_reviewed", "discrepancy_found"]),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((r) => r.status === "manually_reviewed" || (r.note ?? "").length >= 3, { message: "Say what does not match", path: ["note"] })
  .meta({ id: "ReviewReceiptRequest" });
export type ReviewReceiptRequest = z.input<typeof ReviewReceiptRequest>;

/** Another expense that may be the same receipt: same supplier TIN and invoice number, or the same file. */
export const ReceiptDuplicate = z
  .object({
    kind: z.enum(["invoice", "file"]),
    expenseNumber: z.string(),
    projectName: z.string(),
  })
  .meta({ id: "ReceiptDuplicate" });
export type ReceiptDuplicate = z.infer<typeof ReceiptDuplicate>;

export const ReceiptView = z
  .object({
    id: z.uuid(),
    status: ReceiptStatus,
    supplierName: z.string(),
    supplierTin: z.string().nullable(),
    buyerTin: z.string().nullable(),
    invoiceNumber: z.string(),
    invoiceDate: z.iso.date(),
    total: z.number().int(),
    vatAmount: z.number().int().nullable(),
    ebmReference: z.string().nullable(),
    qrPayload: z.string().nullable(),
    file: ClaimFile.nullable(),
    /** The receipt total equals the expense amount. */
    totalMatches: z.boolean(),
    duplicates: z.array(ReceiptDuplicate),
    capturedByName: z.string().nullable(),
    capturedAt: z.iso.datetime({ offset: true }),
    reviewedByName: z.string().nullable(),
    reviewedAt: z.iso.datetime({ offset: true }).nullable(),
    reviewNote: z.string().nullable(),
    canEdit: z.boolean(),
    canReview: z.boolean(),
    /** For If-Match. */
    version: z.number().int(),
  })
  .meta({ id: "ReceiptView" });
export type ReceiptView = z.infer<typeof ReceiptView>;

export const ExpenseView = z
  .object({
    id: z.uuid(),
    number: z.string(),
    description: z.string(),
    supplierName: z.string().nullable(),
    expenseDate: z.iso.date(),
    amount: z.number().int(),
    byName: z.string().nullable(),
    at: z.iso.datetime({ offset: true }),
    receiptStatus: ExpenseReceiptStatus,
    receipt: ReceiptView.nullable(),
    /** The caller may attach the receipt now. */
    canAddReceipt: z.boolean(),
  })
  .meta({ id: "ExpenseView" });
export type ExpenseView = z.infer<typeof ExpenseView>;

export const SpendingSummary = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: SpendingStatus,
    milestoneName: z.string(),
    purpose: z.string(),
    amount: z.number().int(),
    /** Still reserved (approved, not yet spent). */
    committed: z.number().int(),
    posted: z.number().int(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "SpendingSummary" });
export type SpendingSummary = z.infer<typeof SpendingSummary>;

export const SpendingView = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    projectName: z.string(),
    number: z.string(),
    status: SpendingStatus,
    milestoneIndex: z.number().int(),
    milestoneName: z.string(),
    agreementVersion: z.number().int(),
    stageId: z.uuid().nullable(),
    stageName: z.string().nullable(),
    purpose: z.string(),
    requiredDate: z.iso.date().nullable(),
    lines: z.array(SpendingLine),
    amount: z.number().int(),
    currency: z.string(),
    files: z.array(AttachedFile),
    /** The ledger for this request: reserved at approval, then posted, released, still committed. */
    reserved: z.number().int(),
    posted: z.number().int(),
    released: z.number().int(),
    committed: z.number().int(),
    expenses: z.array(ExpenseView),
    /** Expenses without a receipt: an exception that never hides (spec §6.5). */
    missingReceipts: z.number().int(),
    decisions: z.array(SpendingDecision),
    createdByName: z.string().nullable(),
    submittedAt: z.iso.datetime({ offset: true }).nullable(),
    canEdit: z.boolean(),
    canDecide: z.boolean(),
    canPostExpense: z.boolean(),
    /** Withdraw (not approved yet) or close (approved: releases what is left). */
    canWithdraw: z.boolean(),
    canClose: z.boolean(),
    /** For If-Match. */
    version: z.number().int(),
  })
  .meta({ id: "SpendingView" });
export type SpendingView = z.infer<typeof SpendingView>;
