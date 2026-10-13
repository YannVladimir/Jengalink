// Offline scenarios for the send queue (spec §14.2, Phase 6): network loss, restart, a lost reply
// and its replay, a removed user, conflicts, expired uploads and expired sessions. The fake server
// behaves like the real API: Idempotency-Key replays, 409 for a reused key with another body.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueItems, type OutboxItem, requeued, type SendDeps, sendItem } from './outbox-core';

const NOW = Date.parse('2026-11-03T10:00:00Z');

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'a',
  sendKey: 'upd-1',
  status: 'queued',
  projectId: 'p1',
  projectName: 'Niboye house',
  stageId: 's1',
  stageName: 'Walls',
  // Written offline two days ago: the work day must survive however late it sends.
  eventDate: '2026-11-01',
  note: 'Walls up to the ring beam',
  blockers: '',
  photos: [
    { localUri: 'file:///1.jpg', contentType: 'image/jpeg', capturedAt: '2026-11-01T09:00:00+02:00' },
    { localUri: 'file:///2.jpg', contentType: 'image/jpeg', capturedAt: '2026-11-01T09:05:00+02:00' },
  ],
  createdAt: '2026-11-01T09:10:00.000Z',
  updatedAt: '2026-11-01T09:10:00.000Z',
  attempts: 0,
  nextAttemptAt: null,
  lastError: null,
  ...over,
});

class ApiErr extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: { fieldErrors?: { field: string; message: string }[] } = {},
  ) {
    super(message);
  }
}

/** A small stand-in for the API and storage. */
class FakeServer implements SendDeps {
  online = true;
  /** Store the update, then lose the connection before the reply arrives. */
  loseNextReply = false;
  /** The member was removed from the project / the role may no longer report / the project was paused. */
  refuse: { status: number; message: string } | null = null;
  /** Upload keys that expired before the update was posted. */
  expired = new Set<string>();
  /** Every upload is gone by the time the update is posted. */
  expireAll = false;
  sessionExpired = false;
  uploads: string[] = [];
  stored = new Map<string, { projectId: string; body: unknown }>();
  saved: OutboxItem[] = [];
  private n = 0;
  putFailures = 0;

  private net() {
    if (!this.online) throw new TypeError('Network request failed');
  }
  grantUpload(projectId: string) {
    this.net();
    return Promise.resolve({ url: `https://storage/${++this.n}`, headers: {}, key: `tmp/${projectId}/${this.n}` });
  }
  putFile(_uri: string, url: string) {
    this.net();
    if (this.putFailures > 0) {
      this.putFailures--;
      return Promise.resolve({ ok: false, status: 503 });
    }
    this.uploads.push(url);
    return Promise.resolve({ ok: true, status: 200 });
  }
  postUpdate(projectId: string, sendKey: string, body: { photos: { uploadKey: string }[] }) {
    this.net();
    if (this.sessionExpired) throw new ApiErr(401, 'Session expired');
    if (this.refuse) throw new ApiErr(this.refuse.status, this.refuse.message);
    const bad = body.photos.findIndex((p) => this.expireAll || this.expired.has(p.uploadKey));
    if (bad >= 0) throw new ApiErr(400, 'Unknown photo upload', { fieldErrors: [{ field: `photos.${bad}.uploadKey`, message: 'expired' }] });
    const before = this.stored.get(sendKey);
    if (before && JSON.stringify(before.body) !== JSON.stringify(body)) throw new ApiErr(409, 'This Idempotency-Key was used for a different request');
    if (!before) this.stored.set(sendKey, { projectId, body });
    if (this.loseNextReply) {
      this.loseNextReply = false;
      throw new TypeError('Network request failed');
    }
    return Promise.resolve();
  }
  save(i: OutboxItem) {
    this.saved.push(i);
  }
}

test('network lost halfway through the photos: the uploaded one is remembered; after a restart only the rest is sent', async () => {
  const server = new FakeServer();
  // The connection drops right after the first photo reached storage.
  const realPut = server.putFile.bind(server);
  server.putFile = async (uri, url, headers) => {
    const r = await realPut(uri, url, headers);
    server.online = false;
    return r;
  };
  const first = await sendItem(item(), server, NOW);
  assert.equal(first.outcome, 'offline');
  assert.equal(first.item.status, 'queued');
  assert.equal(first.item.attempts, 0, 'a lost connection is not a failed attempt');
  assert.equal(first.item.nextAttemptAt, null);
  assert.equal(first.item.photos[0].uploadKey, 'tmp/p1/1');
  assert.equal(first.item.photos[1].uploadKey, undefined);
  assert.deepEqual(server.saved.at(-1), first.item, 'saved on the phone after each photo');

  // "Restart": a new run from the saved copy, with the connection back.
  const restarted = new FakeServer();
  restarted.online = true;
  const second = await sendItem(server.saved.at(-1)!, restarted, NOW);
  assert.equal(second.outcome, 'sent');
  assert.equal(restarted.uploads.length, 1, 'only the second photo is uploaded again');
  const body = restarted.stored.get('upd-1')!.body as { eventDate: string; photos: { uploadKey: string; capturedAt: string }[] };
  assert.equal(body.photos[0].uploadKey, 'tmp/p1/1', 'the photo uploaded before the drop is reused');
  assert.ok(body.photos[1].uploadKey, 'the other one was uploaded after the restart');
  assert.equal(body.eventDate, '2026-11-01', 'the day the work happened, not the day it sent');
  assert.equal(body.photos[0].capturedAt, '2026-11-01T09:00:00+02:00');
});

test('a lost reply: the retry replays under the same key, so the server keeps exactly one update', async () => {
  const server = new FakeServer();
  server.loseNextReply = true;
  const first = await sendItem(item(), server, NOW);
  assert.equal(first.outcome, 'offline');
  assert.equal(server.stored.size, 1, 'the server did store it');
  assert.equal(first.item.sendKey, 'upd-1');
  const again = await sendItem(first.item, server, NOW);
  assert.equal(again.outcome, 'sent');
  assert.equal(server.stored.size, 1, 'no duplicate');
  assert.equal(server.uploads.length, 2, 'photos were not uploaded twice');
});

test('a removed member or a role that may not report: the update stops, stays on the phone and says why', async () => {
  for (const status of [404, 403]) {
    const server = new FakeServer();
    server.refuse = { status, message: status === 404 ? 'Project not found' : 'Only the contractor, manager or supervisor can post updates' };
    const r = await sendItem(item(), server, NOW);
    assert.equal(r.outcome, 'fatal');
    assert.equal(r.item.status, 'failed');
    assert.equal(r.item.failure, 'noAccess');
    assert.equal(r.item.note, 'Walls up to the ring beam', 'nothing written is lost');
    assert.ok(
      r.item.photos.every((p) => p.uploadKey),
      'photos stay, uploaded',
    );
    assert.deepEqual(dueItems([r.item], NOW), [], 'not retried by itself');
  }
});

test('the project changed meanwhile (paused, stage gone): a conflict, kept for the person to decide', async () => {
  const server = new FakeServer();
  server.refuse = { status: 409, message: 'Site updates start once the owner has accepted the project.' };
  const r = await sendItem(item(), server, NOW);
  assert.equal(r.item.status, 'failed');
  assert.equal(r.item.failure, 'conflict');
  // Sending it again (after the project resumes) uses a new key: the old one stays tied to the refused body.
  const again = requeued(r.item, NOW);
  assert.equal(again.status, 'queued');
  assert.notEqual(again.sendKey, 'upd-1');
  assert.equal(again.failure, null);
  server.refuse = null;
  assert.equal((await sendItem(again, server, NOW)).outcome, 'sent');
});

test('uploads that expired while offline start over (new keys, new send key); after 3 tries it asks for attention', async () => {
  const server = new FakeServer();
  let current = item();
  const first = await sendItem(current, server, NOW);
  assert.equal(first.outcome, 'sent');
  // A second item whose uploads expire every time.
  const stale = item({ id: 'b', sendKey: 'upd-2', photos: [{ localUri: 'file:///3.jpg', contentType: 'image/jpeg', capturedAt: null, uploadKey: 'tmp/p1/old' }] });
  server.expired.add('tmp/p1/old');
  const r1 = await sendItem(stale, server, NOW);
  assert.equal(r1.outcome, 'uploadLost');
  assert.equal(r1.item.status, 'queued');
  assert.equal(r1.item.photos[0].uploadKey, undefined, 'the photo is uploaded again');
  assert.notEqual(r1.item.sendKey, 'upd-2');
  assert.ok(Date.parse(r1.item.nextAttemptAt!) > NOW, 'with a pause first');
  current = r1.item;
  server.expireAll = true;
  for (let n = 0; n < 3; n++) current = (await sendItem(current, server, NOW)).item;
  assert.equal(current.status, 'failed');
  assert.equal(current.failure, 'invalid');
});

test('an expired session and server errors retry with growing pauses; a storage hiccup is retried too', async () => {
  const server = new FakeServer();
  server.sessionExpired = true;
  const r1 = await sendItem(item(), server, NOW);
  assert.equal(r1.outcome, 'retry');
  assert.equal(r1.item.status, 'queued');
  const r2 = await sendItem(r1.item, server, NOW);
  assert.ok(Date.parse(r2.item.nextAttemptAt!) - NOW > Date.parse(r1.item.nextAttemptAt!) - NOW, 'the pause grows');
  server.sessionExpired = false;
  const s = new FakeServer();
  s.putFailures = 1;
  const r3 = await sendItem(item(), s, NOW);
  assert.equal(r3.outcome, 'retry');
  assert.equal(r3.item.photos[0].uploadKey, undefined);
  assert.equal((await sendItem(r3.item, s, NOW)).outcome, 'sent');
  assert.equal(s.stored.size, 1);
});
