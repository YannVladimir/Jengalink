import {
  bigint,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { claims } from './claims';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { users } from './users';

export const paymentMethod = pgEnum('payment_method', [
  'mtn_momo',
  'airtel_money',
  'bank_transfer',
  'cash',
]);

/** Which side recorded it: verification must come from the other side, or from finance. */
export const paymentSide = pgEnum('payment_side', [
  'client',
  'contractor',
  'finance',
]);

export const paymentStatus = pgEnum('payment_status', [
  /** Recorded with evidence; not cash paid until someone independent confirms it (spec §6.6). */
  'pending_verification',
  /** Confirmed: counts as cash paid. */
  'settled',
  /** The other side says it did not arrive, or the evidence does not match. */
  'disputed',
  /** Withdrawn by whoever recorded it, before verification. */
  'cancelled',
]);

/**
 * A payment made outside JengaLink (MoMo, bank, cash), recorded with evidence (spec §6.6, A0).
 * JengaLink moves no money: a payment is cash paid only once settled. It pays an approved claim,
 * or nothing yet (an advance). It never changes posted cost.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    ...projectScope,
    /** "P-2026-0001": per organization. */
    number: text().notNull(),
    status: paymentStatus().notNull().default('pending_verification'),
    claimId: uuid().references(() => claims.id),
    payer: text().notNull(),
    beneficiary: text().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    currency: text().notNull().default('RWF'),
    method: paymentMethod().notNull(),
    /** The transaction ID, bank reference or cash receipt number. */
    reference: text(),
    paymentDate: date().notNull(),
    note: text(),
    recordedSide: paymentSide().notNull(),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: timestamp({ withTimezone: true }),
    verificationNote: text(),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'payments_project_fk'),
    unique('payments_org_number_unique').on(t.organizationId, t.number),
    index('payments_project_idx').on(t.projectId, t.createdAt),
    index('payments_claim_idx').on(t.claimId),
    index('payments_reference_idx').on(t.organizationId, t.method, t.reference),
  ],
);
