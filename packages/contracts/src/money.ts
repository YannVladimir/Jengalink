// The Money screen (spec §4.4 "Money overview", §36.1): contract money computed from records,
// never typed in. Contractor internal costs never appear here (spec §37.3).
import { z } from "zod";
import { ClaimStatus } from "./claims";
import { PaymentMethod, PaymentStatus } from "./payments";

/** Whose money view this is: what the owner owes, or what the contractor is owed. */
export const MoneySide = z.enum(["client", "contractor", "finance"]);
export type MoneySide = z.infer<typeof MoneySide>;

/** Things waiting on the caller, each a link to where it is done. */
export const MoneyActions = z
  .object({
    claimsToDecide: z.number().int(),
    paymentsToConfirm: z.number().int(),
    spendingToDecide: z.number().int(),
    receiptsMissing: z.number().int(),
  })
  .meta({ id: "MoneyActions" });
export type MoneyActions = z.infer<typeof MoneyActions>;

/** The contract-bar figures, all computed from claims and confirmed payments. */
export const ContractFigures = z
  .object({
    /** The current agreement's value (0 before any agreement). */
    contract: z.number().int(),
    /** Confirmed payments on claims (cash paid). */
    paid: z.number().int(),
    /** Approved claims not yet paid in full. */
    approvedUnpaid: z.number().int(),
    /** Claims sent and waiting for the owner. */
    awaitingDecision: z.number().int(),
    /** contract − paid − approved, never below 0: what the contract bar shows (claims waiting for a decision are part of it). */
    stillToCome: z.number().int(),
    /** Recorded payments waiting for confirmation (not counted as paid). */
    pendingVerification: z.number().int(),
    /** Confirmed payments not tied to a claim. */
    advances: z.number().int(),
  })
  .meta({ id: "ContractFigures" });
export type ContractFigures = z.infer<typeof ContractFigures>;

/** A claim with the dates the step tracker needs. */
export const MoneyClaim = z
  .object({
    id: z.uuid(),
    number: z.string(),
    milestoneName: z.string(),
    amount: z.number().int(),
    status: ClaimStatus,
    paid: z.number().int(),
    requestedAt: z.iso.datetime({ offset: true }),
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
    paidAt: z.iso.datetime({ offset: true }).nullable(),
    /** A step with a problem: sent back or rejected at approval, or a disputed payment. */
    disputedStep: z.enum(["approved", "paid"]).nullable(),
  })
  .meta({ id: "MoneyClaim" });
export type MoneyClaim = z.infer<typeof MoneyClaim>;

export const MoneyPayment = z
  .object({
    id: z.uuid(),
    number: z.string(),
    amount: z.number().int(),
    method: PaymentMethod,
    status: PaymentStatus,
    claimNumber: z.string().nullable(),
    paymentDate: z.iso.date(),
  })
  .meta({ id: "MoneyPayment" });
export type MoneyPayment = z.infer<typeof MoneyPayment>;

/** GET /v1/projects/:id/money — one project's Money screen. */
export const ProjectMoney = z
  .object({
    projectId: z.uuid(),
    projectName: z.string(),
    currency: z.string(),
    side: MoneySide,
    figures: ContractFigures,
    /** Cost + fee packages (spending requests); null when the agreement has none. */
    spending: z.object({ costBudget: z.number().int(), posted: z.number().int(), committed: z.number().int() }).nullable(),
    claims: z.array(MoneyClaim),
    /** The latest payments (up to 5). */
    payments: z.array(MoneyPayment),
    actions: MoneyActions,
  })
  .meta({ id: "ProjectMoney" });
export type ProjectMoney = z.infer<typeof ProjectMoney>;

/** One row of the across-projects view. */
export const ProjectMoneyRow = z
  .object({
    projectId: z.uuid(),
    projectName: z.string(),
    organizationName: z.string(),
    side: MoneySide,
    figures: ContractFigures,
    actions: MoneyActions,
  })
  .meta({ id: "ProjectMoneyRow" });
export type ProjectMoneyRow = z.infer<typeof ProjectMoneyRow>;

/** GET /v1/money — amounts due across every project the caller can see money on. */
export const MoneyAcross = z
  .object({
    currency: z.string(),
    /** Approved, unpaid: owed to the caller (contractor side) or owed by them (client side). */
    owedToMe: z.number().int(),
    owedByMe: z.number().int(),
    awaitingDecision: z.number().int(),
    pendingVerification: z.number().int(),
    actions: MoneyActions,
    projects: z.array(ProjectMoneyRow),
  })
  .meta({ id: "MoneyAcross" });
export type MoneyAcross = z.infer<typeof MoneyAcross>;

/** contract − paid − approved, never below zero: the same "still to come" as the contract bar. */
export const stillToCome = (f: { contract: number; paid: number; approvedUnpaid: number }) => Math.max(0, f.contract - f.paid - f.approvedUnpaid);

/** Total of things waiting on the caller. */
export const actionCount = (a: MoneyActions) => a.claimsToDecide + a.paymentsToConfirm + a.spendingToDecide + a.receiptsMissing;
