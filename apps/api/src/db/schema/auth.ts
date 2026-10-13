import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id } from './columns';
import { users } from './users';

export const otpChannel = pgEnum('otp_channel', ['sms', 'email']);

/**
 * One sign-in code request (spec §26.5). Only a hash of the code is stored;
 * attempts are capped and the challenge expires after a few minutes.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: id(),
    channel: otpChannel().notNull(),
    /** E.164 phone or lower-cased email. */
    destination: text().notNull(),
    codeHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    attempts: integer().notNull().default(0),
    consumedAt: timestamp({ withTimezone: true }),
    requestIp: text(),
    ...auditColumns,
  },
  (t) => [
    index('otp_challenges_destination_idx').on(t.destination, t.createdAt),
    index('otp_challenges_ip_idx').on(t.requestIp, t.createdAt),
  ],
);

/**
 * A signed-in device. The refresh token is stored hashed (spec §17.5) and
 * rotates on every use; revocation takes effect on the next request.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    refreshTokenHash: text().notNull(),
    /**
     * The token before the last rotation and when it was rotated: presented again within a short
     * grace (a reply lost on a slow network, the app closed mid-refresh) it rotates again instead of
     * being treated as theft.
     */
    previousTokenHash: text(),
    rotatedAt: timestamp({ withTimezone: true }),
    deviceName: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text(),
    ...auditColumns,
  },
  (t) => [
    index('sessions_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);
