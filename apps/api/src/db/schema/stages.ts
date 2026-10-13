import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { users } from './users';

// Spec §5.3: reported progress is separate from accepted progress; a stage at
// 100% waits in ready_for_review until the owner accepts it.
export const stageStatus = pgEnum('stage_status', [
  'not_started',
  'in_progress',
  'ready_for_review',
  'accepted',
  // The owner asked for changes; the contractor fixes and submits again (spec §13.2).
  'changes_required',
]);

/** A stage of the work. Weights across a project total 100 (spec §5.3, §17.2). */
export const stages = pgTable(
  'stages',
  {
    id: id(),
    ...projectScope,
    name: text().notNull(),
    position: integer().notNull(),
    weight: integer().notNull(),
    description: text(),
    plannedStart: date(),
    plannedEnd: date(),
    /** Measurable completion criteria the owner checks before accepting (spec §5.2, §13.2). */
    criteria: jsonb().$type<string[]>().notNull().default([]),
    status: stageStatus().notNull().default('not_started'),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'stages_project_fk'),
    index('stages_project_idx').on(t.projectId, t.position),
    check('stages_weight_range', sql`${t.weight} between 0 and 100`),
    check(
      'stages_planned_order',
      sql`${t.plannedEnd} is null or ${t.plannedStart} is null or ${t.plannedEnd} >= ${t.plannedStart}`,
    ),
  ],
);

export const stageReviewKind = pgEnum('stage_review_kind', [
  'submitted',
  'accepted',
  'changes_requested',
]);

/**
 * The review history of a stage (spec §13.2): submissions for review and the owner's
 * decisions, each tied to the exact stage revision. Append-only (a trigger rejects edits).
 */
export const stageReviews = pgTable(
  'stage_reviews',
  {
    id: id(),
    ...projectScope,
    stageId: uuid()
      .notNull()
      .references(() => stages.id),
    kind: stageReviewKind().notNull(),
    note: text(),
    /** The stage revision this applies to (an acceptance names the exact version reviewed). */
    stageRevision: integer().notNull(),
    /** The checks as they stood, so an acceptance records what was agreed. */
    criteria: jsonb().$type<string[]>().notNull(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'stage_reviews_project_fk'),
    index('stage_reviews_stage_idx').on(t.stageId, t.createdAt),
  ],
);
