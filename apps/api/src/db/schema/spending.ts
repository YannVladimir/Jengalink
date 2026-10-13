import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { agreements } from './quotes';
import { stages } from './stages';
import { users } from './users';

export const spendingStatus = pgEnum('spending_status', [
  'draft',
  'submitted',
  'approved',
  'changes_requested',
  'rejected',
  'withdrawn',
  'closed',
]);

/** One priced line of a request: quantity is a decimal string (thousandths), amounts in RWF. */
export interface SpendingLine {
  description: string;
  quantity: string;
  unit: string;
  unitRate: number;
  amount: number;
}

/**
 * A spending request on a cost + fee package (spec §6.4, §19.3): what the contractor wants to
 * buy, for how much. Approval reserves budget; it does not post cost or pay anyone.
 */
export const spendingRequests = pgTable(
  'spending_requests',
  {
    id: id(),
    ...projectScope,
    /** "SR-2026-0001": per organization. */
    number: text().notNull(),
    status: spendingStatus().notNull().default('draft'),
    agreementId: uuid()
      .notNull()
      .references(() => agreements.id),
    /** The budget line: a reimbursable package of the agreement, by position and name. */
    milestoneIndex: integer().notNull(),
    milestoneName: text().notNull(),
    stageId: uuid().references(() => stages.id),
    purpose: text().notNull(),
    requiredDate: date(),
    lines: jsonb().$type<SpendingLine[]>().notNull(),
    /** Gross total, recalculated by the server from the lines. */
    amount: bigint({ mode: 'number' }).notNull(),
    submittedAt: timestamp({ withTimezone: true }),
    submittedBy: uuid().references(() => users.id),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'spending_requests_project_fk'),
    unique('spending_requests_org_number_unique').on(
      t.organizationId,
      t.number,
    ),
    index('spending_requests_project_idx').on(t.projectId, t.createdAt),
  ],
);

export const spendingDecisionKind = pgEnum('spending_decision_kind', [
  'approved',
  'rejected',
  'changes_requested',
]);

/** The owner's answers to a request (append-only), on the exact version and amount. */
export const spendingDecisions = pgTable(
  'spending_decisions',
  {
    id: id(),
    ...projectScope,
    requestId: uuid()
      .notNull()
      .references(() => spendingRequests.id),
    kind: spendingDecisionKind().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    requestRevision: integer().notNull(),
    note: text(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'spending_decisions_project_fk'),
    index('spending_decisions_request_idx').on(t.requestId, t.createdAt),
  ],
);

/**
 * A direct expense against an approved request (spec §6.5, A0): actual cost, posted. Posting
 * converts that much of the request's reservation into cost; it records no payment.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    ...projectScope,
    number: text().notNull(),
    requestId: uuid()
      .notNull()
      .references(() => spendingRequests.id),
    description: text().notNull(),
    supplierName: text(),
    expenseDate: date().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'expenses_project_fk'),
    unique('expenses_org_number_unique').on(t.organizationId, t.number),
    index('expenses_request_idx').on(t.requestId, t.createdAt),
  ],
);

export const budgetMovementKind = pgEnum('budget_movement_kind', [
  /** Approval reserved budget for the request. */
  'reserve',
  /** A posted expense turned part of the reservation into cost. */
  'convert',
  /** Closing or withdrawing released what was left. */
  'release',
]);

/**
 * The budget ledger (spec §6.2, §17.1 "reservations"): append-only movements, so commitments and
 * headroom are always computed, never typed. Remaining commitment of a request =
 * reserve − convert − release; posted cost = the converts.
 */
export const budgetMovements = pgTable(
  'budget_movements',
  {
    id: id(),
    ...projectScope,
    requestId: uuid()
      .notNull()
      .references(() => spendingRequests.id),
    expenseId: uuid().references(() => expenses.id),
    /** The budget line: the package name (stable across agreement versions). */
    budgetLine: text().notNull(),
    kind: budgetMovementKind().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'budget_movements_project_fk'),
    index('budget_movements_line_idx').on(t.projectId, t.budgetLine),
    // A retried approval, expense or close can never move the budget twice.
    uniqueIndex('budget_movements_one_reserve')
      .on(t.requestId)
      .where(sql`kind = 'reserve'`),
    uniqueIndex('budget_movements_one_release')
      .on(t.requestId)
      .where(sql`kind = 'release'`),
    uniqueIndex('budget_movements_one_convert')
      .on(t.expenseId)
      .where(sql`kind = 'convert'`),
  ],
);

export const receiptStatus = pgEnum('receipt_status', [
  'captured',
  'manually_reviewed',
  /** Needs a supported RRA channel, a result reference and a time: not offered yet (spec §26.1). */
  'externally_confirmed',
  'discrepancy_found',
]);

/**
 * The supplier's receipt for an expense (spec §26.1): EBM fields as written on it, the original
 * file and who reviewed it. Evidence collected, not verified: JengaLink issues no EBM invoice.
 * An expense without one is "not supplied" and shows as an exception.
 */
export const receipts = pgTable(
  'receipts',
  {
    id: id(),
    ...projectScope,
    expenseId: uuid()
      .notNull()
      .unique()
      .references(() => expenses.id),
    status: receiptStatus().notNull().default('captured'),
    supplierName: text().notNull(),
    supplierTin: text(),
    buyerTin: text(),
    invoiceNumber: text().notNull(),
    invoiceDate: date().notNull(),
    total: bigint({ mode: 'number' }).notNull(),
    vatAmount: bigint({ mode: 'number' }),
    /** EBM identifiers as printed (SDC ID, receipt signature…). */
    ebmReference: text(),
    /** The QR code's text, if typed or scanned: never treated as confirmation. */
    qrPayload: text(),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewNote: text(),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'receipts_project_fk'),
    index('receipts_invoice_idx').on(
      t.organizationId,
      t.supplierTin,
      t.invoiceNumber,
    ),
  ],
);
