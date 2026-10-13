import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type {
  ClaimView,
  CreatedInvitation,
  NotificationList,
  NotificationSettings,
  OrganizationView,
  ProjectStage,
  ProjectSummary,
  QuoteView,
  SiteUpdate,
  SpendingView,
  StartOtpResponse,
  VerifyOtpResponse,
} from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Database } from '../src/db/client';
import { DB } from '../src/db/database.module';
import { JobsService } from '../src/jobs/jobs.service';
import { ConsoleMessageSender } from '../src/messaging/message-sender';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ConsolePushSender } from '../src/notifications/push-sender';
import { ReminderScheduler } from '../src/notifications/reminder-scheduler';

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const token = (name: string) => `ExponentPushToken[${name}]`;

/**
 * Notifications (spec §9.4, §5): what needs someone reaches them, in their language, linked to the
 * exact item, without amounts; pushes go to their phones and a dead phone is dropped.
 */
describe('notifications (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;
  let pushes: ConsolePushSender;
  let jobs: JobsService;
  let notifier: NotificationsService;
  let reminders: ReminderScheduler;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleRef.get(DB);
    sender = moduleRef.get(ConsoleMessageSender);
    pushes = moduleRef.get(ConsolePushSender);
    jobs = moduleRef.get(JobsService);
    notifier = moduleRef.get(NotificationsService);
    reminders = moduleRef.get(ReminderScheduler);
  });

  beforeEach(async () => {
    await db.execute(sql`truncate idempotency_records, audit_events, invitations, project_memberships,
      organization_memberships, projects, organizations, sessions, otp_challenges, users, outbox_events,
      processed_events, push_devices cascade`);
    pushes.sent.length = 0;
    pushes.goneTokens.clear();
    notifier.clock = () => new Date();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function user(local: string, name: string, locale = 'en') {
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
    const auth = { Authorization: `Bearer ${v.accessToken}` };
    await http()
      .patch('/v1/me')
      .set(auth)
      .set('If-Match', `"${v.user.revision}"`)
      .send({ displayName: name, locale })
      .expect(200);
    return {
      id: v.user.id,
      get: (url: string) => http().get(url).set(auth),
      post: (url: string, body?: object, key: string = randomUUID()) =>
        http()
          .post(url)
          .set(auth)
          .set('Idempotency-Key', key)
          .send(body ?? {}),
      put: (url: string, body: object) => http().put(url).set(auth).send(body),
    };
  }
  type User = Awaited<ReturnType<typeof user>>;

  /** Runs the background jobs until `n` notifications exist and none waits for its push. */
  async function deliver(n: number) {
    await jobs.start({ relayIntervalMs: 100, pollingIntervalSeconds: 0.5 });
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const r = await db.execute<{ total: number; pending: number }>(
          sql`select count(*)::int as total, count(*) filter (where push_status = 'pending')::int as pending from notifications`,
        );
        const { total, pending } = r.rows[0];
        if ((total >= n && pending === 0) || Date.now() > deadline) break;
        await new Promise((res) => setTimeout(res, 200));
      }
    } finally {
      await jobs.stop();
    }
  }

  /** Owner (in French), contractor, site supervisor, finance; an accepted quote with a cost + fee package. */
  async function setup() {
    const contractor = await user('0788000081', 'Eric Mugisha');
    const org = (
      await contractor
        .post('/v1/organizations', {
          name: 'Ubaka Builders',
          kind: 'contractor',
        })
        .expect(201)
    ).body as OrganizationView;
    const p = (
      await contractor
        .post('/v1/projects', {
          organizationId: org.id,
          name: 'Kicukiro House',
          contractValue: 19_100_000,
          stages: [{ name: 'Foundation', weight: 100 }],
        })
        .expect(201)
    ).body as ProjectSummary;
    const inviteBy = async (
      by: User,
      phone: string,
      name: string,
      role: string,
      locale = 'en',
    ) => {
      const inv = (
        await by
          .post(`/v1/projects/${p.id}/invitations`, {
            channel: 'sms',
            recipient: phone,
            role,
          })
          .expect(201)
      ).body as CreatedInvitation;
      const u = await user(phone, name, locale);
      await u.post(`/v1/invitations/${inv.id}/accept`).expect(200);
      return u;
    };
    const owner = await inviteBy(
      contractor,
      '0788000082',
      'Aline Uwase',
      'owner',
      'fr',
    );
    const supervisor = await inviteBy(
      contractor,
      '0722000083',
      'Jean Habimana',
      'supervisor',
    );
    const finance = await inviteBy(
      owner,
      '0788000084',
      'Grace Mukamana',
      'finance',
    );
    const etag = (await owner.get(`/v1/projects/${p.id}`).expect(200)).headers
      .etag;
    await owner
      .post(`/v1/projects/${p.id}/acceptance`, { decision: 'accept' })
      .set('If-Match', etag)
      .expect(200);
    const q = (
      await contractor
        .post(`/v1/projects/${p.id}/quotes`, {
          title: 'House',
          scope: 'Foundation and cement works.',
          milestones: [
            { name: 'Foundation', amount: 18_000_000 },
            {
              name: 'Cement works',
              amount: 1_100_000,
              basis: 'reimbursable',
              feePercent: 10,
            },
          ],
          validUntil: inDays(30),
        })
        .expect(201)
    ).body as QuoteView;
    const sent = (
      await contractor
        .post(`/v1/projects/${p.id}/quotes/${q.id}/send`)
        .expect(200)
    ).body as QuoteView;
    await owner
      .post(`/v1/projects/${p.id}/quotes/${q.id}/decision`, {
        decision: 'accept',
        revision: 1,
      })
      .set('If-Match', `"${sent.version}"`)
      .expect(200);
    const stages = (
      await contractor.get(`/v1/projects/${p.id}/stages`).expect(200)
    ).body as ProjectStage[];
    return { contractor, owner, supervisor, finance, p, stages };
  }

  it('what needs someone reaches them: the exact item, their language, no amounts; phones come and go', async () => {
    const { contractor, owner, supervisor, finance, p, stages } = await setup();

    // Phones: a bad token is refused; a phone moves to whoever signs in on it.
    await owner
      .post('/v1/me/push-devices', { token: 'not-a-token', platform: 'ios' })
      .expect(400);
    await supervisor
      .post('/v1/me/push-devices', {
        token: token('shared-phone'),
        platform: 'android',
      })
      .expect(204);
    await owner
      .post('/v1/me/push-devices', {
        token: token('shared-phone'),
        platform: 'android',
      })
      .expect(204);
    await owner
      .post('/v1/me/push-devices', {
        token: token('owner-iphone'),
        platform: 'ios',
      })
      .expect(204);
    await owner
      .post('/v1/me/push-devices', {
        token: token('owner-iphone'),
        platform: 'ios',
      })
      .expect(204); // refresh, no duplicate
    await contractor
      .post('/v1/me/push-devices', {
        token: token('contractor-old'),
        platform: 'android',
      })
      .expect(204);
    await contractor
      .post('/v1/me/push-devices', {
        token: token('contractor-new'),
        platform: 'android',
      })
      .expect(204);
    pushes.goneTokens.add(token('contractor-old')); // the app was uninstalled from that phone

    // A claim and a spending request wait for the owner; a problem on site; the week's report.
    const update = (
      await supervisor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Waiting for steel',
          blockers: 'Steel delivery is late',
        })
        .expect(201)
    ).body as SiteUpdate;
    const draft = (
      await contractor
        .post(`/v1/projects/${p.id}/claims`, {
          milestoneIndex: 0,
          amount: 6_000_000,
          siteUpdateIds: [update.id],
        })
        .expect(201)
    ).body as ClaimView;
    const claim = (
      await contractor
        .post(`/v1/projects/${p.id}/claims/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as ClaimView;
    const req = (
      await contractor
        .post(`/v1/projects/${p.id}/spending`, {
          milestoneIndex: 1,
          purpose: 'Cement for the foundation',
          lines: [
            {
              description: 'Cement bags',
              quantity: '40',
              unit: 'bag',
              unitRate: 15_000,
            },
          ],
        })
        .expect(201)
    ).body as SpendingView;
    await contractor
      .post(`/v1/projects/${p.id}/spending/${req.id}/submit`)
      .set('If-Match', `"${req.version}"`)
      .expect(200);
    const report = (
      await supervisor.post(`/v1/projects/${p.id}/reports`, {}).expect(201)
    ).body as { id: string };

    // owner: problem + claim + spending + report (4); contractor: problem + report (2); finance: report (1).
    await deliver(7);

    const mine = async (u: User) =>
      (await u.get('/v1/notifications').expect(200)).body as NotificationList;
    const o = await mine(owner);
    expect(o.unread).toBe(4);
    const byKind = Object.fromEntries(o.items.map((n) => [n.kind, n]));
    expect(byKind.claim_to_decide).toMatchObject({
      title: 'Demande de paiement à examiner', // the owner reads French
      path: `/project/${p.id}/claims/${claim.id}`,
      body: `Kicukiro House : la demande ${claim.number} attend votre décision.`,
    });
    expect(byKind.spending_to_decide.path).toBe(
      `/project/${p.id}/spending/${req.id}`,
    );
    expect(byKind.report_published.path).toBe(
      `/project/${p.id}/reports/${report.id}`,
    );
    expect(byKind.update_problem).toMatchObject({
      path: `/project/${p.id}/stages/${stages[0].id}`,
      body: 'Kicukiro House : Jean Habimana a signalé un problème sur Foundation.',
    });
    // Nothing sensitive on a lock screen: no amounts in any text.
    for (const n of o.items)
      expect(`${n.title} ${n.body}`).not.toMatch(
        /6[ ,.\u202f]?000[ ,.\u202f]?000|600[ ,.\u202f]?000|RWF/,
      );

    const c = await mine(contractor);
    expect(c.items.map((n) => n.kind).sort()).toEqual([
      'report_published',
      'update_problem',
    ]);
    expect(c.items[0].title).toMatch(
      /^(New weekly report|Problem reported on site)$/,
    );
    expect((await mine(supervisor)).items).toEqual([]); // the author hears nothing of their own work
    expect((await mine(finance)).items.map((n) => n.kind)).toEqual([
      'report_published',
    ]);

    // Pushes: to every live phone, with the item to open; the dead phone is switched off.
    const to = (t: string) => pushes.sent.filter((m) => m.token === t);
    expect(to(token('owner-iphone'))).toHaveLength(4);
    expect(to(token('shared-phone'))).toHaveLength(4); // now the owner's phone, not the supervisor's
    expect(to(token('contractor-new'))).toHaveLength(2);
    expect(to(token('contractor-old'))).toHaveLength(0);
    expect(
      to(token('owner-iphone')).find((m) => m.data.path.includes('/claims/')),
    ).toMatchObject({
      title: 'Demande de paiement à examiner',
      data: {
        path: `/project/${p.id}/claims/${claim.id}`,
        notificationId: byKind.claim_to_decide.id,
      },
    });
    const status = await db.execute<{
      kind: string;
      push_status: string;
      n: number;
    }>(
      sql`select kind, push_status, count(*)::int as n from notifications group by 1, 2 order by 1, 2`,
    );
    expect(status.rows).toEqual([
      { kind: 'claim_to_decide', push_status: 'sent', n: 1 },
      { kind: 'report_published', push_status: 'no_device', n: 1 }, // finance has no phone registered
      { kind: 'report_published', push_status: 'sent', n: 2 },
      { kind: 'spending_to_decide', push_status: 'sent', n: 1 },
      { kind: 'update_problem', push_status: 'sent', n: 2 },
    ]);
    const devices = await db.execute<{ token: string; disabled: boolean }>(
      sql`select token, disabled_at is not null as disabled from push_devices order by token`,
    );
    expect(devices.rows).toEqual([
      { token: token('contractor-new'), disabled: false },
      { token: token('contractor-old'), disabled: true },
      { token: token('owner-iphone'), disabled: false },
      { token: token('shared-phone'), disabled: false },
    ]);

    // Once decided, the news is settled: the spending request's notification reads itself.
    const toDecide = (
      await owner.get(`/v1/projects/${p.id}/spending/${req.id}`).expect(200)
    ).body as SpendingView;
    await owner
      .post(`/v1/projects/${p.id}/spending/${req.id}/decision`, {
        decision: 'approve',
        amount: toDecide.amount,
      })
      .set('If-Match', `"${toDecide.version}"`)
      .expect(200);
    await jobs.start({ relayIntervalMs: 100, pollingIntervalSeconds: 0.5 });
    try {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const r = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from notifications where kind = 'spending_to_decide' and read_at is not null`,
        );
        if (r.rows[0].n === 1) break;
        await new Promise((res) => setTimeout(res, 200));
      }
    } finally {
      await jobs.stop();
    }
    expect(
      (await mine(owner)).items.find((n) => n.kind === 'spending_to_decide')
        ?.readAt,
    ).not.toBeNull();

    // Opening one marks it read; someone else's is not yours; then all at once.
    const opened = (
      await owner
        .post(`/v1/notifications/${byKind.claim_to_decide.id}/read`)
        .expect(200)
    ).body as { readAt: string };
    expect(opened.readAt).not.toBeNull();
    expect((await mine(owner)).unread).toBe(2); // the claim was opened, the spending request decided
    await contractor
      .post(`/v1/notifications/${byKind.claim_to_decide.id}/read`)
      .expect(404);
    expect(
      (
        (await owner.post('/v1/notifications/read-all').expect(200))
          .body as NotificationList
      ).unread,
    ).toBe(0);

    // Signing out removes the phone.
    await owner
      .post('/v1/me/push-devices/remove', { token: token('owner-iphone') })
      .expect(204);
    const left = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from push_devices where token = ${token('owner-iphone')}`,
    );
    expect(left.rows[0].n).toBe(0);
  }, 60_000);

  // Spec §9.4, Phase 5: reminders for decisions waiting more than 2 days, quiet hours, lock screens.
  it('quiet hours hold pushes until morning; late decisions get one reminder a day; no amounts on a lock screen', async () => {
    const { contractor, owner, supervisor, p, stages } = await setup();
    // Kigali local time today (UTC+2), optionally days later.
    const kigaliToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
    }).format(new Date());
    const at = (hhmm: string, days = 0) =>
      new Date(
        Date.parse(`${kigaliToday}T${hhmm}:00+02:00`) + days * 86_400_000,
      );
    await owner
      .post('/v1/me/push-devices', {
        token: token('owner-phone'),
        platform: 'android',
      })
      .expect(204);

    // Settings: night-time quiet hours by default; bad times are refused.
    const settings = async (u: User) =>
      (await u.get('/v1/me/notification-settings').expect(200))
        .body as NotificationSettings;
    expect(await settings(owner)).toEqual({
      remindersEnabled: true,
      quietHours: { start: '21:00', end: '07:00' },
      timeZone: 'Africa/Kigali',
    });
    await owner
      .put('/v1/me/notification-settings', {
        remindersEnabled: true,
        quietHours: { start: '25:00', end: '07:00' },
      })
      .expect(400);

    // 22:30: a claim arrives. In the list at once; the push waits for the morning.
    notifier.clock = () => at('22:30');
    const update = (
      await supervisor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Slab cured',
        })
        .expect(201)
    ).body as SiteUpdate;
    const draft = (
      await contractor
        .post(`/v1/projects/${p.id}/claims`, {
          milestoneIndex: 0,
          amount: 6_000_000,
          siteUpdateIds: [update.id],
        })
        .expect(201)
    ).body as ClaimView;
    const claim = (
      await contractor
        .post(`/v1/projects/${p.id}/claims/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as ClaimView;
    await deliver(1);
    expect(
      (
        (await owner.get('/v1/notifications').expect(200))
          .body as NotificationList
      ).items[0].kind,
    ).toBe('claim_to_decide');
    const status = async () =>
      (
        await db.execute<{ push_status: string }>(
          sql`select push_status from notifications where kind = 'claim_to_decide'`,
        )
      ).rows[0].push_status;
    expect(await status()).toBe('held');
    expect(pushes.sent).toHaveLength(0);
    // Still quiet at 06:59 the next morning; released at 07:05.
    notifier.clock = () => at('06:59', 1);
    expect(await reminders.run()).toEqual({ released: 0, reminded: 0 });
    notifier.clock = () => at('07:05', 1);
    expect(await reminders.run()).toMatchObject({ released: 1 });
    await deliver(1);
    expect(await status()).toBe('sent');
    expect(pushes.sent.map((m) => m.data.path)).toEqual([
      `/project/${p.id}/claims/${claim.id}`,
    ]);

    // Sent 5 days before now (4 full days at 08:00 today): one reminder that morning, not twice, none at night.
    await db.execute(
      sql`update claims set submitted_at = now() - interval '5 days' where id = ${claim.id}`,
    );
    notifier.clock = () => at('08:00');
    expect(await reminders.run()).toEqual({ released: 0, reminded: 1 }); // only the owner decides claims
    notifier.clock = () => at('15:00');
    expect((await reminders.run()).reminded).toBe(0); // once a day
    await deliver(2);
    const reminder = (
      (await owner.get('/v1/notifications').expect(200))
        .body as NotificationList
    ).items.find((n) => n.kind === 'decisions_reminder');
    expect(reminder).toMatchObject({
      title: 'Des décisions vous attendent', // the owner reads French
      body: '1 décision attend depuis 4 jours. Ouvrez JengaLink pour décider.',
      path: '/',
    });
    notifier.clock = () => at('23:00', 1);
    expect((await reminders.run()).reminded).toBe(0); // quiet hours
    notifier.clock = () => at('08:00', 1);
    expect((await reminders.run()).reminded).toBe(1); // the next day

    // Reminders off: nothing the day after; quiet hours off: pushes at any time.
    const put = async (body: object) =>
      (await owner.put('/v1/me/notification-settings', body).expect(200))
        .body as NotificationSettings;
    expect(await put({ remindersEnabled: false, quietHours: null })).toEqual({
      remindersEnabled: false,
      quietHours: null,
      timeZone: 'Africa/Kigali',
    });
    notifier.clock = () => at('08:00', 2);
    expect((await reminders.run()).reminded).toBe(0);
    notifier.clock = () => at('23:30');
    const d2 = (
      await contractor
        .post(`/v1/projects/${p.id}/claims`, {
          milestoneIndex: 0,
          amount: 2_000_000,
          siteUpdateIds: [update.id],
        })
        .expect(201)
    ).body as ClaimView;
    await contractor
      .post(`/v1/projects/${p.id}/claims/${d2.id}/submit`)
      .set('If-Match', `"${d2.version}"`)
      .expect(200);
    await deliver(4);
    const late = (
      await db.execute<{ push_status: string }>(
        sql`select push_status from notifications order by created_at desc limit 1`,
      )
    ).rows[0];
    expect(late.push_status).toBe('sent');

    // Lock screens: no push ever carries an amount.
    expect(pushes.sent.length).toBeGreaterThanOrEqual(3);
    for (const m of pushes.sent)
      expect(`${m.title} ${m.body}`).not.toMatch(/RWF|\d[\d,.\u202f ]{3,}\d/);
  }, 60_000);
});
