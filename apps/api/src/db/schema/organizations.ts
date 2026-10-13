import { pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { auditColumns, id } from './columns';

export const organizationKind = pgEnum('organization_kind', [
  'household',
  'contractor',
  'developer',
  'supplier',
  'inspection',
]);

export const organizationStatus = pgEnum('organization_status', [
  'active',
  'suspended',
  'closed',
]);

export const organizations = pgTable('organizations', {
  id: id(),
  name: text().notNull(),
  kind: organizationKind().notNull(),
  status: organizationStatus().notNull().default('active'),
  ...auditColumns,
});
