import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ShareSection, WeeklyReportData } from '@jengalink/contracts';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { users } from './users';

/**
 * A weekly report (spec §14, §15, A0): a frozen snapshot of the week built from records.
 * Generating again for the same week makes the next revision; a report never changes.
 */
export const weeklyReports = pgTable(
  'weekly_reports',
  {
    id: id(),
    ...projectScope,
    weekStart: date().notNull(),
    weekEnd: date().notNull(),
    revisionNo: integer().notNull(),
    data: jsonb().$type<WeeklyReportData>().notNull(),
    /** The owner (or delegate) marked it reviewed: the owner review rate (spec §32). */
    acknowledgedBy: uuid().references(() => users.id),
    acknowledgedAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'weekly_reports_project_fk'),
    unique('weekly_reports_week_revision_unique').on(
      t.projectId,
      t.weekStart,
      t.revisionNo,
    ),
    index('weekly_reports_project_idx').on(t.projectId, t.weekStart),
  ],
);

/**
 * A link to one report for someone outside the project (spec §26.5, §12): chosen sections only,
 * an expiry, optional PDF download, revocable. Only a hash of the token is stored.
 */
export const reportShares = pgTable(
  'report_shares',
  {
    id: id(),
    ...projectScope,
    reportId: uuid()
      .notNull()
      .references(() => weeklyReports.id),
    tokenHash: text().notNull(),
    sections: jsonb().$type<ShareSection[]>().notNull(),
    allowDownload: boolean().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => users.id),
    viewCount: integer().notNull().default(0),
    lastViewedAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'report_shares_project_fk'),
    unique('report_shares_token_unique').on(t.tokenHash),
    index('report_shares_report_idx').on(t.reportId),
  ],
);
