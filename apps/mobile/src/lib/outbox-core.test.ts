import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterFailure, backoffMs, canSend, classifyFailure, dueItems, localDate, type OutboxItem, summarize } from './outbox-core';

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'a',
  sendKey: 'k1',
  status: 'queued',
  projectId: 'p',
  projectName: 'Niboye house',
  stageId: 's',
  stageName: 'Walls',
  eventDate: '2026-11-03',
  note: 'Walls up',
  blockers: '',
  photos: [{ localUri: 'file:///x.jpg', contentType: 'image/jpeg', capturedAt: null, uploadKey: 'tmp/p/1' }],
  createdAt: '2026-11-03T08:00:00.000Z',
  updatedAt: '2026-11-03T08:00:00.000Z',
  attempts: 0,
  nextAttemptAt: null,
  lastError: null,
  ...over,
});

test('network errors wait for the connection; server errors retry with backoff; bad requests need attention', () => {
  assert.equal(classifyFailure(undefined), 'offline');
  assert.equal(classifyFailure(503), 'retry');
  assert.equal(classifyFailure(429), 'retry');
  assert.equal(classifyFailure(400, [{ field: 'photos.0' }]), 'uploadLost');
  assert.equal(classifyFailure(409), 'fatal');
  assert.equal(classifyFailure(403), 'fatal');
});

test('offline keeps the item untouched; retries back off; fatal errors stop', () => {
  const now = Date.parse('2026-11-03T09:00:00Z');
  assert.deepEqual(afterFailure(item(), 'offline', 'x', now).attempts, 0);
  const retried = afterFailure(item(), 'retry', 'Server busy', now);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.nextAttemptAt, new Date(now + 15_000).toISOString());
  assert.equal(backoffMs(3), 60_000);
  assert.equal(backoffMs(20), 15 * 60_000);
  const fatal = afterFailure(item(), 'fatal', 'Project is not active', now);
  assert.equal(fatal.status, 'failed');
  assert.equal(fatal.lastError, 'Project is not active');
});

test('a lost upload starts the photos over with a new send key', () => {
  const lost = afterFailure(item(), 'uploadLost', 'Upload not found');
  assert.equal(lost.photos[0].uploadKey, undefined);
  assert.notEqual(lost.sendKey, 'k1');
  assert.equal(afterFailure(item({ attempts: 3 }), 'uploadLost', 'again').status, 'failed');
});

test('only due queued items are sent, oldest first; summary counts each kind', () => {
  const now = Date.parse('2026-11-03T09:00:00Z');
  const items = [
    item({ id: 'later', createdAt: '2026-11-03T08:30:00.000Z' }),
    item({ id: 'first', createdAt: '2026-11-03T07:00:00.000Z' }),
    item({ id: 'waiting', nextAttemptAt: '2026-11-03T09:05:00.000Z' }),
    item({ id: 'draft', status: 'draft' }),
    item({ id: 'bad', status: 'failed' }),
  ];
  assert.deepEqual(dueItems(items, now).map((i) => i.id), ['first', 'later']);
  assert.deepEqual(summarize(items), { drafts: 1, waiting: 3, failed: 1 });
  assert.ok(canSend(item()));
  assert.ok(!canSend(item({ photos: [], note: 'ok' })));
  assert.match(localDate(new Date(2026, 10, 3)), /^2026-11-03$/);
});
