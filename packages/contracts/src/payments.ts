// External payment records (spec §6.6, A0): money moved outside JengaLink (MoMo, bank, cash),
// recorded with evidence, cash paid only once someone independent confirms it.
import { z } from "zod";
import { ClaimFile, ClaimFileInput } from "./claims";

export const MAX_PAYMENT_FILES = 5;
export const PaymentMethod = z.enum(["mtn_momo", "airtel_money", "bank_transfer", "cash"]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;
/** pending_verification → settled (cash paid) or disputed; cancelled by whoever recorded it. */
export const PaymentStatus = z.enum(["pending_verification", "settled", "disputed", "cancelled"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** POST /v1/projects/:id/payments (Idempotency-Key): what was paid, how, and the proof. */
export const RecordPaymentRequest = z
  .object({
    /** The approved claim it pays; none = an advance. */
    claimId: z.uuid().nullable().optional(),
    payer: z.string().trim().min(2).max(120),
    beneficiary: z.string().trim().min(2).max(120),
    amount: z.number().int().min(1).max(1_000_000_000_000),
    method: PaymentMethod,
    /** Transaction ID or bank reference (required except for cash). */
    reference: z.string().trim().max(80).nullable().optional(),
    paymentDate: z.iso.date(),
    note: z.string().trim().max(500).nullable().optional(),
    /** Proof: MoMo screenshot, bank slip, cash receipt. */
    files: z.array(ClaimFileInput).max(MAX_PAYMENT_FILES).default([]),
  })
  .refine((p) => p.method === "cash" || (p.reference ?? "").length >= 3, {
    message: "Enter the transaction or bank reference",
    path: ["reference"],
  })
  .meta({ id: "RecordPaymentRequest" });
export type RecordPaymentRequest = z.input<typeof RecordPaymentRequest>;

/** POST …/payments/:paymentId/verify (If-Match): the other side, or finance, confirms or disputes. */
export const VerifyPaymentRequest = z
  .object({
    decision: z.enum(["settle", "dispute"]),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.decision === "settle" || (v.note ?? "").length >= 3, {
    message: "Say what is wrong",
    path: ["note"],
  })
  .meta({ id: "VerifyPaymentRequest" });
export type VerifyPaymentRequest = z.input<typeof VerifyPaymentRequest>;

export const PaymentView = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: PaymentStatus,
    claimId: z.uuid().nullable(),
    claimNumber: z.string().nullable(),
    payer: z.string(),
    beneficiary: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    method: PaymentMethod,
    reference: z.string().nullable(),
    paymentDate: z.iso.date(),
    note: z.string().nullable(),
    files: z.array(ClaimFile),
    /** Other payments with the same method and reference: a possible double entry. */
    sameReference: z.array(z.string()),
    recordedByName: z.string().nullable(),
    recordedAt: z.iso.datetime({ offset: true }),
    verifiedByName: z.string().nullable(),
    verifiedAt: z.iso.datetime({ offset: true }).nullable(),
    verificationNote: z.string().nullable(),
    canVerify: z.boolean(),
    canCancel: z.boolean(),
    /** For If-Match. */
    version: z.number().int(),
  })
  .meta({ id: "PaymentView" });
export type PaymentView = z.infer<typeof PaymentView>;

/** An approved claim and what is paid on it. */
export const PayableClaim = z
  .object({
    claimId: z.uuid(),
    number: z.string(),
    milestoneName: z.string(),
    amount: z.number().int(),
    /** Settled payments. */
    paid: z.number().int(),
    /** Recorded, waiting for verification. */
    pending: z.number().int(),
    /** amount − paid − pending: the most a new payment can be. */
    open: z.number().int(),
  })
  .meta({ id: "PayableClaim" });
export type PayableClaim = z.infer<typeof PayableClaim>;

/** GET /v1/projects/:id/payments — cash paid, waiting, owed, and every payment newest first. */
export const PaymentsOverview = z
  .object({
    currency: z.string(),
    /** Settled payments only (spec §6.2 "cash paid"). */
    cashPaid: z.number().int(),
    pendingVerification: z.number().int(),
    /** Approved claims not yet paid in full. */
    owedOnClaims: z.number().int(),
    payable: z.array(PayableClaim),
    payments: z.array(PaymentView),
    canRecord: z.boolean(),
  })
  .meta({ id: "PaymentsOverview" });
export type PaymentsOverview = z.infer<typeof PaymentsOverview>;
