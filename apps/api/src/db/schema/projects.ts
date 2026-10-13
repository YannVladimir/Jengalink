import {
  type AnyPgColumn,
  bigint,
  char,
  foreignKey,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

// Spec §18: Draft, Active, Handover, Archived; branches Paused or Cancelled.
export const projectStatus = pgEnum('project_status', [
  'draft',
  'active',
  'handover',
  'archived',
  'paused',
  'cancelled',
]);

// Spec §5.2 templates: house, renovation, apartment building, commercial building, small civil project.
export const projectType = pgEnum('project_type', [
  'house',
  'renovation',
  'apartment',
  'commercial',
  'civil',
]);

/** Rwanda entry uses province → village, but nothing here hard-codes Rwanda (spec §5.1). */
export type ProjectLocation = {
  province?: string;
  district?: string;
  sector?: string;
  cell?: string;
  village?: string;
};

export const projects = pgTable(
  'projects',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    ownerUserId: uuid().references(() => users.id),
    name: text().notNull(),
    type: projectType().notNull().default('house'),
    currency: char({ length: 3 }).notNull().default('RWF'),
    timezone: text().notNull().default('Africa/Kigali'),
    countryCode: char({ length: 2 }).notNull().default('RW'),
    location: jsonb().$type<ProjectLocation>().notNull().default({}),
    /** Agreed contract value in whole units of `currency` (RWF has no minor unit). The owner accepts it in Phase 3. */
    contractValue: bigint({ mode: 'number' }),
    status: projectStatus().notNull().default('draft'),
    ...auditColumns,
  },
  // Target for the composite FK every project record uses.
  (t) => [unique('projects_org_id_unique').on(t.organizationId, t.id)],
);

/** Composite FK: (organization_id, project_id) must match one project. */
export const projectFk = (
  t: { organizationId: AnyPgColumn; projectId: AnyPgColumn },
  name: string,
) =>
  foreignKey({
    name,
    columns: [t.organizationId, t.projectId],
    foreignColumns: [projects.organizationId, projects.id],
  });
