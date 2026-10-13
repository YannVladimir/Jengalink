import {
  bigint,
  boolean,
  jsonb,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { agreements } from './quotes';
import { siteUpdates } from './site-updates';
import { users } from './users';

export const claimStatus = pgEnum('claim_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'changes_requested',
  'paid',
  'cancelled',
]);

/**
 * A payment claim (spec §8): the contractor asks to be paid for an agreed milestone, with
 * evidence. A record only: the owner pays outside JengaLink. The milestone is copied from the
 * agreement version it was claimed under.
 */
export const claims = pgTable(
  'claims',
  {
    id: id(),
    ...projectScope,
    /** "C-2026-0003": per organization, for people to quote back. */
    number: text().notNull(),
    status: claimStatus().notNull().default('draft'),
    agreementId: uuid()
      .notNull()
      .references(() => agreements.id),
    milestoneIndex: integer().notNull(),
    milestoneName: text().notNull(),
    milestoneAmount: bigint({ mode: 'number' }).notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    note: text(),
    /** The last revision sent to the owner (0 = never sent). */
    revisionNo: integer().notNull().default(0),
    submittedAt: timestamp({ withTimezone: true }),
    submittedBy: uuid().references(() => users.id),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'claims_project_fk'),
    unique('claims_org_number_unique').on(t.organizationId, t.number),
    index('claims_project_idx').on(t.projectId, t.createdAt),
  ],
);

/** Site updates offered as evidence for a claim. */
export const claimUpdates = pgTable(
  'claim_updates',
  {
    id: id(),
    claimId: uuid()
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    siteUpdateId: uuid()
      .notNull()
      .references(() => siteUpdates.id),
    ...auditColumns,
  },
  (t) => [unique('claim_updates_pair_unique').on(t.claimId, t.siteUpdateId)],
);

export const claimDecisionKind = pgEnum('claim_decision_kind', [
  'approved',
  'rejected',
  'changes_requested',
]);

/**
 * The owner's answers to a claim (spec §37.1), append-only: who, when, on which version and
 * for which amount. Approving does not pay; the payment is recorded later.
 */
export const claimDecisions = pgTable(
  'claim_decisions',
  {
    id: id(),
    ...projectScope,
    claimId: uuid()
      .notNull()
      .references(() => claims.id),
    kind: claimDecisionKind().notNull(),
    /** The amount the owner saw and answered. */
    amount: bigint({ mode: 'number' }).notNull(),
    /** The claim version answered (If-Match). */
    claimRevision: integer().notNull(),
    /** The sent revision answered: a later revision cancels this answer. */
    revisionNo: integer().notNull().default(1),
    note: text(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'claim_decisions_project_fk'),
    index('claim_decisions_claim_idx').on(t.claimId, t.createdAt),
  ],
);

/**
 * What the owner was sent, frozen per revision (spec §41): editing a sent claim creates the next
 * revision and cancels an earlier approval. Append-only.
 */
export const claimRevisions = pgTable(
  'claim_revisions',
  {
    id: id(),
    ...projectScope,
    claimId: uuid()
      .notNull()
      .references(() => claims.id),
    revisionNo: integer().notNull(),
    agreementId: uuid()
      .notNull()
      .references(() => agreements.id),
    milestoneIndex: integer().notNull(),
    milestoneName: text().notNull(),
    milestoneAmount: bigint({ mode: 'number' }).notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    note: text(),
    siteUpdateIds: jsonb().$type<string[]>().notNull(),
    fileIds: jsonb().$type<string[]>().notNull(),
    /** Why the contractor changed a claim already sent (revision 2 and later). */
    changeNote: text(),
    /** This revision cancelled an approval of the one before. */
    cancelledApproval: boolean().notNull().default(false),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'claim_revisions_project_fk'),
    unique('claim_revisions_claim_no_unique').on(t.claimId, t.revisionNo),
  ],
);
