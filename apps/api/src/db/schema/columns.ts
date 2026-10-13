import { sql } from 'drizzle-orm';
import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';

// Shared conventions (spec §17.1): UUID keys; mutable records carry
// created_at, updated_at, created_by and an integer revision.

export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

export const auditColumns = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid(),
  revision: integer().notNull().default(1),
};

/**
 * Columns every project record carries (spec §16.3). Tables using these must
 * also add `projectFk(t)` so a row can never point into another organization's project.
 */
export const projectScope = {
  organizationId: uuid().notNull(),
  projectId: uuid().notNull(),
};
