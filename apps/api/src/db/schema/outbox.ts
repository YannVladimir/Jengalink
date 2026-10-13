import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id } from './columns';

/**
 * Transactional outbox (spec §16.2): a domain change and its event are written in
 * the same transaction. The relay later hands pending events to the job queue.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    index('outbox_events_pending_idx')
      .on(t.id)
      .where(sql`${t.publishedAt} is null`),
  ],
);

/** Consumers deduplicate by event ID (spec §16.2): one row per consumer per event. Append-only. */
export const processedEvents = pgTable(
  'processed_events',
  {
    id: id(),
    consumer: text().notNull(),
    eventId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('processed_events_consumer_event_unique').on(t.consumer, t.eventId),
  ],
);
