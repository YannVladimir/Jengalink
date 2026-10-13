import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type {
  CreatedInvitation,
  OrganizationView,
  ProjectBudget,
  ProjectSummary,
  QuoteView,
  SpendingSummary,
  SpendingView,
  AgreementView,
  BudgetChangesOverview,
  BudgetChangeView,
  ClaimView,
  ProjectStage,
  SiteUpdate,
  StartOtpResponse,
  UploadGrantView,
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
const kigaliToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(
    new Date(),
  );
// A tiny but real PDF (a supplier receipt).
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
type Problem = { fieldErrors: { field: string; message: string }[] };

// Spec §6.2–6.5, §19.3 (A0): approval reserves budget, a posted expense converts it, closing releases the rest.
describe('spending requests (e2e)', () => {
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

  /** Active project; `agreed` adds an accepted quote: Foundation fixed, Plumbing cost + 10% (5.5 m estimate). */
  async function project(agreed = true) {
    const contractor = await user('0788000061', 'Eric Mugisha');
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
          contractValue: 23_500_000,
          stages: [
            { name: 'Foundation', weight: 60 },
            { name: 'Plumbing', weight: 40 },
          ],
        })
        .expect(201)
    ).body as ProjectSummary;
    const invite = async (phone: string, name: string, role: string) => {
      const inv = (
        await contractor
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
    const owner = await invite('0788000062', 'Aline Uwase', 'owner');
    const supervisor = await invite(
      '0722000063',
      'Jean Habimana',
      'supervisor',
    );
    const etag = (await owner.get(`/v1/projects/${p.id}`).expect(200)).headers
      .etag;
    await owner
      .post(`/v1/projects/${p.id}/acceptance`, { decision: 'accept' })
      .set('If-Match', etag)
      .expect(200);
    if (agreed) {
      const q = (
        await contractor
          .post(`/v1/projects/${p.id}/quotes`, {
            title: 'House',
            scope: 'Foundation and plumbing as drawn.',
            milestones: [
              { name: 'Foundation', amount: 18_000_000 },
              {
                name: 'Plumbing',
                amount: 5_500_000,
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
    }
    return { contractor, owner, supervisor, project: p };
  }

  const base = (id: string) => `/v1/projects/${id}/spending`;
  const cement = {
    milestoneIndex: 1,
    purpose: 'Pipes and fittings for the ground floor',
    requiredDate: inDays(7),
    lines: [
      {
        description: 'PVC pipes 110 mm',
        quantity: '40',
        unit: 'piece',
        unitRate: 15_000,
      },
      {
        description: 'Fittings',
        quantity: '2.5',
        unit: 'box',
        unitRate: 30_000,
      },
    ],
  };

  it('reserves on approval, converts on posted expenses, releases on close; the ledger is computed and frozen', async () => {
    const { contractor, owner, supervisor, project: p } = await project();
    const budget = async () =>
      (
        (await owner.get(`/v1/projects/${p.id}/budget`).expect(200))
          .body as ProjectBudget
      ).lines[0];

    expect(await budget()).toEqual({
      index: 1,
      name: 'Plumbing',
      feePercent: 10,
      estimate: 5_500_000,
      costBudget: 5_000_000,
      pending: 0,
      committed: 0,
      posted: 0,
      headroom: 5_000_000,
    });

    // Fixed-price packages carry no spending requests; the server prices the lines itself.
    await contractor
      .post(base(p.id), { ...cement, milestoneIndex: 0 })
      .expect(400);
    const draft = (
      await contractor.post(base(p.id), { ...cement, amount: 1 }).expect(201)
    ).body as SpendingView;
    expect(draft).toMatchObject({
      number: `SR-${kigaliToday().slice(0, 4)}-0001`,
      status: 'draft',
      amount: 675_000,
      milestoneName: 'Plumbing',
      canEdit: true,
    });
    expect(draft.lines.map((l) => l.amount)).toEqual([600_000, 75_000]);
    expect((await owner.get(base(p.id)).expect(200)).body).toEqual([]);
    await supervisor.get(base(p.id)).expect(403);
    await supervisor.get(`/v1/projects/${p.id}/budget`).expect(403);

    const sent = (
      await contractor
        .post(`${base(p.id)}/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as SpendingView;
    expect(await budget()).toMatchObject({
      pending: 675_000,
      committed: 0,
      headroom: 5_000_000,
    });

    // Only the owner side answers, on the exact version and total.
    const url = `${base(p.id)}/${sent.id}/decision`;
    await contractor
      .post(url, { decision: 'approve', amount: 675_000 })
      .set('If-Match', `"${sent.version}"`)
      .expect(403);
    await owner
      .post(url, { decision: 'approve', amount: 600_000 })
      .set('If-Match', `"${sent.version}"`)
      .expect(409);
    const key = randomUUID();
    const approved = (
      await owner
        .post(url, { decision: 'approve', amount: 675_000 }, key)
        .set('If-Match', `"${sent.version}"`)
        .expect(200)
    ).body as SpendingView;
    expect(approved).toMatchObject({
      status: 'approved',
      reserved: 675_000,
      committed: 675_000,
      posted: 0,
      // The owner authorizes; the contractor's side (or finance) records expenses.
      canPostExpense: false,
      canClose: true,
    });
    expect(
      (
        (await contractor.get(`${base(p.id)}/${sent.id}`).expect(200))
          .body as SpendingView
      ).canPostExpense,
    ).toBe(true);
    // A retried approval returns the same outcome and reserves nothing more.
    const again = await owner
      .post(url, { decision: 'approve', amount: 675_000 }, key)
      .set('If-Match', `"${sent.version}"`)
      .expect(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await budget()).toMatchObject({
      pending: 0,
      committed: 675_000,
      posted: 0,
      headroom: 4_325_000,
    });

    // A posted expense turns part of the reservation into cost: headroom does not move.
    const expense = {
      description: 'PVC pipes from Kigali Hardware',
      supplierName: 'Kigali Hardware Ltd',
      expenseDate: kigaliToday(),
      amount: 500_000,
    };
    await supervisor
      .post(`${base(p.id)}/${sent.id}/expenses`, expense)
      .expect(403);
    await contractor
      .post(`${base(p.id)}/${sent.id}/expenses`, {
        ...expense,
        expenseDate: inDays(3),
      })
      .expect(400);
    const spent = (
      await contractor
        .post(`${base(p.id)}/${sent.id}/expenses`, expense)
        .expect(201)
    ).body as SpendingView;
    expect(spent).toMatchObject({
      reserved: 675_000,
      posted: 500_000,
      committed: 175_000,
    });
    expect(spent.expenses).toMatchObject([
      {
        number: `E-${kigaliToday().slice(0, 4)}-0001`,
        amount: 500_000,
        byName: 'Eric Mugisha',
      },
    ]);
    expect(await budget()).toMatchObject({
      committed: 175_000,
      posted: 500_000,
      headroom: 4_325_000,
    });

    // Spending more than is reserved needs a new request.
    const over = await contractor
      .post(`${base(p.id)}/${sent.id}/expenses`, {
        ...expense,
        amount: 175_001,
      })
      .expect(409);
    expect((over.body as Problem).fieldErrors[0].field).toBe('amount');

    // Closing releases the unused 175,000 back to the headroom.
    const closed = (
      await owner
        .post(`${base(p.id)}/${sent.id}/close`)
        .set('If-Match', `"${spent.version}"`)
        .expect(200)
    ).body as SpendingView;
    expect(closed).toMatchObject({
      status: 'closed',
      reserved: 675_000,
      posted: 500_000,
      released: 175_000,
      committed: 0,
      canPostExpense: false,
    });
    expect(await budget()).toMatchObject({
      committed: 0,
      posted: 500_000,
      headroom: 4_500_000,
    });
    await contractor
      .post(`${base(p.id)}/${sent.id}/expenses`, expense)
      .expect(409);

    const list = (await owner.get(base(p.id)).expect(200))
      .body as SpendingSummary[];
    expect(
      list.map((r) => [r.status, r.amount, r.committed, r.posted]),
    ).toEqual([['closed', 675_000, 0, 500_000]]);

    // The ledger is append-only: one reserve, one convert, one release; the database refuses edits.
    const moves = await db.execute<{ kind: string; amount: string }>(
      sql`select kind, amount from budget_movements order by created_at`,
    );
    expect(moves.rows.map((r) => [r.kind, Number(r.amount)])).toEqual([
      ['reserve', 675_000],
      ['convert', 500_000],
      ['release', 175_000],
    ]);
    await expect(
      db.execute(sql`update budget_movements set amount = 1`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from expenses`)).rejects.toThrow();
  });

  it('two approvals racing for the same headroom: one reserves, the other gets the balances', async () => {
    const { contractor, owner, project: p } = await project();
    const big = {
      ...cement,
      lines: [
        {
          description: 'Pipes',
          quantity: '1',
          unit: 'lot',
          unitRate: 3_000_000,
        },
      ],
    };
    const sendOne = async () => {
      const d = (await contractor.post(base(p.id), big).expect(201))
        .body as SpendingView;
      return (
        await contractor
          .post(`${base(p.id)}/${d.id}/submit`)
          .set('If-Match', `"${d.version}"`)
          .expect(200)
      ).body as SpendingView;
    };
    const [a, b] = [await sendOne(), await sendOne()];
    const results = await Promise.all(
      [a, b].map((r) =>
        owner
          .post(`${base(p.id)}/${r.id}/decision`, {
            decision: 'approve',
            amount: 3_000_000,
          })
          .set('If-Match', `"${r.version}"`),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = results.find((r) => r.status === 409)!;
    expect((refused.body as { message: string }).message).toContain(
      'Only 2000000 of the 5000000',
    );
    const line = (
      (await owner.get(`/v1/projects/${p.id}/budget`).expect(200))
        .body as ProjectBudget
    ).lines[0];
    expect(line).toMatchObject({
      committed: 3_000_000,
      pending: 3_000_000,
      headroom: 2_000_000,
    });

    // A request over the headroom cannot even be sent.
    const d = (await contractor.post(base(p.id), big).expect(201))
      .body as SpendingView;
    await contractor
      .post(`${base(p.id)}/${d.id}/submit`)
      .set('If-Match', `"${d.version}"`)
      .expect(409);
  });

  it('needs an agreement with a cost + fee package', async () => {
    const { contractor, owner, project: p } = await project(false);
    expect(
      (await owner.get(`/v1/projects/${p.id}/budget`).expect(200)).body,
    ).toEqual({
      agreementVersion: null,
      currency: 'RWF',
      lines: [],
    });
    await contractor.post(base(p.id), cement).expect(409);
  });

  // Spec §26.1: EBM fields, original file, duplicates flagged, distinct states, independent review.
  it('captures supplier receipts with EBM fields, flags duplicates and mismatches, and records an independent review', async () => {
    const { contractor, owner, supervisor, project: p } = await project();
    const d = (
      await contractor
        .post(base(p.id), {
          ...cement,
          lines: [
            {
              description: 'Pipes',
              quantity: '1',
              unit: 'lot',
              unitRate: 1_000_000,
            },
          ],
        })
        .expect(201)
    ).body as SpendingView;
    const s1 = (
      await contractor
        .post(`${base(p.id)}/${d.id}/submit`)
        .set('If-Match', `"${d.version}"`)
        .expect(200)
    ).body as SpendingView;
    await owner
      .post(`${base(p.id)}/${s1.id}/decision`, {
        decision: 'approve',
        amount: 1_000_000,
      })
      .set('If-Match', `"${s1.version}"`)
      .expect(200);
    await contractor
      .post(`${base(p.id)}/${s1.id}/expenses`, {
        description: 'Pipes',
        expenseDate: kigaliToday(),
        amount: 500_000,
      })
      .expect(201);
    let view = (
      await contractor
        .post(`${base(p.id)}/${s1.id}/expenses`, {
          description: 'Fittings',
          expenseDate: kigaliToday(),
          amount: 100_000,
        })
        .expect(201)
    ).body as SpendingView;
    expect(view.missingReceipts).toBe(2);
    expect(
      view.expenses.map((e) => [e.receiptStatus, e.canAddReceipt]),
    ).toEqual([
      ['not_supplied', true],
      ['not_supplied', true],
    ]);
    const [fittings, pipes] = view.expenses;

    // The same PDF is uploaded for both receipts: a duplicate the file fingerprint finds.
    const upload = async () => {
      const grant = (
        await contractor
          .post(`/v1/projects/${p.id}/receipts/uploads`, {
            contentType: 'application/pdf',
            sizeBytes: PDF.length,
          })
          .expect(201)
      ).body as UploadGrantView;
      expect(
        (
          await fetch(grant.url, {
            method: 'PUT',
            headers: grant.headers,
            body: new Uint8Array(PDF),
          })
        ).status,
      ).toBe(200);
      return grant.key;
    };
    const receipt = {
      supplierName: 'Kigali Hardware Ltd',
      supplierTin: '102345678',
      invoiceNumber: 'INV-0042',
      invoiceDate: kigaliToday(),
      total: 500_000,
      vatAmount: 76_271,
      ebmReference: 'SDC010012345',
      qrPayload: 'https://example.invalid/ebm?r=42',
    };
    const url = (e: { id: string }) =>
      `/v1/projects/${p.id}/expenses/${e.id}/receipt`;

    // Who may capture, and field checks.
    await supervisor.put(url(pipes), receipt).expect(403);
    await owner.put(url(pipes), receipt).expect(403);
    await contractor
      .put(url(pipes), { ...receipt, supplierTin: '1234' })
      .expect(400);
    await contractor
      .put(url(pipes), { ...receipt, invoiceDate: inDays(2) })
      .expect(409);

    view = (
      await contractor
        .put(url(pipes), {
          ...receipt,
          file: { uploadKey: await upload(), fileName: 'INV-0042.pdf' },
        })
        .expect(200)
    ).body as SpendingView;
    const captured = view.expenses.find((e) => e.id === pipes.id)!;
    expect(captured.receiptStatus).toBe('captured');
    expect(captured.receipt).toMatchObject({
      supplierTin: '102345678',
      invoiceNumber: 'INV-0042',
      total: 500_000,
      vatAmount: 76_271,
      totalMatches: true,
      duplicates: [],
      capturedByName: 'Eric Mugisha',
      canEdit: true,
    });
    expect(captured.receipt!.file).toMatchObject({
      fileName: 'INV-0042.pdf',
      status: 'processing',
      url: null,
    });
    expect(view.missingReceipts).toBe(1);

    // The second expense gets the same invoice (different case) and the same file, with a total that does not match.
    view = (
      await contractor
        .put(url(fittings), {
          ...receipt,
          invoiceNumber: 'inv-0042',
          total: 90_000,
          vatAmount: null,
          file: { uploadKey: await upload(), fileName: 'copy.pdf' },
        })
        .expect(200)
    ).body as SpendingView;
    expect(view.missingReceipts).toBe(0);
    await jobs.start({ relayIntervalMs: 100, pollingIntervalSeconds: 0.5 });
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const r = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from media where scan_status = 'pending'`,
        );
        if (r.rows[0].n === 0 || Date.now() > deadline) break;
        await new Promise((res) => setTimeout(res, 200));
      }
    } finally {
      await jobs.stop();
    }
    view = (await owner.get(`${base(p.id)}/${s1.id}`).expect(200))
      .body as SpendingView;
    const second = view.expenses.find((e) => e.id === fittings.id)!.receipt!;
    expect(second.totalMatches).toBe(false);
    expect(
      second.duplicates.map((x) => [x.kind, x.expenseNumber]).sort(),
    ).toEqual([
      ['file', pipes.number],
      ['invoice', pipes.number],
    ]);
    expect(second.file?.status).toBe('ready');
    expect(second).toMatchObject({ canEdit: false, canReview: true });

    // Review: only the client side or finance, with If-Match; a discrepancy needs a note.
    const review = (e: { id: string }) => `${url(e)}/review`;
    await contractor
      .post(review(fittings), { status: 'manually_reviewed' })
      .set('If-Match', `"${second.version}"`)
      .expect(403);
    await owner
      .post(review(fittings), { status: 'manually_reviewed' })
      .expect(428);
    await owner
      .post(review(fittings), { status: 'discrepancy_found' })
      .set('If-Match', `"${second.version}"`)
      .expect(400);
    await owner
      .post(review(fittings), { status: 'externally_confirmed' })
      .set('If-Match', `"${second.version}"`)
      .expect(400);
    view = (
      await owner
        .post(review(fittings), {
          status: 'discrepancy_found',
          note: 'Same invoice as E-0001 and the total is 90,000, not 100,000',
        })
        .set('If-Match', `"${second.version}"`)
        .expect(200)
    ).body as SpendingView;
    const flagged = view.expenses.find((e) => e.id === fittings.id)!.receipt!;
    expect(flagged).toMatchObject({
      status: 'discrepancy_found',
      reviewedByName: 'Aline Uwase',
    });

    // The contractor corrects it: back to "captured", the old review cleared.
    view = (
      await contractor
        .put(url(fittings), {
          ...receipt,
          invoiceNumber: 'INV-0051',
          total: 100_000,
          vatAmount: null,
        })
        .set('If-Match', `"${flagged.version}"`)
        .expect(200)
    ).body as SpendingView;
    const corrected = view.expenses.find((e) => e.id === fittings.id)!.receipt!;
    expect(corrected).toMatchObject({
      status: 'captured',
      reviewNote: null,
      reviewedByName: null,
      totalMatches: true,
    });
    expect(corrected.duplicates.map((x) => x.kind)).toEqual(['file']);

    view = (
      await owner
        .post(review(fittings), { status: 'manually_reviewed' })
        .set('If-Match', `"${corrected.version}"`)
        .expect(200)
    ).body as SpendingView;
    const done = view.expenses.find((e) => e.id === fittings.id)!.receipt!;
    expect(done).toMatchObject({
      status: 'manually_reviewed',
      canReview: false,
    });
    // Accepted receipts no longer change.
    await contractor
      .put(url(fittings), { ...receipt, total: 1, vatAmount: null })
      .set('If-Match', `"${done.version}"`)
      .expect(409);

    const audit = await db.execute<{ action: string }>(
      sql`select action from audit_events where action like 'receipt.%' order by created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'receipt.captured',
      'receipt.captured',
      'receipt.reviewed',
      'receipt.updated',
      'receipt.reviewed',
    ]);
  }, 60_000);

  // Spec §2 A0, §6.1, §7: a budget change is approved by the owner and applied as a new agreement version.
  it('budget changes: floors, owner approval applies a new agreement version once, out-of-date changes are refused', async () => {
    const { contractor, owner, supervisor, project: p } = await project();
    // Money already used: a 9 m claim on Foundation (fixed), 675,000 approved spending on Plumbing (cost + 10%).
    const stages = (
      await contractor.get(`/v1/projects/${p.id}/stages`).expect(200)
    ).body as ProjectStage[];
    const update = (
      await contractor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Done',
        })
        .expect(201)
    ).body as SiteUpdate;
    const claim = (
      await contractor
        .post(`/v1/projects/${p.id}/claims`, {
          milestoneIndex: 0,
          amount: 9_000_000,
          siteUpdateIds: [update.id],
        })
        .expect(201)
    ).body as ClaimView;
    await contractor
      .post(`/v1/projects/${p.id}/claims/${claim.id}/submit`)
      .set('If-Match', `"${claim.version}"`)
      .expect(200);
    const sr = (await contractor.post(base(p.id), cement).expect(201))
      .body as SpendingView;
    const srSent = (
      await contractor
        .post(`${base(p.id)}/${sr.id}/submit`)
        .set('If-Match', `"${sr.version}"`)
        .expect(200)
    ).body as SpendingView;
    await owner
      .post(`${base(p.id)}/${sr.id}/decision`, {
        decision: 'approve',
        amount: 675_000,
      })
      .set('If-Match', `"${srSent.version}"`)
      .expect(200);

    const ch = `/v1/projects/${p.id}/changes`;
    await supervisor.get(ch).expect(403);
    let ov = (await contractor.get(ch).expect(200))
      .body as BudgetChangesOverview;
    expect(ov).toMatchObject({
      agreementVersion: 1,
      original: 23_500_000,
      additions: 0,
      reductions: 0,
      current: 23_500_000,
      canPropose: true,
    });
    expect(
      ((await owner.get(ch).expect(200)).body as BudgetChangesOverview)
        .canPropose,
    ).toBe(false);
    const proposal = {
      category: 'owner_request',
      reason: 'Bigger windows on the east side and a boundary wall',
      scheduleDays: 10,
      lines: [
        { milestoneIndex: 0, delta: 1_500_000 },
        {
          newPackage: { name: 'Boundary wall', basis: 'fixed' },
          delta: 2_000_000,
        },
      ],
    };
    await owner.post(ch, proposal).expect(403);
    await contractor
      .post(ch, {
        ...proposal,
        lines: [{ newPackage: { name: 'plumbing', basis: 'fixed' }, delta: 1 }],
      })
      .expect(400);

    // A reduction below what is used is refused when sent: Plumbing 5.5 m → 700,000 is under 742,500 (675,000 + fee).
    const tooLow = (
      await contractor
        .post(ch, {
          ...proposal,
          lines: [{ milestoneIndex: 1, delta: -4_800_000 }],
        })
        .expect(201)
    ).body as BudgetChangeView;
    expect(tooLow.lines[0]).toMatchObject({
      before: 5_500_000,
      after: 700_000,
      floor: 742_500,
    });
    await contractor
      .post(`${ch}/${tooLow.id}/submit`)
      .set('If-Match', `"${tooLow.version}"`)
      .expect(409);
    // Foundation cannot drop under the 9 m already claimed either.
    const under = (
      await contractor
        .post(ch, {
          ...proposal,
          lines: [{ milestoneIndex: 0, delta: -9_000_001 }],
        })
        .expect(201)
    ).body as BudgetChangeView;
    expect(under.lines[0].floor).toBe(9_000_000);
    await contractor
      .post(`${ch}/${under.id}/submit`)
      .set('If-Match', `"${under.version}"`)
      .expect(409);

    const draft = (await contractor.post(ch, proposal).expect(201))
      .body as BudgetChangeView;
    expect(draft).toMatchObject({
      status: 'draft',
      netDelta: 3_500_000,
      contractBefore: 23_500_000,
      contractAfter: 27_000_000,
      baseVersion: 1,
      stale: false,
    });
    await owner.get(`${ch}/${draft.id}`).expect(404);
    const sent = (
      await contractor
        .post(`${ch}/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as BudgetChangeView;
    // A second change written on version 1 too.
    const other = (
      await contractor
        .post(ch, {
          ...proposal,
          lines: [{ milestoneIndex: 1, delta: 100_000 }],
        })
        .expect(201)
    ).body as BudgetChangeView;
    const otherSent = (
      await contractor
        .post(`${ch}/${other.id}/submit`)
        .set('If-Match', `"${other.version}"`)
        .expect(200)
    ).body as BudgetChangeView;

    const seen = (await owner.get(`${ch}/${sent.id}`).expect(200))
      .body as BudgetChangeView;
    expect(seen).toMatchObject({ canDecide: true, canEdit: false });
    expect(seen.lines.map((l) => [l.name, l.before, l.delta, l.after])).toEqual(
      [
        ['Foundation', 18_000_000, 1_500_000, 19_500_000],
        ['Boundary wall', 0, 2_000_000, 2_000_000],
      ],
    );
    await contractor
      .post(`${ch}/${sent.id}/decision`, {
        decision: 'approve',
        netDelta: 3_500_000,
      })
      .set('If-Match', `"${seen.version}"`)
      .expect(403);
    await owner
      .post(`${ch}/${sent.id}/decision`, {
        decision: 'approve',
        netDelta: 3_400_000,
      })
      .set('If-Match', `"${seen.version}"`)
      .expect(409);
    await owner
      .post(`${ch}/${sent.id}/decision`, { decision: 'reject' })
      .set('If-Match', `"${seen.version}"`)
      .expect(400);
    const applied = (
      await owner
        .post(`${ch}/${sent.id}/decision`, {
          decision: 'approve',
          netDelta: 3_500_000,
        })
        .set('If-Match', `"${seen.version}"`)
        .expect(200)
    ).body as BudgetChangeView;
    expect(applied).toMatchObject({
      status: 'applied',
      appliedVersion: 2,
      canDecide: false,
    });
    await owner
      .post(`${ch}/${sent.id}/decision`, {
        decision: 'approve',
        netDelta: 3_500_000,
      })
      .set('If-Match', `"${applied.version}"`)
      .expect(409);

    // The new version, the new contract value, and the history.
    const versions = (
      await owner.get(`/v1/projects/${p.id}/agreements`).expect(200)
    ).body as AgreementView[];
    expect(
      versions.map((a) => [a.version, a.contractValue, a.changeNumber]),
    ).toEqual([
      [2, 27_000_000, sent.number],
      [1, 23_500_000, null],
    ]);
    expect(versions[0].milestones.map((m) => [m.name, m.amount])).toEqual([
      ['Foundation', 19_500_000],
      ['Plumbing', 5_500_000],
      ['Boundary wall', 2_000_000],
    ]);
    expect(
      (
        (await owner.get(`/v1/projects/${p.id}`).expect(200)).body as {
          contractValue: number;
        }
      ).contractValue,
    ).toBe(27_000_000);
    ov = (await owner.get(ch).expect(200)).body as BudgetChangesOverview;
    expect(ov).toMatchObject({
      agreementVersion: 2,
      original: 23_500_000,
      additions: 3_500_000,
      reductions: 0,
      current: 27_000_000,
    });
    expect(
      ov.lines.map((l) => [l.name, l.original, l.changes, l.current]),
    ).toEqual([
      ['Foundation', 18_000_000, 1_500_000, 19_500_000],
      ['Plumbing', 5_500_000, 0, 5_500_000],
      ['Boundary wall', 0, 2_000_000, 2_000_000],
    ]);

    // The other change was written on version 1: out of date until the contractor saves it again.
    const stale = (await owner.get(`${ch}/${other.id}`).expect(200))
      .body as BudgetChangeView;
    expect(stale.stale).toBe(true);
    await owner
      .post(`${ch}/${other.id}/decision`, {
        decision: 'approve',
        netDelta: 100_000,
      })
      .set('If-Match', `"${otherSent.version}"`)
      .expect(409);
    const rebased = (
      await contractor
        .put(`${ch}/${other.id}`, {
          ...proposal,
          lines: [{ milestoneIndex: 1, delta: 100_000 }],
        })
        .set('If-Match', `"${otherSent.version}"`)
        .expect(200)
    ).body as BudgetChangeView;
    expect(rebased).toMatchObject({
      baseVersion: 2,
      stale: false,
      status: 'submitted',
    });
    const v3 = (
      await owner
        .post(`${ch}/${other.id}/decision`, {
          decision: 'approve',
          netDelta: 100_000,
        })
        .set('If-Match', `"${rebased.version}"`)
        .expect(200)
    ).body as BudgetChangeView;
    expect(v3).toMatchObject({ appliedVersion: 3, contractAfter: 27_100_000 });

    await expect(
      db.execute(sql`update budget_change_decisions set net_delta = 1`),
    ).rejects.toThrow();
  });
});
