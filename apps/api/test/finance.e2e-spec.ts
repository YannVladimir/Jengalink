import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type {
  BudgetChangeView,
  ClaimView,
  DecisionInbox,
  ExportList,
  ExportView,
  CreatedInvitation,
  OrganizationView,
  PaymentsOverview,
  ProjectBudget,
  ProjectMoney,
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

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(
    new Date(),
  );

/**
 * Financial tests (spec §24.3, A0): the worked example as A0 runs it (approved request → direct
 * expense, no orders), money racing for the same budget or the same claim, repeated requests,
 * advances, over-allocation, duplicate receipts and rounding. Totals must not move on retries.
 */
describe('financial integrity (e2e)', () => {
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
    return {
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

  /**
   * An active project with an accepted quote: Foundation (fixed, 18 m) and Cement works
   * (cost + 10% fee, estimate 1.1 m, so a cost budget of 1,000,000: the spec's cement budget).
   * The owner also invites a finance officer with financial visibility.
   */
  async function setup() {
    const contractor = await user('0788000071', 'Eric Mugisha');
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
      financialVisibility = false,
    ) => {
      const inv = (
        await by
          .post(`/v1/projects/${p.id}/invitations`, {
            channel: 'sms',
            recipient: phone,
            role,
            financialVisibility,
          })
          .expect(201)
      ).body as CreatedInvitation;
      const u = await user(phone, name);
      await u.post(`/v1/invitations/${inv.id}/accept`).expect(200);
      return u;
    };
    const owner = await inviteBy(
      contractor,
      '0788000072',
      'Aline Uwase',
      'owner',
    );
    const finance = await inviteBy(
      owner,
      '0788000073',
      'Grace Mukamana',
      'finance',
      true,
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
    const update = (
      await contractor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Foundation progress',
        })
        .expect(201)
    ).body as SiteUpdate;
    return { contractor, owner, finance, p, update };
  }

  const sp = (id: string) => `/v1/projects/${id}/spending`;
  const request600k = {
    milestoneIndex: 1,
    purpose: 'Cement for the foundation',
    lines: [
      {
        description: 'Cement bags of the agreed specification',
        quantity: '40',
        unit: 'bag',
        unitRate: 15_000,
      },
    ],
  };
  async function approvedRequest(
    contractor: User,
    owner: User,
    projectId: string,
    body = request600k,
  ) {
    const d = (await contractor.post(sp(projectId), body).expect(201))
      .body as SpendingView;
    const s = (
      await contractor
        .post(`${sp(projectId)}/${d.id}/submit`)
        .set('If-Match', `"${d.version}"`)
        .expect(200)
    ).body as SpendingView;
    return (
      await owner
        .post(`${sp(projectId)}/${s.id}/decision`, {
          decision: 'approve',
          amount: s.amount,
        })
        .set('If-Match', `"${s.version}"`)
        .expect(200)
    ).body as SpendingView;
  }
  async function approvedClaim(
    contractor: User,
    owner: User,
    projectId: string,
    updateId: string,
    amount: number,
  ) {
    const d = (
      await contractor
        .post(`/v1/projects/${projectId}/claims`, {
          milestoneIndex: 0,
          amount,
          siteUpdateIds: [updateId],
        })
        .expect(201)
    ).body as ClaimView;
    const s = (
      await contractor
        .post(`/v1/projects/${projectId}/claims/${d.id}/submit`)
        .set('If-Match', `"${d.version}"`)
        .expect(200)
    ).body as ClaimView;
    await owner
      .post(`/v1/projects/${projectId}/claims/${s.id}/decision`, {
        decision: 'approve',
        amount,
      })
      .set('If-Match', `"${s.version}"`)
      .expect(200);
    return s;
  }
  const line = async (u: User, projectId: string) =>
    (
      (await u.get(`/v1/projects/${projectId}/budget`).expect(200))
        .body as ProjectBudget
    ).lines[0];
  const movements = async () =>
    (
      await db.execute<{ kind: string; amount: string }>(
        sql`select kind, amount from budget_movements order by created_at`,
      )
    ).rows.map((r) => [r.kind, Number(r.amount)]);

  it('the worked example in A0 terms: reserve 600,000, post 300,000, pay 200,000, release the rest; retries change nothing', async () => {
    const { contractor, owner, finance, p } = await setup();
    expect(await line(owner, p.id)).toMatchObject({
      costBudget: 1_000_000,
      committed: 0,
      posted: 0,
      headroom: 1_000_000,
    });

    // Approval reserves: 600,000 committed, 400,000 headroom.
    const r = await approvedRequest(contractor, owner, p.id);
    expect(r).toMatchObject({ amount: 600_000, reserved: 600_000 });
    expect(await line(owner, p.id)).toMatchObject({
      committed: 600_000,
      posted: 0,
      headroom: 400_000,
    });

    // A 300,000 direct expense posted by finance: cost 300,000, commitment 300,000, headroom stays 400,000.
    const expense = {
      description: 'Cement, first delivery',
      supplierName: 'Kigali Hardware',
      expenseDate: today(),
      amount: 300_000,
    };
    const key = randomUUID();
    const after = (
      await finance
        .post(`${sp(p.id)}/${r.id}/expenses`, expense, key)
        .expect(201)
    ).body as SpendingView;
    expect(after).toMatchObject({ posted: 300_000, committed: 300_000 });
    expect(await line(owner, p.id)).toMatchObject({
      committed: 300_000,
      posted: 300_000,
      headroom: 400_000,
    });
    // The same request retried (a lost response): replayed, not posted twice.
    const again = await finance
      .post(`${sp(p.id)}/${r.id}/expenses`, expense, key)
      .expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await line(owner, p.id)).toMatchObject({
      committed: 300_000,
      posted: 300_000,
      headroom: 400_000,
    });

    // A verified 200,000 payment (an advance recorded by finance, confirmed by the owner):
    // cash paid 200,000 only after verification; posted cost does not move (SP09).
    const pay = `/v1/projects/${p.id}/payments`;
    let o = (
      await finance
        .post(pay, {
          payer: 'Aline Uwase',
          beneficiary: 'Kigali Hardware',
          amount: 200_000,
          method: 'cash',
          paymentDate: today(),
        })
        .expect(201)
    ).body as PaymentsOverview;
    expect(o).toMatchObject({ cashPaid: 0, pendingVerification: 200_000 });
    o = (
      await owner
        .post(`${pay}/${o.payments[0].id}/verify`, { decision: 'settle' })
        .set('If-Match', `"${o.payments[0].version}"`)
        .expect(200)
    ).body as PaymentsOverview;
    expect(o).toMatchObject({ cashPaid: 200_000, pendingVerification: 0 });
    expect(
      (
        (await owner.get(`/v1/projects/${p.id}/money`).expect(200))
          .body as ProjectMoney
      ).figures,
    ).toMatchObject({ advances: 200_000, paid: 0 });
    expect(await line(owner, p.id)).toMatchObject({
      posted: 300_000,
      headroom: 400_000,
    });

    // Closing releases the unused 300,000; a second close changes nothing.
    const current = (await owner.get(`${sp(p.id)}/${r.id}`).expect(200))
      .body as SpendingView;
    expect(current.version).toBe(after.version); // the replay changed nothing
    const closed = (
      await owner
        .post(`${sp(p.id)}/${r.id}/close`)
        .set('If-Match', `"${current.version}"`)
        .expect(200)
    ).body as SpendingView;
    expect(closed).toMatchObject({
      reserved: 600_000,
      posted: 300_000,
      released: 300_000,
      committed: 0,
    });
    await owner
      .post(`${sp(p.id)}/${r.id}/close`)
      .set('If-Match', `"${closed.version}"`)
      .expect(409);
    expect(await line(owner, p.id)).toMatchObject({
      committed: 0,
      posted: 300_000,
      headroom: 700_000,
    });
    expect(await movements()).toEqual([
      ['reserve', 600_000],
      ['convert', 300_000],
      ['release', 300_000],
    ]);
    // Stable: the same figures on a second read.
    expect(await line(contractor, p.id)).toEqual(await line(owner, p.id));
  });

  it('money racing for the same room: approvals, expenses, claim payments, claims under a fixed price, and a double tap', async () => {
    const { contractor, owner, finance, p, update } = await setup();

    // Three approvals of 400,000 against a 1,000,000 cost budget at the same moment: exactly two reserve.
    const big = {
      ...request600k,
      lines: [
        {
          description: 'Cement',
          quantity: '1',
          unit: 'lot',
          unitRate: 400_000,
        },
      ],
    };
    const sent: SpendingView[] = [];
    for (let i = 0; i < 3; i++) {
      const d = (await contractor.post(sp(p.id), big).expect(201))
        .body as SpendingView;
      sent.push(
        (
          await contractor
            .post(`${sp(p.id)}/${d.id}/submit`)
            .set('If-Match', `"${d.version}"`)
            .expect(200)
        ).body as SpendingView,
      );
    }
    const approvals = await Promise.all(
      sent.map((s) =>
        owner
          .post(`${sp(p.id)}/${s.id}/decision`, {
            decision: 'approve',
            amount: 400_000,
          })
          .set('If-Match', `"${s.version}"`),
      ),
    );
    expect(approvals.map((a) => a.status).sort()).toEqual([200, 200, 409]);
    expect(await line(owner, p.id)).toMatchObject({
      committed: 800_000,
      headroom: 200_000,
    });

    // Two expenses of 300,000 racing for one 400,000 reservation: one posts, the other is refused.
    const approved = approvals.findIndex((a) => a.status === 200);
    const target = sent[approved].id;
    const expenses = await Promise.all(
      [1, 2].map((n) =>
        finance.post(`${sp(p.id)}/${target}/expenses`, {
          description: `Cement ${n}`,
          expenseDate: today(),
          amount: 300_000,
        }),
      ),
    );
    expect(expenses.map((e) => e.status).sort()).toEqual([201, 409]);
    expect(await line(owner, p.id)).toMatchObject({
      posted: 300_000,
      committed: 500_000,
      headroom: 200_000,
    });

    // Two claims of 10 m against the 18 m fixed-price Foundation at the same moment: one fits.
    const claims = await Promise.all(
      [1, 2].map(() =>
        contractor.post(`/v1/projects/${p.id}/claims`, {
          milestoneIndex: 0,
          amount: 10_000_000,
          siteUpdateIds: [update.id],
        }),
      ),
    );
    expect(claims.map((c) => c.status).sort()).toEqual([201, 409]);
    const claim = claims.find((c) => c.status === 201)!.body as ClaimView;
    const s = (
      await contractor
        .post(`/v1/projects/${p.id}/claims/${claim.id}/submit`)
        .set('If-Match', `"${claim.version}"`)
        .expect(200)
    ).body as ClaimView;
    await owner
      .post(`/v1/projects/${p.id}/claims/${s.id}/decision`, {
        decision: 'approve',
        amount: 10_000_000,
      })
      .set('If-Match', `"${s.version}"`)
      .expect(200);

    // Two payments of 6 m racing for the 10 m claim: one is recorded, the other would overpay.
    const pay = `/v1/projects/${p.id}/payments`;
    const body = {
      claimId: s.id,
      payer: 'Aline Uwase',
      beneficiary: 'Ubaka Builders',
      amount: 6_000_000,
      method: 'cash',
      paymentDate: today(),
    };
    const payments = await Promise.all([1, 2].map(() => owner.post(pay, body)));
    expect(payments.map((x) => x.status).sort()).toEqual([201, 409]);

    // A double tap: the same request twice at once with one key records it once.
    const key = randomUUID();
    const taps = await Promise.all(
      [1, 2].map(() => owner.post(pay, { ...body, amount: 1_000_000 }, key)),
    );
    expect(taps.some((t) => t.status === 201)).toBe(true);
    expect(taps.every((t) => t.status === 201 || t.status === 409)).toBe(true);
    const o = (await owner.get(pay).expect(200)).body as PaymentsOverview;
    expect(o.payments.map((x) => x.amount).sort((a, b) => a - b)).toEqual([
      1_000_000, 6_000_000,
    ]);
    expect(o.payable[0]).toMatchObject({
      amount: 10_000_000,
      pending: 7_000_000,
      open: 3_000_000,
    });
  });

  it('repeated requests and corrections keep totals stable; over-allocation is refused; duplicates are flagged', async () => {
    const { contractor, owner, finance, p, update } = await setup();

    // The same Idempotency-Key replays creation everywhere money is created; a different body is refused.
    const key = randomUUID();
    const a = (await contractor.post(sp(p.id), request600k, key).expect(201))
      .body as SpendingView;
    const b = (await contractor.post(sp(p.id), request600k, key).expect(201))
      .body as SpendingView;
    expect(b.id).toBe(a.id);
    await contractor
      .post(sp(p.id), { ...request600k, purpose: 'Something else' }, key)
      .expect(409);
    const ck = randomUUID();
    const c1 = (
      await contractor
        .post(
          `/v1/projects/${p.id}/claims`,
          { milestoneIndex: 0, amount: 5_000_000, siteUpdateIds: [update.id] },
          ck,
        )
        .expect(201)
    ).body as ClaimView;
    const c2 = (
      await contractor
        .post(
          `/v1/projects/${p.id}/claims`,
          { milestoneIndex: 0, amount: 5_000_000, siteUpdateIds: [update.id] },
          ck,
        )
        .expect(201)
    ).body as ClaimView;
    expect(c2.id).toBe(c1.id);
    const chk = randomUUID();
    const change = {
      category: 'quantity_correction',
      reason: 'More cement than measured',
      lines: [{ milestoneIndex: 1, delta: 100_000 }],
    };
    const ch1 = (
      await contractor
        .post(`/v1/projects/${p.id}/changes`, change, chk)
        .expect(201)
    ).body as BudgetChangeView;
    const ch2 = (
      await contractor
        .post(`/v1/projects/${p.id}/changes`, change, chk)
        .expect(201)
    ).body as BudgetChangeView;
    expect(ch2.id).toBe(ch1.id);
    const counts = await db.execute<{ s: number; c: number; ch: number }>(
      sql`select (select count(*)::int from spending_requests) as s, (select count(*)::int from claims) as c, (select count(*)::int from budget_changes) as ch`,
    );
    expect(counts.rows[0]).toEqual({ s: 1, c: 1, ch: 1 });

    // Corrections: an approved claim edited to a lower amount counts once, at the new amount.
    const approved = await approvedClaim(
      contractor,
      owner,
      p.id,
      update.id,
      4_000_000,
    );
    const mine = (
      await contractor
        .get(`/v1/projects/${p.id}/claims/${approved.id}`)
        .expect(200)
    ).body as ClaimView;
    const revised = (
      await contractor
        .put(`/v1/projects/${p.id}/claims/${approved.id}`, {
          milestoneIndex: 0,
          amount: 3_500_000,
          siteUpdateIds: [update.id],
          changeNote: 'Measured again',
        })
        .set('If-Match', `"${mine.version}"`)
        .expect(200)
    ).body as ClaimView;
    await owner
      .post(`/v1/projects/${p.id}/claims/${approved.id}/decision`, {
        decision: 'approve',
        amount: 3_500_000,
      })
      .set('If-Match', `"${revised.version}"`)
      .expect(200);
    let money = (await owner.get(`/v1/projects/${p.id}/money`).expect(200))
      .body as ProjectMoney;
    expect(money.figures).toMatchObject({ approvedUnpaid: 3_500_000, paid: 0 });

    // Disputed and withdrawn payments never count as paid; over-allocation is refused.
    const pay = `/v1/projects/${p.id}/payments`;
    const base = {
      claimId: approved.id,
      payer: 'Aline Uwase',
      beneficiary: 'Ubaka Builders',
      method: 'cash',
      paymentDate: today(),
    };
    await owner.post(pay, { ...base, amount: 3_500_001 }).expect(409);
    let o = (await owner.post(pay, { ...base, amount: 2_000_000 }).expect(201))
      .body as PaymentsOverview;
    o = (
      await contractor
        .post(`${pay}/${o.payments[0].id}/verify`, {
          decision: 'dispute',
          note: 'Nothing arrived',
        })
        .set('If-Match', `"${o.payments[0].version}"`)
        .expect(200)
    ).body as PaymentsOverview;
    o = (await owner.post(pay, { ...base, amount: 1_000_000 }).expect(201))
      .body as PaymentsOverview;
    o = (
      await owner
        .post(`${pay}/${o.payments[0].id}/cancel`)
        .set('If-Match', `"${o.payments[0].version}"`)
        .expect(200)
    ).body as PaymentsOverview;
    expect(o).toMatchObject({ cashPaid: 0, pendingVerification: 0 });
    money = (await owner.get(`/v1/projects/${p.id}/money`).expect(200))
      .body as ProjectMoney;
    expect(money.figures).toMatchObject({ approvedUnpaid: 3_500_000, paid: 0 });

    // An expense can never exceed what is reserved.
    const r = await approvedRequest(contractor, owner, p.id, {
      ...request600k,
      lines: [
        {
          description: 'Cement',
          quantity: '1',
          unit: 'lot',
          unitRate: 100_000,
        },
      ],
    });
    await finance
      .post(`${sp(p.id)}/${r.id}/expenses`, {
        description: 'Cement',
        expenseDate: today(),
        amount: 100_001,
      })
      .expect(409);

    // Duplicate receipts: the same supplier invoice on two expenses is flagged on the second.
    const e1 = (
      await finance
        .post(`${sp(p.id)}/${r.id}/expenses`, {
          description: 'Cement A',
          expenseDate: today(),
          amount: 50_000,
        })
        .expect(201)
    ).body as SpendingView;
    const e2 = (
      await finance
        .post(`${sp(p.id)}/${r.id}/expenses`, {
          description: 'Cement B',
          expenseDate: today(),
          amount: 50_000,
        })
        .expect(201)
    ).body as SpendingView;
    const receipt = {
      supplierName: 'Kigali Hardware',
      supplierTin: '102345678',
      invoiceNumber: 'INV-7',
      invoiceDate: today(),
      total: 50_000,
    };
    await finance
      .put(
        `/v1/projects/${p.id}/expenses/${e1.expenses[0].id}/receipt`,
        receipt,
      )
      .expect(200);
    const withDup = (
      await finance
        .put(
          `/v1/projects/${p.id}/expenses/${e2.expenses[0].id}/receipt`,
          receipt,
        )
        .expect(200)
    ).body as SpendingView;
    const flagged = withDup.expenses.map(
      (e) => e.receipt?.duplicates.map((d) => d.kind) ?? [],
    );
    expect(flagged.flat()).toEqual(['invoice', 'invoice']);
  });

  it('rounds each line to the franc, then adds; the server recalculates whatever the client sends', async () => {
    const { contractor, p } = await setup();
    const r = (
      await contractor
        .post(sp(p.id), {
          ...request600k,
          amount: 1,
          lines: [
            { description: 'Sand', quantity: '1.5', unit: 'm3', unitRate: 3 },
            { description: 'Sand', quantity: '1.5', unit: 'm3', unitRate: 3 },
            { description: 'Wire', quantity: '0.333', unit: 'kg', unitRate: 3 },
            {
              description: 'Cement',
              quantity: '12.5',
              unit: 'bag',
              unitRate: 3_333,
            },
          ],
        })
        .expect(201)
    ).body as SpendingView;
    // 4.5 → 5 twice (not 9 → 9), 0.999 → 1, 41,662.5 → 41,663.
    expect(r.lines.map((l) => l.amount)).toEqual([5, 5, 1, 41_663]);
    expect(r.amount).toBe(41_674);
    await contractor
      .post(sp(p.id), {
        ...request600k,
        lines: [
          { description: 'Sand', quantity: '1.2345', unit: 'm3', unitRate: 3 },
        ],
      })
      .expect(400);
  });

  // Spec §4.2, §5: the decision inbox on Home.
  it('the decision inbox: each person sees only what they can decide, oldest first, with where to do it', async () => {
    const { contractor, owner, finance, p, update } = await setup();
    const inbox = async (u: User) =>
      (await u.get('/v1/decisions').expect(200)).body as DecisionInbox;
    expect(await inbox(owner)).toEqual({
      count: 0,
      oldestSince: null,
      items: [],
    });

    // 1. A receipt the contractor captured on an approved request's expense.
    const r = await approvedRequest(contractor, owner, p.id);
    const withExpense = (
      await contractor
        .post(`${sp(p.id)}/${r.id}/expenses`, {
          description: 'Cement',
          expenseDate: today(),
          amount: 300_000,
        })
        .expect(201)
    ).body as SpendingView;
    await contractor
      .put(
        `/v1/projects/${p.id}/expenses/${withExpense.expenses[0].id}/receipt`,
        {
          supplierName: 'Kigali Hardware',
          invoiceNumber: 'INV-9',
          invoiceDate: today(),
          total: 300_000,
        },
      )
      .expect(200);
    // 2. The stage sent for review.
    const timeline = (
      await contractor
        .get(`/v1/projects/${p.id}/stages/${update.stageId}/timeline`)
        .expect(200)
    ).body as { revision: number };
    await contractor
      .post(`/v1/projects/${p.id}/stages/${update.stageId}/submit`)
      .set('If-Match', `"${timeline.revision}"`)
      .expect(200);
    // 3. A claim sent (another one is already approved, so it is not waiting).
    const approved = await approvedClaim(
      contractor,
      owner,
      p.id,
      update.id,
      5_000_000,
    );
    const draft = (
      await contractor
        .post(`/v1/projects/${p.id}/claims`, {
          milestoneIndex: 0,
          amount: 4_000_000,
          siteUpdateIds: [update.id],
        })
        .expect(201)
    ).body as ClaimView;
    const sent = (
      await contractor
        .post(`/v1/projects/${p.id}/claims/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as ClaimView;
    // 4. A spending request sent.
    const d = (
      await contractor
        .post(sp(p.id), {
          ...request600k,
          lines: [{ ...request600k.lines[0], quantity: '10' }],
        })
        .expect(201)
    ).body as SpendingView;
    await contractor
      .post(`${sp(p.id)}/${d.id}/submit`)
      .set('If-Match', `"${d.version}"`)
      .expect(200);
    // 5. A payment the contractor recorded on the approved claim.
    await contractor
      .post(`/v1/projects/${p.id}/payments`, {
        claimId: approved.id,
        payer: 'Aline Uwase',
        beneficiary: 'Ubaka Builders',
        amount: 5_000_000,
        method: 'mtn_momo',
        reference: 'MP261011.0001.A1',
        paymentDate: today(),
      })
      .expect(201);

    const o = await inbox(owner);
    expect(o.items.map((x) => x.kind)).toEqual([
      'receipt',
      'stage_review',
      'claim',
      'spending',
      'payment',
    ]);
    expect(o).toMatchObject({ count: 5, oldestSince: o.items[0].since });
    expect(o.items.map((x) => x.since)).toEqual(
      [...o.items.map((x) => x.since)].sort(),
    );
    expect(o.items[2]).toMatchObject({
      projectName: 'Kicukiro House',
      title: `${sent.number} · Foundation`,
      amount: 4_000_000,
      path: `/project/${p.id}/claims/${sent.id}`,
    });
    expect(o.items[0]).toMatchObject({
      title: 'Kigali Hardware · INV-9',
      path: `/project/${p.id}/spending/${r.id}`,
    });
    expect(o.items[1].path).toBe(`/project/${p.id}/stages/${update.stageId}`);
    expect(o.items[4].path).toBe(`/project/${p.id}/payments`);
    // Finance reviews receipts and confirms payments; the contractor has nothing of their own to decide.
    expect((await inbox(finance)).items.map((x) => x.kind)).toEqual([
      'receipt',
      'payment',
    ]);
    expect(await inbox(contractor)).toEqual({
      count: 0,
      oldestSince: null,
      items: [],
    });

    // Deciding takes it out of the inbox.
    await owner
      .post(`/v1/projects/${p.id}/claims/${sent.id}/decision`, {
        decision: 'approve',
        amount: 4_000_000,
      })
      .set('If-Match', `"${sent.version}"`)
      .expect(200);
    expect((await inbox(owner)).items.map((x) => x.kind)).toEqual([
      'receipt',
      'stage_review',
      'spending',
      'payment',
    ]);
  });

  // Spec §12, §21: exports from one snapshot, private to the person who asked, money checked twice.
  it('exports: the money history and project summary as CSV and PDF, money only for money readers, private, rate-limited', async () => {
    const { contractor, owner, p, update } = await setup();
    // Money on the record: an approved request with an expense, an approved claim, a confirmed payment.
    const r = await approvedRequest(contractor, owner, p.id);
    await contractor
      .post(`${sp(p.id)}/${r.id}/expenses`, {
        description: '=SUM(A1) cement',
        supplierName: 'Kigali Hardware',
        expenseDate: today(),
        amount: 300_000,
      })
      .expect(201);
    const claim = await approvedClaim(
      contractor,
      owner,
      p.id,
      update.id,
      5_000_000,
    );
    const o = (
      await contractor
        .post(`/v1/projects/${p.id}/payments`, {
          claimId: claim.id,
          payer: 'Aline Uwase',
          beneficiary: 'Ubaka Builders',
          amount: 5_000_000,
          method: 'mtn_momo',
          reference: 'MP261011.0001.A1',
          paymentDate: today(),
        })
        .expect(201)
    ).body as PaymentsOverview;
    await owner
      .post(`/v1/projects/${p.id}/payments/${o.payments[0].id}/verify`, {
        decision: 'settle',
      })
      .set('If-Match', `"${o.payments[0].version}"`)
      .expect(200);
    // A site supervisor: a member without money access.
    const inv = (
      await contractor
        .post(`/v1/projects/${p.id}/invitations`, {
          channel: 'sms',
          recipient: '0722000079',
          role: 'supervisor',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const supervisor = await user('0722000079', 'Jean Habimana');
    await supervisor.post(`/v1/invitations/${inv.id}/accept`).expect(200);

    const base = `/v1/projects/${p.id}/exports`;
    await supervisor
      .post(base, { kind: 'money_history', format: 'csv' })
      .expect(403);
    await owner
      .post(base, { kind: 'money_history', format: 'xls' })
      .expect(400);
    const historyCsv = (
      await owner
        .post(base, { kind: 'money_history', format: 'csv' })
        .expect(201)
    ).body as ExportView;
    expect(historyCsv).toMatchObject({ status: 'queued', includesMoney: true });
    expect(historyCsv.fileName).toMatch(
      /^money-history-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const historyPdf = (
      await owner
        .post(base, { kind: 'money_history', format: 'pdf' })
        .expect(201)
    ).body as ExportView;
    const summaryPdf = (
      await owner
        .post(base, { kind: 'project_summary', format: 'pdf' })
        .expect(201)
    ).body as ExportView;
    const lean = (
      await supervisor
        .post(base, { kind: 'project_summary', format: 'csv' })
        .expect(201)
    ).body as ExportView;
    expect(lean.includesMoney).toBe(false);
    await owner.post(`${base}/${historyCsv.id}/download`).expect(409); // not made yet

    // The background job builds them.
    await jobs.start({ relayIntervalMs: 100, pollingIntervalSeconds: 0.5 });
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const q = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from project_exports where status = 'queued'`,
        );
        if (q.rows[0].n === 0 || Date.now() > deadline) break;
        await new Promise((res) => setTimeout(res, 200));
      }
    } finally {
      await jobs.stop();
    }
    const mine = (await owner.get(base).expect(200)).body as ExportList;
    expect(mine.canExportMoney).toBe(true);
    expect(mine.items.map((x) => [x.kind, x.format, x.status])).toEqual([
      ['project_summary', 'pdf', 'ready'],
      ['money_history', 'pdf', 'ready'],
      ['money_history', 'csv', 'ready'],
    ]);
    const theirs = (await supervisor.get(base).expect(200)).body as ExportList;
    expect(theirs).toMatchObject({
      canExportMoney: false,
      items: [{ id: lean.id, status: 'ready' }],
    });

    const fetchFile = async (u: User, id: string) => {
      const link = (await u.post(`${base}/${id}/download`).expect(200))
        .body as { url: string };
      return Buffer.from(await (await fetch(link.url)).arrayBuffer());
    };
    // The money history CSV: a BOM, one header row, every money event in order, formulas kept as text.
    const csv = (await fetchFile(owner, historyCsv.id)).toString('utf8');
    expect(
      csv.startsWith('\uFEFFDate,What,Reference,Details,Amount (RWF),By\r\n'),
    ).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n').slice(1);
    const types = lines.map((l) => l.split(',')[1]);
    expect(types).toEqual([
      'Agreement version',
      'Spending approved',
      'Expense posted',
      'Claim sent',
      'Claim approved',
      'Payment recorded',
      'Payment confirmed',
    ]);
    expect(lines[0]).toContain(',19100000,');
    expect(lines.find((l) => l.includes('Claim approved'))).toMatch(
      /,5000000,Aline Uwase$/,
    );
    expect(lines.find((l) => l.includes('Expense posted'))).toContain(
      ",'=SUM(A1) cement · Kigali Hardware,",
    ); // CSV injection defused
    for (const id of [historyPdf.id, summaryPdf.id])
      expect((await fetchFile(owner, id)).subarray(0, 5).toString()).toBe(
        '%PDF-',
      );

    // The supervisor's summary leaves money out; nobody downloads someone else's export.
    const leanCsv = (await fetchFile(supervisor, lean.id)).toString('utf8');
    expect(leanCsv).toContain('Foundation,100,');
    expect(leanCsv).toContain('Jean Habimana,site supervisor');
    expect(leanCsv).not.toMatch(/Agreed contract|19100000|Paid/);
    await supervisor.post(`${base}/${historyCsv.id}/download`).expect(404);

    // Money access is checked again at download time.
    await db.execute(
      sql`update project_memberships set financial_visibility = false, role = 'delegate' where project_id = ${p.id} and role = 'owner'`,
    );
    await owner.post(`${base}/${historyCsv.id}/download`).expect(403);
    await db.execute(
      sql`update project_memberships set financial_visibility = true, role = 'owner' where project_id = ${p.id} and role = 'delegate'`,
    );
    await owner.post(`${base}/${historyCsv.id}/download`).expect(200);

    // At most 10 an hour per person.
    for (let n = 3; n < 10; n++)
      await owner
        .post(base, { kind: 'project_summary', format: 'csv' })
        .expect(201);
    await owner
      .post(base, { kind: 'project_summary', format: 'csv' })
      .expect(429);
    const audit = await db.execute<{ action: string; n: number }>(
      sql`select action, count(*)::int as n from audit_events where action like 'export.%' group by 1 order by 1`,
    );
    expect(audit.rows).toEqual([
      { action: 'export.downloaded', n: 5 },
      { action: 'export.requested', n: 11 },
    ]);
  }, 90_000);
});
