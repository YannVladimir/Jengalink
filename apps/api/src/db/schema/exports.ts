import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { ExportFormat, ExportKind } from '@jengalink/contracts';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';

/**
 * An export someone asked for (spec §12): built by a background job from one snapshot, kept in
 * private storage, downloadable only by them (permission checked again at download time).
 */
export const projectExports = pgTable(
  'project_exports',
  {
    id: id(),
    ...projectScope,
    kind: text().$type<ExportKind>().notNull(),
    format: text().$type<ExportFormat>().notNull(),
    status: text()
      .$type<'queued' | 'ready' | 'failed'>()
      .notNull()
      .default('queued'),
    /** The language the file is written in. */
    locale: text().notNull(),
    /** Money was included (the requester could see it when they asked). */
    includesMoney: boolean().notNull(),
    storageKey: text(),
    error: text(),
    readyAt: timestamp({ withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'project_exports_project_fk'),
    index('project_exports_requester_idx').on(t.createdBy, t.createdAt),
  ],
);
