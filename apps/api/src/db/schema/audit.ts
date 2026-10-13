import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { projectFk } from './projects';
import { users } from './users';

/**
 * Audit trail (spec §17.5, §21): who did what, when, from where. Append-only:
 * a database trigger rejects UPDATE and DELETE. Metadata holds safe fields only,
 * never codes, tokens or full contact details.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    /** e.g. auth.signed_in, invitation.accepted, member.removed */
    action: text().notNull(),
    actorUserId: uuid().references(() => users.id),
    actorSessionId: uuid(),
    organizationId: uuid().references(() => organizations.id),
    projectId: uuid(),
    targetType: text(),
    targetId: uuid(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    projectFk(t, 'audit_events_project_fk'),
    index('audit_events_project_idx').on(t.projectId, t.createdAt),
    index('audit_events_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);
