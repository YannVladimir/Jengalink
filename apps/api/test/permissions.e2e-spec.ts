import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type {
  ClaimView,
  CreatedInvitation,
  CreatedReportShare,
  ExportView,
  MemberView,
  OrganizationView,
  PaymentsOverview,
  ProjectStage,
  ProjectSummary,
  QuoteView,
  SiteUpdate,
  SpendingView,
  StartOtpResponse,
  VerifyOtpResponse,
  WeeklyReportView,
} from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Database } from '../src/db/client';
import { DB } from '../src/db/database.module';
import { ConsoleMessageSender } from '../src/messaging/message-sender';
import { discoverRoutes } from '../src/openapi/build';

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(
    new Date(),
  );
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Amounts that exist only in project A's money records: none may reach someone without money access. */
const MONEY = [
  '19100000',
  '18000000',
  '6000000',
  '600000',
  '300000',
  '2500000',
  '1100000',
];

/**
 * Permissions across every endpoint (spec §24, §680): strangers with real ids, people from another
 * project, members without money access, low-privilege writes, revoked members, file links,
 * exports and share links. Routes are discovered, so new endpoints join these checks by themselves.
 */
describe('permissions across every endpoint (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;
  let routes: { method: Method; path: string; isPublic: boolean }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleRef.get(DB);
    sender = moduleRef.get(ConsoleMessageSender);
    routes = discoverRoutes(app).map((r) => ({
      method: r.method as Method,
      path: r.path,
      isPublic: r.isPublic,
    }));
  });

  beforeEach(async () => {
    await db.execute(sql`truncate idempotency_records, audit_events, invitations, project_memberships,
      organization_memberships, projects, organizations, sessions, otp_challenges, users, outbox_events,
      processed_events, push_devices cascade`);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function user(local: string, name: string) {
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
      .send({ displayName: name })
      .expect(200);
    const req = (method: Method, url: string, body?: object) =>
      http()
        [method](url)
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .set('If-Match', '"1"')
        .send(body ?? {});
    return {
      id: v.user.id,
      req,
      get: (url: string) => req('get', url),
      post: (url: string, body?: object) => req('post', url, body),
    };
  }
  type User = Awaited<ReturnType<typeof user>>;

  /** Project A with something real behind every id: quote, claim, request, expense + receipt, payment, change, report + share, export. */
  async function worldA() {
    const contractor = await user('0788000201', 'Eric Mugisha');
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
    const invite = async (
      by: User,
      phone: string,
      name: string,
      role: string,
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
      const u = await user(phone, name);
      await u.post(`/v1/invitations/${inv.id}/accept`).expect(200);
      return u;
    };
    const owner = await invite(
      contractor,
      '0788000202',
      'Aline Uwase',
      'owner',
    );
    const supervisor = await invite(
      contractor,
      '0722000203',
      'Jean Habimana',
      'supervisor',
    );
    const viewer = await invite(
      owner,
      '0788000204',
      'Grace Mukamana',
      'viewer',
    );
    // An invitation still waiting (addressed to someone else).
    const pending = (
      await owner
        .post(`/v1/projects/${p.id}/invitations`, {
          channel: 'sms',
          recipient: '0788000299',
          role: 'delegate',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const etag = (await owner.get(`/v1/projects/${p.id}`).expect(200)).headers
      .etag;
    await owner
      .req('post', `/v1/projects/${p.id}/acceptance`, { decision: 'accept' })
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
      .req('post', `/v1/projects/${p.id}/quotes/${q.id}/decision`, {
        decision: 'accept',
        revision: 1,
      })
      .set('If-Match', `"${sent.version}"`)
      .expect(200);
    const stages = (
      await contractor.get(`/v1/projects/${p.id}/stages`).expect(200)
    ).body as ProjectStage[];
    const update = (
      await supervisor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Footings poured',
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
        .req('post', `/v1/projects/${p.id}/claims/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as ClaimView;
    await owner
      .req('post', `/v1/projects/${p.id}/claims/${claim.id}/decision`, {
        decision: 'approve',
        amount: 6_000_000,
      })
      .set('If-Match', `"${claim.version}"`)
      .expect(200);
    const sr = (
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
    const srSent = (
      await contractor
        .req('post', `/v1/projects/${p.id}/spending/${sr.id}/submit`)
        .set('If-Match', `"${sr.version}"`)
        .expect(200)
    ).body as SpendingView;
    await owner
      .req('post', `/v1/projects/${p.id}/spending/${sr.id}/decision`, {
        decision: 'approve',
        amount: srSent.amount,
      })
      .set('If-Match', `"${srSent.version}"`)
      .expect(200);
    const withExpense = (
      await contractor
        .post(`/v1/projects/${p.id}/spending/${sr.id}/expenses`, {
          description: 'Cement',
          expenseDate: today(),
          amount: 300_000,
        })
        .expect(201)
    ).body as SpendingView;
    const expenseId = withExpense.expenses[0].id;
    await contractor
      .req('put', `/v1/projects/${p.id}/expenses/${expenseId}/receipt`, {
        supplierName: 'Kigali Hardware',
        invoiceNumber: 'INV-1',
        invoiceDate: today(),
        total: 300_000,
      })
      .expect(200);
    const pay = (
      await contractor
        .post(`/v1/projects/${p.id}/payments`, {
          claimId: claim.id,
          payer: 'Aline Uwase',
          beneficiary: 'Ubaka Builders',
          amount: 2_500_000,
          method: 'cash',
          paymentDate: today(),
        })
        .expect(201)
    ).body as PaymentsOverview;
    const change = (
      await contractor
        .post(`/v1/projects/${p.id}/changes`, {
          category: 'owner_request',
          reason: 'Add a garden wall',
          scheduleDays: 3,
          lines: [{ milestoneIndex: 0, delta: 500_000 }],
        })
        .expect(201)
    ).body as { id: string };
    const report = (
      await supervisor.post(`/v1/projects/${p.id}/reports`, {}).expect(201)
    ).body as WeeklyReportView;
    const share = (
      await owner
        .post(`/v1/projects/${p.id}/reports/${report.id}/shares`, {
          sections: ['work'],
          expiresInDays: 7,
          allowDownload: true,
        })
        .expect(201)
    ).body as CreatedReportShare;
    const exp = (
      await owner
        .post(`/v1/projects/${p.id}/exports`, {
          kind: 'money_history',
          format: 'csv',
        })
        .expect(201)
    ).body as ExportView;
    const members = (
      await owner.get(`/v1/projects/${p.id}/members`).expect(200)
    ).body as MemberView[];
    const ids: Record<string, string> = {
      id: p.id,
      stageId: stages[0].id,
      quoteId: q.id,
      claimId: claim.id,
      requestId: sr.id,
      expenseId,
      paymentId: pay.payments[0].id,
      changeId: change.id,
      reportId: report.id,
      shareId: share.id,
      exportId: exp.id,
      membershipId: members.find((m) => m.role === 'supervisor')!.membershipId,
    };
    return {
      contractor,
      owner,
      supervisor,
      viewer,
      org,
      p,
      ids,
      pending,
      quoteVersion: sent.version,
      share,
      members,
    };
  }

  /** A path with every :param filled from the given ids (the org id for organization routes). */
  const fill = (path: string, ids: Record<string, string>, orgId: string) =>
    path.startsWith('/v1/organizations')
      ? path.replace(':id', orgId)
      : path.replace(
          /:([A-Za-z]+)/g,
          (_, k: string) => ids[k] ?? `MISSING-${k}`,
        );

  const projectRoutes = () =>
    routes.filter((r) => !r.isPublic && r.path.startsWith('/v1/projects/:id'));

  it('a stranger holding the real ids of everything gets 404 on every project and organization route', async () => {
    const { org, ids } = await worldA();
    const stranger = await user('0788000209', 'Stranger');
    const scoped = routes.filter(
      (r) => !r.isPublic && /^\/v1\/(projects|organizations)\/:id/.test(r.path),
    );
    expect(scoped.length).toBeGreaterThan(60);
    const wrong: string[] = [];
    for (const r of scoped) {
      const url = fill(r.path, ids, org.id);
      const res = await stranger.req(r.method, url, {
        decision: 'approve',
        amount: 1,
        revision: 1,
        channel: 'sms',
        recipient: '0788000209',
        role: 'viewer',
      });
      if (res.status !== 404 || JSON.stringify(res.body).includes('Kicukiro'))
        wrong.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it('a member of another project cannot reach project A’s claims, payments, reports… through their own project', async () => {
    const { ids } = await worldA();
    // Project B: someone else's, where this owner has every right.
    const c2 = await user('0788000211', 'Other Contractor');
    const org2 = (
      await c2
        .post('/v1/organizations', {
          name: 'Other Builders',
          kind: 'contractor',
        })
        .expect(201)
    ).body as OrganizationView;
    const b = (
      await c2
        .post('/v1/projects', {
          organizationId: org2.id,
          name: 'Other House',
          contractValue: 1_000_000,
          stages: [{ name: 'Roof', weight: 100 }],
        })
        .expect(201)
    ).body as ProjectSummary;
    const inv = (
      await c2
        .post(`/v1/projects/${b.id}/invitations`, {
          channel: 'sms',
          recipient: '0788000212',
          role: 'owner',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const o2 = await user('0788000212', 'Other Owner');
    await o2.post(`/v1/invitations/${inv.id}/accept`).expect(200);

    const wrong: string[] = [];
    for (const r of projectRoutes().filter((x) =>
      /:(?!id\b)[A-Za-z]+/.test(x.path),
    )) {
      // B's own project id, A's child ids.
      const url = fill(r.path, { ...ids, id: b.id }, org2.id);
      for (const who of [o2, c2]) {
        const res = await who.req(r.method, url, {
          decision: 'approve',
          amount: 6_000_000,
          revision: 1,
          note: 'x',
        });
        const body = JSON.stringify(res.body);
        if (
          res.status < 400 ||
          body.includes('Kicukiro') ||
          MONEY.some((m) => body.includes(m))
        )
          wrong.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it('members without money access never receive money amounts from any read', async () => {
    const { supervisor, viewer, org, ids } = await worldA();
    const leaks: string[] = [];
    for (const r of projectRoutes().filter((x) => x.method === 'get')) {
      for (const [name, who] of [
        ['supervisor', supervisor],
        ['viewer', viewer],
      ] as const) {
        const res = await who.get(fill(r.path, ids, org.id));
        if (res.status >= 400) continue;
        const body = JSON.stringify(res.body);
        const found = MONEY.filter((m) =>
          new RegExp(`[^0-9]${m}[^0-9]`).test(body),
        );
        if (found.length)
          leaks.push(`${name}: GET ${r.path} shows ${found.join(', ')}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('a viewer changes nothing: every write is refused except the few meant for any member', async () => {
    const { viewer, org, ids } = await worldA();
    // Any member may ask for the project summary (money left out) — nothing else.
    const allowed = new Set([
      'POST /v1/projects/:id/exports',
      // A read sent as POST: the report's PDF (money left out for them).
      'POST /v1/projects/:id/reports/:reportId/pdf',
    ]);
    const done: string[] = [];
    for (const r of projectRoutes().filter((x) => x.method !== 'get')) {
      const res = await viewer.req(r.method, fill(r.path, ids, org.id), {
        kind: 'project_summary',
        format: 'csv',
        decision: 'approve',
        amount: 6_000_000,
        revision: 1,
        stageId: ids.stageId,
        note: 'x',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      });
      if (
        res.status < 400 &&
        !allowed.has(`${r.method.toUpperCase()} ${r.path}`)
      )
        done.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(done).toEqual([]);
  }, 120_000);

  it('removing a member shuts every door at once; an invitation opens only for its recipient', async () => {
    const { owner, supervisor, org, ids, pending } = await worldA();
    await supervisor.get(`/v1/projects/${ids.id}`).expect(200);
    const members = (
      await owner.get(`/v1/projects/${ids.id}/members`).expect(200)
    ).body as MemberView[];
    const sup = members.find((m) => m.displayName === 'Jean Habimana');
    expect(sup).toBeDefined();
    await owner
      .req('delete', `/v1/projects/${ids.id}/members/${sup!.membershipId}`)
      .expect(204);
    const still: string[] = [];
    for (const r of projectRoutes().filter((x) => x.method === 'get')) {
      const res = await supervisor.get(fill(r.path, ids, org.id));
      if (res.status !== 404) still.push(`GET ${r.path} → ${res.status}`);
    }
    expect(still).toEqual([]);
    // An invitation addressed to someone else: not theirs to open; the hint masks the number.
    for (const who of [supervisor, owner]) {
      const res = await who.get(`/v1/invitations/${pending.id}`).expect(403);
      expect(JSON.stringify(res.body)).not.toContain('788000299');
    }
  }, 120_000);

  it('file links work only as signed, short-lived links; exports and share links stay with their owner', async () => {
    const { owner, viewer, ids } = await worldA();
    // A signed link to a private file (the quote PDF; every file uses the same signing).
    const link = (
      await owner
        .post(`/v1/projects/${ids.id}/quotes/${ids.quoteId}/pdf`)
        .expect(200)
    ).body as { url: string };
    expect((await fetch(link.url)).status).toBe(200);
    const bare = link.url.split('?')[0];
    expect((await fetch(bare)).status).toBeGreaterThanOrEqual(400); // no signature, no file
    const tampered = link.url.replace(
      /(X-Amz-Signature=)([0-9a-f])/,
      (_, k: string, c: string) => `${k}${c === 'a' ? 'b' : 'a'}`,
    );
    expect(tampered).not.toBe(link.url);
    expect((await fetch(tampered)).status).toBeGreaterThanOrEqual(400);
    expect(
      (await fetch(`${new URL(bare).origin}/${bare.split('/')[3]}`)).status,
    ).toBeGreaterThanOrEqual(400); // no bucket listing
    // Someone else's export: not found, even for a member.
    await viewer
      .post(`/v1/projects/${ids.id}/exports/${ids.exportId}/download`)
      .expect(404);
    // A share link can be listed and stopped only by the people meant to.
    await viewer
      .get(`/v1/projects/${ids.id}/reports/${ids.reportId}/shares`)
      .expect(403);
    await viewer
      .post(
        `/v1/projects/${ids.id}/reports/${ids.reportId}/shares/${ids.shareId}/revoke`,
      )
      .expect(403);
  }, 120_000);
});
