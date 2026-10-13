import {
  bigint,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, projectScope } from './columns';
import { projectFk } from './projects';
import { users } from './users';

export const acceptanceDecision = pgEnum('acceptance_decision', [
  'accepted',
  'changes_requested',
]);

/** What the owner saw when deciding: the stages as they stood at that revision. */
export type AcceptedStage = {
  id: string;
  name: string;
  weight: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  criteria: string[];
};

/**
 * The owner's decisions on the project baseline (contract value + stage plan).
 * Append-only (a trigger rejects UPDATE and DELETE): an acceptance always points
 * at the exact revision and copy of the plan the owner saw (spec §13.2, §17).
 */
export const projectAcceptances = pgTable(
  'project_acceptances',
  {
    id: id(),
    ...projectScope,
    decision: acceptanceDecision().notNull(),
    note: text(),
    projectRevision: integer().notNull(),
    contractValue: bigint({ mode: 'number' }),
    currency: char({ length: 3 }).notNull(),
    stages: jsonb().$type<AcceptedStage[]>().notNull(),
    decidedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'project_acceptances_project_fk'),
    index('project_acceptances_project_idx').on(t.projectId, t.createdAt),
  ],
);
