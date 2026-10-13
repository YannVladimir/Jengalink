// Site updates and their photos (spec §14.1, §16.2).
import { z } from 'zod';
import { StageReview } from './progress';

export const MAX_UPDATE_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const PhotoContentType = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
export type PhotoContentType = z.infer<typeof PhotoContentType>;

/** POST /v1/projects/:id/uploads — ask for a short-lived signed PUT for one photo. */
export const RequestUploadRequest = z
  .object({
    contentType: PhotoContentType,
    sizeBytes: z.number().int().min(1).max(MAX_PHOTO_BYTES).optional(),
  })
  .meta({ id: 'RequestUploadRequest' });
export type RequestUploadRequest = z.infer<typeof RequestUploadRequest>;

export const UploadGrantView = z
  .object({
    /** Send back as `uploadKey` when creating the update. */
    key: z.string(),
    url: z.url(),
    method: z.literal('PUT'),
    /** Send exactly these headers with the PUT; they are signed. */
    headers: z.object({ 'Content-Type': z.string() }),
    maxBytes: z.number().int(),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'UploadGrantView' });
export type UploadGrantView = z.infer<typeof UploadGrantView>;

/** POST /v1/projects/:id/updates (send an Idempotency-Key: retries never create two updates). */
export const CreateSiteUpdateRequest = z
  .object({
    stageId: z.uuid(),
    /** The day the work happened (project time zone); defaults to today. */
    eventDate: z.iso.date().optional(),
    note: z.string().trim().max(500).optional(),
    blockers: z.string().trim().max(300).optional(),
    photos: z
      .array(
        z.object({
          uploadKey: z.string().min(1).max(200),
          /** When the photo was taken, from the camera or EXIF. */
          capturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
        }),
      )
      .max(MAX_UPDATE_PHOTOS)
      .default([]),
  })
  .refine((u) => u.photos.length > 0 || (u.note?.length ?? 0) >= 3, {
    message: 'Add a photo or a short note',
    path: ['note'],
  })
  .meta({ id: 'CreateSiteUpdateRequest' });
export type CreateSiteUpdateRequest = z.input<typeof CreateSiteUpdateRequest>;

export const PhotoStatus = z.enum(['processing', 'ready', 'blocked', 'failed']);
export type PhotoStatus = z.infer<typeof PhotoStatus>;

export const UpdatePhoto = z
  .object({
    id: z.uuid(),
    /** processing: being scanned; ready: clean, links available; blocked: the virus scan found a threat; failed: not a readable photo. */
    status: PhotoStatus,
    /** Short-lived signed link to the private original (ready photos only). */
    url: z.url().nullable(),
    /** Short-lived signed link to a small JPEG (ready photos only; metadata such as GPS removed). */
    thumbUrl: z.url().nullable(),
    contentType: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    /** When the photo was taken… */
    capturedAt: z.iso.datetime().nullable(),
    /** …according to the phone's camera clock or the photo's EXIF data. */
    capturedAtSource: z.enum(['device', 'exif']).nullable(),
    /** When it reached the server. */
    uploadedAt: z.iso.datetime(),
  })
  .meta({ id: 'UpdatePhoto' });
export type UpdatePhoto = z.infer<typeof UpdatePhoto>;

export const SiteUpdate = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    stageId: z.uuid(),
    stageName: z.string(),
    authorName: z.string().nullable(),
    eventDate: z.iso.date(),
    note: z.string().nullable(),
    blockers: z.string().nullable(),
    /** When it reached the server. */
    submittedAt: z.iso.datetime(),
    revision: z.number().int(),
    photos: z.array(UpdatePhoto),
  })
  .meta({ id: 'SiteUpdate' });
export type SiteUpdate = z.infer<typeof SiteUpdate>;

/** Reads EXIF "2026:11:02 14:05:09" (camera local time) as an ISO string; null when missing or odd. */
export function exifToIso(value: unknown, offset = '+02:00'): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** GET /v1/projects/:id/updates — newest first; page with `before` (the last item's submittedAt). */
export const UpdatesQuery = z
  .object({
    stageId: z.uuid().optional(),
    before: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .meta({ id: 'UpdatesQuery' });
export type UpdatesQuery = z.input<typeof UpdatesQuery>;

/** GET /v1/projects/:id/stages/:stageId/timeline — one stage's photo story. */
export const StageTimeline = z
  .object({
    stage: z.object({
      id: z.uuid(),
      name: z.string(),
      position: z.number().int(),
      weight: z.number().int(),
      status: z.enum(['not_started', 'in_progress', 'ready_for_review', 'accepted', 'changes_required']),
      /** Send as If-Match when reviewing. */
      revision: z.number().int(),
      plannedStart: z.iso.date().nullable(),
      plannedEnd: z.iso.date().nullable(),
      criteria: z.array(z.string()),
    }),
    /** The earliest and the latest ready photo of the stage (by capture time, else upload time); null below two photos. */
    before: UpdatePhoto.nullable(),
    after: UpdatePhoto.nullable(),
    photoCount: z.number().int(),
    /** Updates for this stage, newest first. */
    updates: z.array(SiteUpdate),
    /** Submissions and decisions, newest first. */
    reviews: z.array(StageReview),
    /** The contractor or manager can say the stage is done (active project, not accepted, has updates). */
    canSubmit: z.boolean(),
    /** The owner can accept or ask for changes (stage is ready for review). */
    canReview: z.boolean(),
  })
  .meta({ id: 'StageTimeline' });
export type StageTimeline = z.infer<typeof StageTimeline>;

/** The time to show for a photo: when it was taken if known, otherwise when it arrived. */
export const photoTime = (p: Pick<UpdatePhoto, 'capturedAt' | 'uploadedAt'>) => p.capturedAt ?? p.uploadedAt;
