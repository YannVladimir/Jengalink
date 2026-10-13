import { integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { auditColumns, id } from './columns';

/**
 * Fixed-window counters for rate limits (spec §20: limit login, uploads, exports, share links).
 * One row per key and window; kept in Postgres so every API instance counts the same.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: id(),
    /** e.g. "otp-verify:ip:203.0.113.7" or "uploads:user:<id>". */
    key: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
    ...auditColumns,
  },
  (t) => [unique('rate_limits_key_window_unique').on(t.key, t.windowStart)],
);
