import { boolean, pgTable, text } from 'drizzle-orm/pg-core';
import { auditColumns, id } from './columns';

export const users = pgTable('users', {
  id: id(),
  // Empty until the user adds their name after first sign-in.
  displayName: text(),
  verifiedPhone: text().unique('users_verified_phone_unique'),
  verifiedEmail: text().unique('users_verified_email_unique'),
  // en | rw | fr | sw. New accounts take the app's language; English when none is sent.
  locale: text().notNull().default('en'),
  // Notification settings (spec §9.4): a daily reminder for late decisions, and quiet hours
  // (no pushes from start to end on the local clock; both null = pushes any time).
  remindersEnabled: boolean().notNull().default(true),
  quietStart: text().default('21:00'),
  quietEnd: text().default('07:00'),
  timeZone: text().notNull().default('Africa/Kigali'),
  ...auditColumns,
});
