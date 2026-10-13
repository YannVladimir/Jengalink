import {
  bigint,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, projectScope } from './columns';
import { projectFk } from './projects';
import { stages } from './stages';

export const siteUpdateStatus = pgEnum('site_update_status', ['submitted']);

/** Photo pipeline (spec §16.2): nothing is shown to others until the scan says clean. */
export const mediaScanStatus = pgEnum('media_scan_status', [
  'pending',
  'clean',
  'infected',
  'failed',
]);
/** Where `capturedAt` came from: the phone's camera clock or the photo's EXIF data. */
export const capturedAtSource = pgEnum('captured_at_source', [
  'device',
  'exif',
]);

/**
 * A site update: stage, short note, optional blockers and photos (spec §14.1).
 * `eventDate` is the day the work happened; `createdAt` is when it reached the server.
 */
export const siteUpdates = pgTable(
  'site_updates',
  {
    id: id(),
    ...projectScope,
    stageId: uuid().notNull(),
    eventDate: date().notNull(),
    note: text(),
    blockers: text(),
    status: siteUpdateStatus().notNull().default('submitted'),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'site_updates_project_fk'),
    foreignKey({
      name: 'site_updates_stage_fk',
      columns: [t.stageId],
      foreignColumns: [stages.id],
    }),
    index('site_updates_project_idx').on(t.projectId, t.createdAt),
  ],
);

/**
 * Private files (photos now, receipts later). Originals stay in private storage;
 * clients get short-lived signed links only after an access check.
 * `capturedAt` comes from the device (EXIF or camera time); `createdAt` is upload time.
 */
export const media = pgTable(
  'media',
  {
    id: id(),
    ...projectScope,
    siteUpdateId: uuid().references(() => siteUpdates.id),
    /** Attachments to a payment claim (photos, invoices, delivery notes). */
    claimId: uuid(),
    /** The name the file had on the phone or computer (documents). */
    fileName: text(),
    /** Quotations and other files on a spending request. */
    spendingRequestId: uuid(),
    /** The original of a supplier receipt. */
    receiptId: uuid(),
    /** Proof of an external payment (MoMo screenshot, bank slip, cash receipt). */
    paymentId: uuid(),
    /** Evidence for a budget change (quotation, drawing, photo). */
    budgetChangeId: uuid(),
    /** SHA-256 of the original, set by the media pipeline: finds exact duplicate files. */
    sha256: text(),
    /** Taken off a claim already sent: kept, because an earlier revision showed it. */
    removedAt: timestamp({ withTimezone: true }),
    position: integer().notNull().default(0),
    storageKey: text().notNull().unique(),
    contentType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    capturedAt: timestamp({ withTimezone: true }),
    capturedAtSource: capturedAtSource(),
    scanStatus: mediaScanStatus().notNull().default('pending'),
    scannedAt: timestamp({ withTimezone: true }),
    /** Which scanner judged it ("clamav 1.4…", or "basic" in development). */
    scanEngine: text(),
    /** A small JPEG copy for lists and timelines; metadata (incl. GPS) stripped. */
    thumbKey: text(),
    width: integer(),
    height: integer(),
    processingError: text(),
    ...auditColumns,
  },
  (t) => [
    projectFk(t, 'media_project_fk'),
    index('media_site_update_idx').on(t.siteUpdateId, t.position),
    index('media_claim_idx').on(t.claimId, t.position),
    index('media_sha256_idx').on(t.organizationId, t.sha256),
  ],
);
