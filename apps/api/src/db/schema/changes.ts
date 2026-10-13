import {
  bigint,
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
import { agreements } from './quotes';
import { users } from './users';

export const changeCategory = pgEnum('change_category', [
  'owner_request',
  'unforeseen_conditions',
  'specification_change',
  'quantity_correction',
]);

export const changeStatus = pgEnum('change_status', [
  'draft',
  'submitted',
  /** Approved and applied in one transaction: a new agreement version exists. */
  'applied',
  'rejected',
  'withdrawn',
]);

/** One line of a change: an existing package (by position) or a new one, and the amount to add (or remove). */
export interface ChangeLine {
  milestoneIndex: number | null;
  name: string;
  basis: 'fixed' | 'reimbursable';
  feeBasisPoints: number | null;
  delta: number;
}

/**
 * A budget change (spec §2 A0, §6.1, §7): deltas to named packages of the current agreement,
 * with a reason. The owner's approval applies it as the next agreement version; the approved
 * budget is never edited in place.
 */
export const budgetChanges = pgTable(
  'budget_changes',
  {
    id: id(),
    ...projectScope,
    /** "CH-2026-0001": per organization. */
    number: text().notNull(),
    status: changeStatus().notNull().default('draft'),
    /** The agreement version the deltas apply to. */
    baseAgreementId: uuid()
      .notNull()
      .references(() => agreements.id),
    category: changeCategory().notNull(),
    reason: text().notNull(),
    /** Days added to (or saved from) the schedule; null = no effect stated. */
    scheduleDays: integer(),
    lines: jsonb().$type<ChangeLine[]>().notNull(),
    netDelta: bigint({ mode: 'number' }).notNull(),
    submittedAt: timestamp({ withTimezone: true }),
    submittedBy: uuid().references(() => users.id),
    appliedAgreementId: uuid().references(() => agreements.id),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'budget_changes_project_fk'),
    unique('budget_changes_org_number_unique').on(t.organizationId, t.number),
    index('budget_changes_project_idx').on(t.projectId, t.createdAt),
  ],
);

export const changeDecisionKind = pgEnum('change_decision_kind', [
  'approved',
  'rejected',
]);

/** The owner's answers to a budget change (append-only). */
export const budgetChangeDecisions = pgTable(
  'budget_change_decisions',
  {
    id: id(),
    ...projectScope,
    changeId: uuid()
      .notNull()
      .references(() => budgetChanges.id),
    kind: changeDecisionKind().notNull(),
    netDelta: bigint({ mode: 'number' }).notNull(),
    changeRevision: integer().notNull(),
    note: text(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'budget_change_decisions_project_fk'),
    index('budget_change_decisions_change_idx').on(t.changeId, t.createdAt),
  ],
);
