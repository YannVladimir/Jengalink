import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
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
import { JobsService } from '../src/jobs/jobs.service';
import { ConsoleMessageSender } from '../src/messaging/message-sender';
import { configureApp } from '../src/app.setup';

// Messages the API sends go out in the person's language (en, rw, fr, sw).
describe('languages in server messages (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;
  let jobs: JobsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleRef.get(DB);
    sender = moduleRef.get(ConsoleMessageSender);
    jobs = moduleRef.get(JobsService);
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

  async function signIn(local: string, locale?: 'en' | 'rw' | 'fr' | 'sw') {
    const started = (
      await http()
        .post('/v1/auth/otp/start')
        .send({ channel: 'sms', destination: local, locale })
        .expect(202)
    ).body as StartOtpResponse;
    const e164 = `+250${local.slice(1)}`;
    const v = (
      await http()
        .post('/v1/auth/otp/verify')
        .send({
          challengeId: started.challengeId,
          code: sender.lastCodeFor(e164),
          locale,
        })
        .expect(200)
    ).body as VerifyOtpResponse;
    return { ...v, e164, auth: { Authorization: `Bearer ${v.accessToken}` } };
  }

  it('sends the sign-in code in the app language', async () => {
    await http()
      .post('/v1/auth/otp/start')
      .send({ channel: 'sms', destination: '0788000031', locale: 'fr' })
      .expect(202);
    expect(sender.lastTo('+250788000031')!.text).toMatch(
      /^Code JengaLink : \d{6}\. Valable 5 minutes/,
    );
    await http()
      .post('/v1/auth/otp/start')
      .send({ channel: 'sms', destination: '0788000032', locale: 'sw' })
      .expect(202);
    expect(sender.lastTo('+250788000032')!.text).toMatch(
      /^Nambari ya JengaLink: \d{6}/,
    );
    await http()
      .post('/v1/auth/otp/start')
      .send({ channel: 'sms', destination: '0788000033', locale: 'de' })
      .expect(400);
  });

  it('saves the app language on a new account and lets the user change it', async () => {
    const u = await signIn('0788000034', 'rw');
    expect(u.user.locale).toBe('rw');
    const changed = await http()
      .patch('/v1/me')
      .set(u.auth)
      .set('If-Match', `"${u.user.revision}"`)
      .send({ locale: 'sw' })
      .expect(200);
    expect((changed.body as { locale: string }).locale).toBe('sw');
  });

  it('sends an invitation in the recipient’s own language when they have an account', async () => {
    const recipient = await signIn('0788000036', 'sw');
    const inviter = await signIn('0788000035', 'fr');
    await http()
      .patch('/v1/me')
      .set(inviter.auth)
      .set('If-Match', '"1"')
      .send({ displayName: 'Eric Mugisha' })
      .expect(200);
    const org = (
      await http()
        .post('/v1/organizations')
        .set(inviter.auth)
        .send({ name: 'Ubaka Builders', kind: 'contractor' })
        .expect(201)
    ).body as OrganizationView;
    const project = (
      await http()
        .post('/v1/projects')
        .set(inviter.auth)
        .send({ organizationId: org.id, name: 'Kicukiro House' })
        .expect(201)
    ).body as ProjectSummary;
    await http()
      .post(`/v1/projects/${project.id}/invitations`)
      .set(inviter.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ channel: 'sms', recipient: '0788000036', role: 'owner' })
      .expect(201);

    await jobs.start({ relayIntervalMs: 100, pollingIntervalSeconds: 0.5 });
    try {
      const deadline = Date.now() + 10_000;
      while (
        !sender.lastTo(recipient.e164)?.text.includes('amekualika') &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await jobs.stop();
    }
    expect(sender.lastTo(recipient.e164)!.text).toContain(
      'Eric Mugisha amekualika kwenye "Kicukiro House" katika JengaLink kama mmiliki',
    );
  }, 60_000);
});
