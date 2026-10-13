import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, projectScope } from './columns';
import { otpChannel } from './auth';
import { organizations } from './organizations';
import { projectFk } from './projects';
import { users } from './users';

export const membershipStatus = pgEnum('membership_status', [
  'active',
  'revoked',
]);

export const organizationRole = pgEnum('organization_role', [
  'admin',
  'member',
]);

/** Spec §3.2. One user may hold several project roles. */
export const projectRole = pgEnum('project_role', [
  'owner',
  'delegate',
  'manager',
  'contractor',
  'supervisor',
  'finance',
  'inspector',
  'supplier',
  'viewer',
]);

/** Membership of a company or household workspace. Grants no project access by itself (spec §3.1). */
export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: organizationRole().notNull(),
    status: membershipStatus().notNull().default('active'),
    revokedAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    // Unique active user membership per organization (spec §17.2).
    uniqueIndex('organization_memberships_active_unique')
      .on(t.organizationId, t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/** Explicit project access. Checked on every request; revocation is immediate (spec §3.3). */
export const projectMemberships = pgTable(
  'project_memberships',
  {
    id: id(),
    ...projectScope,
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: projectRole().notNull(),
    /** Viewers and others see money only when this is granted (spec §3.2). */
    financialVisibility: boolean().notNull().default(false),
    status: membershipStatus().notNull().default('active'),
    expiresAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => users.id),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'project_memberships_project_fk'),
    uniqueIndex('project_memberships_active_unique')
      .on(t.projectId, t.userId, t.role)
      .where(sql`${t.status} = 'active'`),
    index('project_memberships_user_idx').on(t.userId),
  ],
);

export const invitationScope = pgEnum('invitation_scope', [
  'organization',
  'project',
]);

/**
 * An invitation bound to the phone or email the recipient must verify (spec §3.3).
 * Expires after 7 days; single use. Only a hash of the link token is stored.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    scope: invitationScope().notNull(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    /** Set for project invitations; with organization_id it must match one project. */
    projectId: uuid(),
    /** organization_role or project_role value, validated by scope in the service. */
    role: text().notNull(),
    financialVisibility: boolean().notNull().default(false),
    channel: otpChannel().notNull(),
    /** E.164 phone or lower-cased email. */
    recipient: text().notNull(),
    tokenHash: text().notNull().unique('invitations_token_hash_unique'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedBy: uuid().references(() => users.id),
    declinedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    // Composite FK (MATCH SIMPLE): enforced whenever project_id is set.
    projectFk(t, 'invitations_project_fk'),
    index('invitations_recipient_idx').on(t.recipient),
    index('invitations_org_idx').on(t.organizationId),
  ],
);
