import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { exifToIso } from '@jengalink/contracts';
import exifr from 'exifr';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { media, projects } from '../db/schema';
import { JobsService } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { MediaScanner } from './scanner';

export const THUMB_SIZE = 480;
type MediaRow = typeof media.$inferSelect;

/** UTC offset of a time zone at a moment, as "+02:00" (Kigali has no DST, but stay general). */
function offsetOf(timeZone: string, at = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part ?? '');
  return m ? m[1] : '+00:00';
}

/**
 * Photo pipeline (spec §16.2), run from the outbox after an update is posted or files are
 * attached to a payment claim:
 * 1. virus-scan the private original; an infected file is deleted and recorded;
 * 2. make a small thumbnail (EXIF and GPS stripped) for lists and timelines;
 * 3. read the capture time from EXIF when the phone did not send one.
 * Until a photo is clean, nobody gets a link to it.
 */
@Injectable()
export class MediaProcessor implements OnModuleInit {
  static readonly consumer = 'process-photos';
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly scanner: MediaScanner,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.jobs.on(
      'site_update.submitted',
      MediaProcessor.consumer,
      async ({ siteUpdateId }, tx) => {
        const rows = await tx
          .select({ m: media, timezone: projects.timezone })
          .from(media)
          .innerJoin(projects, eq(projects.id, media.projectId))
          .where(
            and(
              eq(media.siteUpdateId, siteUpdateId),
              eq(media.scanStatus, 'pending'),
            ),
          );
        for (const { m, timezone } of rows) await this.process(tx, m, timezone);
      },
    );
    // Evidence for budget changes: the same pipeline.
    this.jobs.on(
      'change.files_added',
      MediaProcessor.consumer,
      async ({ changeId }, tx) => {
        const rows = await tx
          .select({ m: media, timezone: projects.timezone })
          .from(media)
          .innerJoin(projects, eq(projects.id, media.projectId))
          .where(
            and(
              eq(media.budgetChangeId, changeId),
              eq(media.scanStatus, 'pending'),
            ),
          );
        for (const { m, timezone } of rows) await this.process(tx, m, timezone);
      },
    );
    // Proof of payment: the same pipeline.
    this.jobs.on(
      'payment.files_added',
      MediaProcessor.consumer,
      async ({ paymentId }, tx) => {
        const rows = await tx
          .select({ m: media, timezone: projects.timezone })
          .from(media)
          .innerJoin(projects, eq(projects.id, media.projectId))
          .where(
            and(
              eq(media.paymentId, paymentId),
              eq(media.scanStatus, 'pending'),
            ),
          );
        for (const { m, timezone } of rows) await this.process(tx, m, timezone);
      },
    );
    // Supplier receipts: the same pipeline.
    this.jobs.on(
      'receipt.files_added',
      MediaProcessor.consumer,
      async ({ receiptId }, tx) => {
        const rows = await tx
          .select({ m: media, timezone: projects.timezone })
          .from(media)
          .innerJoin(projects, eq(projects.id, media.projectId))
          .where(
            and(
              eq(media.receiptId, receiptId),
              eq(media.scanStatus, 'pending'),
            ),
          );
        for (const { m, timezone } of rows) await this.process(tx, m, timezone);
      },
    );
    // Quotations on spending requests: the same pipeline.
    this.jobs.on(
      'spending.files_added',
      MediaProcessor.consumer,
      async ({ requestId }, tx) => {
        const rows = await tx
          .select({ m: media, timezone: projects.timezone })
          .from(media)
          .innerJoin(projects, eq(projects.id, media.projectId))
          .where(
            and(
              eq(media.spendingRequestId, requestId),
              eq(media.scanStatus, 'pending'),
            ),
          );
        for (const { m, timezone } of rows) await this.process(tx, m, timezone);
      },
    );
    // Claim evidence: the same pipeline; PDFs are scanned and checked, not thumbnailed.
    this.jobs.on(
      'claim.files_added',
      MediaProcessor.consumer,
      async ({ claimId }, tx) => {
        const rows = await tx
          .select({ m: media, timezone: projects.timezone })
          .from(media)
          .innerJoin(projects, eq(projects.id, media.projectId))
          .where(
            and(eq(media.claimId, claimId), eq(media.scanStatus, 'pending')),
          );
        for (const { m, timezone } of rows) await this.process(tx, m, timezone);
      },
    );
  }

  /** Storage or scanner outages throw, so the job is retried; a bad file is marked and kept out of view. */
  async process(tx: Tx, m: MediaRow, timezone: string) {
    const original = await this.storage.getObject(m.storageKey);
    // A fingerprint of the original: finds the exact same file uploaded twice (duplicate receipts).
    const sha256 = createHash('sha256').update(original).digest('hex');
    const verdict = await this.scanner.scan(original);
    if (!verdict.clean) {
      await this.storage.delete(m.storageKey);
      await tx
        .update(media)
        .set({
          scanStatus: 'infected',
          scannedAt: new Date(),
          scanEngine: verdict.engine,
          processingError: `Blocked by the virus scan: ${verdict.signature ?? 'threat found'}`,
          updatedAt: new Date(),
        })
        .where(eq(media.id, m.id));
      await this.audit.record(tx, {
        action: 'media.quarantined',
        actor: { userId: null },
        organizationId: m.organizationId,
        projectId: m.projectId,
        target: { type: 'media', id: m.id },
        metadata: {
          signature: verdict.signature ?? null,
          engine: verdict.engine,
          uploadedBy: m.createdBy,
        },
      });
      this.logger.warn(`Quarantined media ${m.id}: ${verdict.signature}`);
      return;
    }

    if (m.contentType === 'application/pdf') {
      // The browser-declared type is not trusted: a document must really be a PDF.
      const isPdf = original.subarray(0, 5).toString('latin1') === '%PDF-';
      await tx
        .update(media)
        .set({
          scanStatus: isPdf ? 'clean' : 'failed',
          sha256,
          scannedAt: new Date(),
          scanEngine: verdict.engine,
          processingError: isPdf ? null : 'Not a readable PDF',
          updatedAt: new Date(),
        })
        .where(eq(media.id, m.id));
      return;
    }

    let thumb: Buffer;
    let width: number | null = null;
    let height: number | null = null;
    try {
      const image = sharp(original, { failOn: 'error' }).rotate();
      const meta = await sharp(original).metadata();
      // Orientation 5–8 means the camera stored it sideways; report the upright size.
      const sideways = (meta.orientation ?? 1) >= 5;
      width = (sideways ? meta.height : meta.width) ?? null;
      height = (sideways ? meta.width : meta.height) ?? null;
      thumb = await image
        .resize({
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      await tx
        .update(media)
        .set({
          scanStatus: 'failed',
          scannedAt: new Date(),
          scanEngine: verdict.engine,
          processingError: `Not a readable photo: ${err instanceof Error ? err.message : String(err)}`,
          updatedAt: new Date(),
        })
        .where(eq(media.id, m.id));
      return;
    }

    let capturedAt = m.capturedAt;
    let capturedAtSource = m.capturedAtSource;
    if (!capturedAt) {
      const exif = (await exifr
        .parse(original, {
          pick: ['DateTimeOriginal', 'OffsetTimeOriginal'],
          reviveValues: false,
        })
        .catch(() => null)) as {
        DateTimeOriginal?: string;
        OffsetTimeOriginal?: string;
      } | null;
      // EXIF times are the camera's local clock; without an offset tag, assume the project's time zone.
      const iso = exifToIso(
        exif?.DateTimeOriginal,
        exif?.OffsetTimeOriginal ?? offsetOf(timezone),
      );
      if (iso) {
        capturedAt = new Date(iso);
        capturedAtSource = 'exif';
      }
    }

    const thumbKey = `${m.storageKey}-thumb.jpg`;
    await this.storage.putObject(thumbKey, thumb, 'image/jpeg');
    await tx
      .update(media)
      .set({
        scanStatus: 'clean',
        scannedAt: new Date(),
        scanEngine: verdict.engine,
        sha256,
        thumbKey,
        width,
        height,
        capturedAt,
        capturedAtSource,
        updatedAt: new Date(),
      })
      .where(eq(media.id, m.id));
  }
}
