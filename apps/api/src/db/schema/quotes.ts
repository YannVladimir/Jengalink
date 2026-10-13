import {
  bigint,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { users } from './users';

export const quoteStatus = pgEnum('quote_status', [
  'draft',
  'sent',
  'accepted',
  'declined',
  'withdrawn',
]);

/**
 * A work package: what the owner pays for, optionally tied to a plan stage (spec §37.1).
 * `fixed`: `amount` is the agreed price. `reimbursable`: the owner pays actual cost plus
 * `feeBasisPoints` (1000 = 10%), and `amount` is the estimate including the fee.
 */
export type QuoteMilestone = {
  name: string;
  description: string | null;
  amount: number;
  stageId: string | null;
  basis?: 'fixed' | 'reimbursable';
  feeBasisPoints?: number | null;
};

/**
 * A quotation from the contractor to the owner (spec §37.1). The quote keeps its
 * number; its content lives in revisions. A sent revision never changes: editing
 * afterwards starts a new draft revision (the owner accepts an exact revision).
 */
export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    ...projectScope,
    /** "Q-2026-0007": per organization, for people to quote back. */
    number: text().notNull(),
    status: quoteStatus().notNull().default('draft'),
    /** The latest revision (a draft being edited, or the last one sent). */
    currentRevision: integer().notNull().default(1),
    /** The owner's decision: which revision, who, when, and an optional note (decline reason). */
    decidedRevisionNo: integer(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'quotes_project_fk'),
    unique('quotes_org_number_unique').on(t.organizationId, t.number),
    index('quotes_project_idx').on(t.projectId),
  ],
);

export const quoteRevisions = pgTable(
  'quote_revisions',
  {
    id: id(),
    quoteId: uuid()
      .notNull()
      .references(() => quotes.id),
    /** 1, 2, 3… (the quote's revision number; `revision` below is the row version). */
    revisionNo: integer().notNull(),
    title: text().notNull(),
    scope: text().notNull(),
    exclusions: jsonb().$type<string[]>().notNull().default([]),
    milestones: jsonb().$type<QuoteMilestone[]>().notNull(),
    /** Payment terms and other conditions, in the contractor's words. */
    terms: text(),
    currency: char({ length: 3 }).notNull().default('RWF'),
    total: bigint({ mode: 'number' }).notNull(),
    validUntil: date().notNull(),
    /** Set when sent; a sent revision is frozen. */
    sentAt: timestamp({ withTimezone: true }),
    sentBy: uuid().references(() => users.id),
    ...auditColumns,
  },
  (t) => [unique('quote_revisions_unique').on(t.quoteId, t.revisionNo)],
);

/**
 * The agreed commercial basis of a project, versioned (spec §37.1, §13.3): created when the
 * owner accepts an exact quote revision, with a full copy of what was accepted. Append-only.
 * The project's contract value follows the latest version.
 */
export const agreements = pgTable(
  'agreements',
  {
    id: id(),
    ...projectScope,
    version: integer().notNull(),
    quoteId: uuid()
      .notNull()
      .references(() => quotes.id),
    quoteNumber: text().notNull(),
    quoteRevisionNo: integer().notNull(),
    title: text().notNull(),
    scope: text().notNull(),
    exclusions: jsonb().$type<string[]>().notNull(),
    milestones: jsonb().$type<QuoteMilestone[]>().notNull(),
    terms: text(),
    currency: char({ length: 3 }).notNull(),
    contractValue: bigint({ mode: 'number' }).notNull(),
    acceptedBy: uuid()
      .notNull()
      .references(() => users.id),
    /** Set when this version came from an approved budget change (not a quote acceptance). */
    changeId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'agreements_project_fk'),
    unique('agreements_project_version_unique').on(t.projectId, t.version),
  ],
);

/**
 * The contractor's own expected delivery cost per work package (index-aligned with the
 * revision's milestones). Private to the contractor's company: never returned to the owner,
 * never in the PDF or the agreement copy (spec §37.1).
 */
export const quoteInternalCosts = pgTable('quote_internal_costs', {
  id: id(),
  organizationId: uuid().notNull(),
  quoteRevisionId: uuid()
    .notNull()
    .unique()
    .references(() => quoteRevisions.id, { onDelete: 'cascade' }),
  costs: jsonb().$type<(number | null)[]>().notNull(),
  ...auditColumns,
});
