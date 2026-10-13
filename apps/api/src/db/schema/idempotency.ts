import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id } from './columns';
import { users } from './users';

export const idempotencyState = pgEnum('idempotency_state', [
  'in_progress',
  'completed',
]);

/**
 * Remembers the outcome of a write sent with an Idempotency-Key (spec §19.1),
 * so a retry returns the original result instead of acting twice. Scoped to
 * actor + method + path (the path carries the project id). Kept 7 days.
 */
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: id(),
    actorUserId: uuid()
      .notNull()
      .references(() => users.id),
    /** "POST /v1/projects/<id>/invitations" */
    scope: text().notNull(),
    key: text().notNull(),
    bodyHash: text().notNull(),
    state: idempotencyState().notNull().default('in_progress'),
    responseStatus: integer(),
    responseBody: jsonb(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('idempotency_records_actor_scope_key_unique').on(
      t.actorUserId,
      t.scope,
      t.key,
    ),
    index('idempotency_records_expires_idx').on(t.expiresAt),
  ],
);
