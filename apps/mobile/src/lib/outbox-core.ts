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
  return items
    .filter((i) => i.status === 'queued' && (!i.nextAttemptAt || Date.parse(i.nextAttemptAt) <= now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function summarize(items: OutboxItem[]) {
  return {
    drafts: items.filter((i) => i.status === 'draft').length,
    waiting: items.filter((i) => i.status === 'queued').length,
    failed: items.filter((i) => i.status === 'failed').length,
  };
}

/** A draft can be sent once it has a stage and a photo or a short note (the server's rule). */
export const canSend = (i: Pick<OutboxItem, 'stageId' | 'photos' | 'note'>) =>
  !!i.stageId && (i.photos.length > 0 || i.note.trim().length >= 3);

/** Applies one failed attempt to an item. */
export function afterFailure(item: OutboxItem, kind: FailureKind, message: string, now = Date.now()): OutboxItem {
  if (kind === 'offline') return { ...item, lastError: null };
  const attempts = item.attempts + 1;
  if (kind === 'fatal' || (kind === 'uploadLost' && attempts > 3))
    return { ...item, status: 'failed', attempts, lastError: message, nextAttemptAt: null };
  return {
    ...item,
    attempts,
    lastError: message,
    nextAttemptAt: new Date(now + backoffMs(attempts)).toISOString(),
    // Lost uploads start over with fresh keys and a fresh send key (the body changes).
    ...(kind === 'uploadLost'
      ? { photos: item.photos.map(({ uploadKey: _drop, ...p }) => p), sendKey: newId('upd') }
      : {}),
  };
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Today's date on the device as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
