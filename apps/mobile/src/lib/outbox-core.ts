// Offline outbox rules, kept free of React Native so they can be unit-tested (node:test).
// Spec §14.2: drafts and queued updates survive restarts; sending is retried until it succeeds.

export interface OutboxPhoto {
  /** A copy kept by the app (file:// on phones, data: URL in the web preview). */
  localUri: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
  capturedAt: string | null;
  /** Set once this photo reached storage, so a restart does not upload it again. */
  uploadKey?: string;
}

export type OutboxStatus = 'draft' | 'queued' | 'failed';

export interface OutboxItem {
  id: string;
  /** Idempotency-Key for the final send: a retry after a lost reply never posts twice. */
  sendKey: string;
  status: OutboxStatus;
  projectId: string;
  projectName: string;
  stageId: string | null;
  stageName: string;
  /** The day the work happened, fixed when the update was written (not when it finally sends). */
  eventDate: string;
  note: string;
  blockers: string;
  photos: OutboxPhoto[];
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  /** Why a failed item stopped, so the Outbox can say what to do (absent while it can still send). */
  failure?: FailureReason | null;
}

/**
 * Why the server refused for good: the person lost access to the project (removed, or a role that
 * may not report), the project or stage changed meanwhile, or the update itself was not accepted.
 */
export type FailureReason = 'noAccess' | 'conflict' | 'invalid' | 'rejected';

export function failureReason(status: number | undefined): FailureReason {
  if (status === 403 || status === 404) return 'noAccess';
  if (status === 409 || status === 410 || status === 412 || status === 428) return 'conflict';
  if (status === 400 || status === 422) return 'invalid';
  return 'rejected';
}

export type FailureKind = 'offline' | 'retry' | 'uploadLost' | 'fatal';

/** How a failed attempt should be handled. `status` is the HTTP status, absent for network errors. */
export function classifyFailure(status: number | undefined, fieldErrors: { field: string }[] = []): FailureKind {
  if (status === undefined || status === 0) return 'offline';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  if (status === 401) return 'retry';
  if (status === 400 && fieldErrors.some((f) => f.field.startsWith('photos.'))) return 'uploadLost';
  return 'fatal';
}

/** 15 s, 30 s, 1 min … capped at 15 min. */
export const backoffMs = (attempts: number) => Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));

/** Queued items whose retry time has come, oldest first. */
export function dueItems(items: OutboxItem[], now = Date.now()): OutboxItem[] {
  return items.filter((i) => i.status === 'queued' && (!i.nextAttemptAt || Date.parse(i.nextAttemptAt) <= now)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function summarize(items: OutboxItem[]) {
  return {
    drafts: items.filter((i) => i.status === 'draft').length,
    waiting: items.filter((i) => i.status === 'queued').length,
    failed: items.filter((i) => i.status === 'failed').length,
  };
}

/** A draft can be sent once it has a stage and a photo or a short note (the server's rule). */
export const canSend = (i: Pick<OutboxItem, 'stageId' | 'photos' | 'note'>) => !!i.stageId && (i.photos.length > 0 || i.note.trim().length >= 3);

/** Applies one failed attempt to an item. The item and its photos always stay on the phone. */
export function afterFailure(item: OutboxItem, kind: FailureKind, message: string, now = Date.now(), status?: number): OutboxItem {
  if (kind === 'offline') return { ...item, lastError: null };
  const attempts = item.attempts + 1;
  if (kind === 'fatal' || (kind === 'uploadLost' && attempts > 3)) return { ...item, status: 'failed', attempts, lastError: message, nextAttemptAt: null, failure: failureReason(status) };
  return {
    ...item,
    attempts,
    lastError: message,
    nextAttemptAt: new Date(now + backoffMs(attempts)).toISOString(),
    // Lost uploads start over with fresh keys and a fresh send key (the body changes).
    ...(kind === 'uploadLost' ? { photos: item.photos.map(({ uploadKey: _drop, ...p }) => p), sendKey: newId('upd') } : {}),
  };
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Today's date on the device as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Sent again after an edit or a tap on "Send": a failed one goes under a new key (its body may have changed). */
export function requeued(item: OutboxItem, now = Date.now()): OutboxItem {
  return {
    ...item,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    failure: null,
    sendKey: item.status === 'failed' ? newId('upd') : item.sendKey,
    updatedAt: new Date(now).toISOString(),
  };
}

/** The body of POST /v1/projects/:id/updates for a fully uploaded item. */
export function updateBody(item: OutboxItem) {
  return {
    stageId: item.stageId ?? '',
    eventDate: item.eventDate,
    ...(item.note.trim() ? { note: item.note.trim() } : {}),
    ...(item.blockers.trim() ? { blockers: item.blockers.trim() } : {}),
    photos: item.photos.map((p) => ({ uploadKey: p.uploadKey!, capturedAt: p.capturedAt })),
  };
}

/** A photo PUT to storage failed: always worth retrying (signed links expire; storage may be busy). */
export class UploadFailed extends Error {}

/** What sending needs from the outside world (the app passes the API and storage; tests pass a fake). */
export interface SendDeps {
  grantUpload(projectId: string, contentType: OutboxPhoto['contentType']): Promise<{ url: string; headers: Record<string, string>; key: string }>;
  putFile(localUri: string, url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number }>;
  postUpdate(projectId: string, sendKey: string, body: ReturnType<typeof updateBody>): Promise<void>;
  /** Saves the item on the phone (after each photo, so a restart continues from there). */
  save(item: OutboxItem): void;
}

/**
 * Sends one item: uploads the photos not yet uploaded (remembering each at once), then posts the
 * update under its send key. Errors from the API carry `status` and `body.fieldErrors`; anything
 * without a status is a lost connection. Returns the item as it should now be saved.
 */
export async function sendItem(start: OutboxItem, deps: SendDeps, now = Date.now()): Promise<{ outcome: 'sent' | FailureKind; item: OutboxItem }> {
  let item = start;
  try {
    for (const [i, photo] of item.photos.entries()) {
      if (photo.uploadKey) continue;
      const grant = await deps.grantUpload(item.projectId, photo.contentType);
      const put = await deps.putFile(photo.localUri, grant.url, grant.headers);
      if (!put.ok) throw new UploadFailed(`Photo upload failed (${put.status})`);
      item = { ...item, photos: item.photos.map((p, j) => (j === i ? { ...p, uploadKey: grant.key } : p)) };
      deps.save(item);
    }
    await deps.postUpdate(item.projectId, item.sendKey, updateBody(item));
    return { outcome: 'sent', item };
  } catch (err) {
    const e = err as { status?: number; body?: { fieldErrors?: { field: string }[] }; message?: string };
    const kind: FailureKind = err instanceof UploadFailed ? 'retry' : typeof e.status === 'number' ? classifyFailure(e.status, e.body?.fieldErrors ?? []) : 'offline';
    return { outcome: kind, item: afterFailure(item, kind, e.message ?? String(err), now, e.status) };
  }
}
