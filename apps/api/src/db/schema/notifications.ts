import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { NotificationKind } from '@jengalink/contracts';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { users } from './users';

/**
 * One notification for one person (spec §9.4, §17 notifications): what happened, the exact item
 * it opens, and how the push went. Text is built in the reader's language when read or pushed.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    ...projectScope,
    userId: uuid()
      .notNull()
      .references(() => users.id),
    kind: text().$type<NotificationKind>().notNull(),
    /** The app route of the exact item. */
    path: text().notNull(),
    /** Words for the text (project, stage, number…); never amounts or addresses. */
    params: jsonb().$type<Record<string, string>>().notNull(),
    /** The domain event it came from: one notification per person per event. */
    sourceEventId: uuid().notNull(),
    /** pending → sent | no_device | failed, or held during quiet hours. A failure never changes the workflow. */
    pushStatus: text()
      .$type<'pending' | 'held' | 'sent' | 'no_device' | 'failed'>()
      .notNull()
      .default('pending'),
    pushError: text(),
    pushedAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'notifications_project_fk'),
    unique('notifications_event_user_unique').on(t.sourceEventId, t.userId),
    index('notifications_user_idx').on(t.userId, t.createdAt),
  ],
);

/** A phone that receives pushes for a signed-in person (Expo push token). */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    token: text().notNull(),
    platform: text().$type<'ios' | 'android'>().notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Expo said the app was uninstalled or the token is no longer valid. */
    disabledAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    unique('push_devices_token_unique').on(t.token),
    index('push_devices_user_idx').on(t.userId),
  ],
);
