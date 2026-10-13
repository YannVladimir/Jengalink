import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  ApiErrorBody,
  CreatedInvitation,
  OrganizationView,
  ProjectSummary,
  StartOtpResponse,
  VerifyOtpResponse,
} from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { Database } from '../src/db/client';
import { DB } from '../src/db/database.module';
import { ConsoleMessageSender } from '../src/messaging/message-sender';
import { configureApp } from '../src/app.setup';

// Spec §19.1: Idempotency-Key on writes that could act twice; ETag + If-Match on updates.
describe('safe writes: idempotency keys and version checks (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleRef.get(DB);
    sender = moduleRef.get(ConsoleMessageSender);
  });

  beforeEach(async () => {
    await db.execute(sql`truncate idempotency_records, audit_events, invitations, project_memberships,
      organization_memberships, projects, organizations, sessions, otp_challenges, users, outbox_events,
      processed_events cascade`);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function signIn(local: string) {
    const started = (
      await http()
        .post('/v1/auth/otp/start')
        .send({ channel: 'sms', destination: local })
        .expect(202)
    ).body as StartOtpResponse;
    const v = (
      await http()
        .post('/v1/auth/otp/verify')
        .send({
          challengeId: started.challengeId,
          code: sender.lastCodeFor(`+250${local.slice(1)}`),
        })
        .expect(200)
    ).body as VerifyOtpResponse;
    return { ...v, auth: { Authorization: `Bearer ${v.accessToken}` } };
  }

  async function projectFor(auth: Record<string, string>) {
    const org = (
      await http()
        .post('/v1/organizations')
        .set(auth)
        .send({ name: 'Ubaka', kind: 'contractor' })
        .expect(201)
    ).body as OrganizationView;
    return (
      await http()
        .post('/v1/projects')
        .set(auth)
        .send({
          organizationId: org.id,
          name: 'Kicukiro House',
          contractValue: 45_000_000,
          stages: [{ name: 'Foundation', weight: 100 }],
        })
        .expect(201)
    ).body as ProjectSummary;
  }

  const count = async (
    table: 'invitations' | 'outbox_events' | 'organizations',
  ) =>
    (
      await db.execute<{ n: number }>(
        sql.raw(`select count(*)::int as n from ${table}`),
      )
    ).rows[0].n;

  describe('Idempotency-Key', () => {
    it('is required where a retry could send a second SMS', async () => {
      const u = await signIn('0788000021');
      const p = await projectFor(u.auth);
      const res = await http()
        .post(`/v1/projects/${p.id}/invitations`)
        .set(u.auth)
        .send({ channel: 'sms', recipient: '0788000022', role: 'owner' })
        .expect(400);
      expect((res.body as ApiErrorBody).fieldErrors[0].field).toBe(
        'Idempotency-Key',
      );
      await http()
        .post(`/v1/projects/${p.id}/invitations`)
        .set(u.auth)
        .set('Idempotency-Key', 'short')
        .send({ channel: 'sms', recipient: '0788000022', role: 'owner' })
        .expect(400);
    });

    it('returns the original result for a retry, and acts only once', async () => {
      const u = await signIn('0788000021');
      const p = await projectFor(u.auth);
      const send = () =>
        http()
          .post(`/v1/projects/${p.id}/invitations`)
          .set(u.auth)
          .set('Idempotency-Key', 'invite-owner-0001')
          .send({ role: 'owner', recipient: '0788000022', channel: 'sms' });

      const first = await send().expect(201);
      const retry = await send().expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect((retry.body as CreatedInvitation).id).toBe(
        (first.body as CreatedInvitation).id,
      );
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(await count('invitations')).toBe(1);
      expect(await count('outbox_events')).toBe(1); // one SMS queued, not two
    });

    it('treats the same body in a different key order as the same request', async () => {
      const u = await signIn('0788000021');
      await http()
        .post('/v1/organizations')
        .set(u.auth)
        .set('Idempotency-Key', 'org-create-0001')
        .send({ name: 'Uwase family', kind: 'household' })
        .expect(201);
      await http()
        .post('/v1/organizations')
        .set(u.auth)
        .set('Idempotency-Key', 'org-create-0001')
        .send({ kind: 'household', name: 'Uwase family' })
        .expect(201);
      expect(await count('organizations')).toBe(1);
    });

    it('rejects a reused key with a different body (409)', async () => {
      const u = await signIn('0788000021');
      await http()
        .post('/v1/organizations')
        .set(u.auth)
        .set('Idempotency-Key', 'org-create-0002')
        .send({ name: 'Uwase family', kind: 'household' })
        .expect(201);
      const res = await http()
        .post('/v1/organizations')
        .set(u.auth)
        .set('Idempotency-Key', 'org-create-0002')
        .send({ name: 'Mugisha family', kind: 'household' })
        .expect(409);
      expect((res.body as ApiErrorBody).code).toBe('conflict');
      expect(await count('organizations')).toBe(1);
    });

    it('lets only one of two simultaneous duplicates act', async () => {
      const u = await signIn('0788000021');
      const send = () =>
        http()
          .post('/v1/organizations')
          .set(u.auth)
          .set('Idempotency-Key', 'org-create-race')
          .send({ name: 'Race', kind: 'household' });
      const [a, b] = await Promise.all([send(), send()]);
      expect([a.status, b.status].sort()).toEqual(
        expect.arrayContaining([201]),
      );
      expect([201, 409]).toEqual(expect.arrayContaining([a.status, b.status]));
      expect(await count('organizations')).toBe(1);
    });

    it('scopes keys to the user: two people may use the same key', async () => {
      const a = await signIn('0788000021');
      const b = await signIn('0788000023');
      await http()
        .post('/v1/organizations')
        .set(a.auth)
        .set('Idempotency-Key', 'shared-key-0001')
        .send({ name: 'Uwase family', kind: 'household' })
        .expect(201);
      const resB = await http()
        .post('/v1/organizations')
        .set(b.auth)
        .set('Idempotency-Key', 'shared-key-0001')
        .send({ name: 'Uwase family', kind: 'household' })
        .expect(201);
      expect(resB.headers['idempotent-replayed']).toBeUndefined();
      expect(await count('organizations')).toBe(2);
    });

    it('releases the key when the request fails, so a corrected retry works', async () => {
      const u = await signIn('0788000021');
      const p = await projectFor(u.auth);
      const send = (recipient: string) =>
        http()
          .post(`/v1/projects/${p.id}/invitations`)
          .set(u.auth)
          .set('Idempotency-Key', 'invite-fix-0001')
          .send({ channel: 'sms', recipient, role: 'owner' });
      await send('+32470123456').expect(400); // not a Rwandan number
      await send('0788000022').expect(201);
      expect(await count('invitations')).toBe(1);
    });
  });

  describe('ETag and If-Match', () => {
    it('returns an ETag and requires If-Match to update the profile', async () => {
      const u = await signIn('0788000021');
      const me = await http().get('/v1/me').set(u.auth).expect(200);
      expect(me.headers.etag).toBe('"1"');

      const missing = await http()
        .patch('/v1/me')
        .set(u.auth)
        .send({ displayName: 'Eric' })
        .expect(428);
      expect((missing.body as ApiErrorBody).code).toBe('precondition_required');

      const ok = await http()
        .patch('/v1/me')
        .set(u.auth)
        .set('If-Match', me.headers.etag)
        .send({ displayName: 'Eric' })
        .expect(200);
      expect(ok.headers.etag).toBe('"2"');

      // Using the old version again is refused: someone (here, ourselves) changed it.
      const stale = await http()
        .patch('/v1/me')
        .set(u.auth)
        .set('If-Match', '"1"')
        .send({ displayName: 'Erik' })
        .expect(412);
      expect(stale.body).toMatchObject({
        code: 'version_conflict',
        currentRevision: 2,
      });
      expect(
        (
          (await http().get('/v1/me').set(u.auth)).body as {
            displayName: string;
          }
        ).displayName,
      ).toBe('Eric');
    });

    it('lets only one of two simultaneous edits of the same version win', async () => {
      const u = await signIn('0788000021');
      const edit = (name: string) =>
        http()
          .patch('/v1/me')
          .set(u.auth)
          .set('If-Match', '"1"')
          .send({ displayName: name });
      const results = await Promise.all([edit('First'), edit('Second')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
    });

    it('requires the current project version to start a project', async () => {
      const contractor = await signIn('0788000021');
      const p = await projectFor(contractor.auth);
      const inv = (
        await http()
          .post(`/v1/projects/${p.id}/invitations`)
          .set(contractor.auth)
          .set('Idempotency-Key', 'invite-owner-0002')
          .send({ channel: 'sms', recipient: '0788000022', role: 'owner' })
          .expect(201)
      ).body as CreatedInvitation;
      const owner = await signIn('0788000022');
      await http()
        .post(`/v1/invitations/${inv.id}/accept`)
        .set(owner.auth)
        .expect(200);

      const read = await http()
        .get(`/v1/projects/${p.id}`)
        .set(owner.auth)
        .expect(200);
      // Created at revision 1; the owner joining made it revision 2.
      expect(read.headers.etag).toBe('"2"');
      const accept = () =>
        http()
          .post(`/v1/projects/${p.id}/acceptance`)
          .set(owner.auth)
          .send({ decision: 'accept' });
      await accept().expect(428);
      await accept().set('If-Match', '"7"').expect(412);
      const done = await accept().set('If-Match', '"2"').expect(200);
      expect(done.headers.etag).toBe('"3"');
      expect((done.body as { status: string }).status).toBe('active');
      // Accepting the same old version again cannot apply twice.
      await accept().set('If-Match', '"2"').expect(409);
    });
  });
});
