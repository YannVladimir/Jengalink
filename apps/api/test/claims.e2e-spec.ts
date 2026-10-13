import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type {
  ClaimMilestones,
  ClaimSummary,
  ClaimView,
  MoneyAcross,
  PaymentsOverview,
  ProjectMoney,
  CreatedInvitation,
  OrganizationView,
  ProjectStage,
  ProjectSummary,
  QuoteView,
  SiteUpdate,
  StartOtpResponse,
  UploadGrantView,
  VerifyOtpResponse,
} from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
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
const kigaliYear = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' })
    .format(new Date())
    .slice(0, 4);
// A tiny but real PDF (an invoice, say).
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
let JPEG: Buffer;
type Problem = { fieldErrors: { field: string; message: string }[] };

// Spec §37.1: a payment claim on an agreed milestone, with evidence. A record only.
describe('payment claims (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;
  let jobs: JobsService;

  beforeAll(async () => {
    JPEG = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#7a8c99' },
    })
      .jpeg()
      .toBuffer();
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

  /** Runs the background jobs until no file is waiting for the pipeline. */
  async function processFiles() {
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
  }

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
      post: (url: string, body?: object) =>
        http()
          .post(url)
          .set(auth)
          .set('Idempotency-Key', randomUUID())
          .send(body ?? {}),
      put: (url: string, body: object) => http().put(url).set(auth).send(body),
    };
  }
  type User = Awaited<ReturnType<typeof user>>;

  /** An active project; `agreed` also has an accepted quote (fixed Foundation, cost-plus Plumbing). */
  async function project(agreed = true) {
    const contractor = await user('0788000051', 'Eric Mugisha');
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
    const owner = await invite('0788000052', 'Aline Uwase', 'owner');
    const supervisor = await invite(
      '0722000053',
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
    const stages = (
      await contractor.get(`/v1/projects/${p.id}/stages`).expect(200)
    ).body as ProjectStage[];
    return { contractor, owner, supervisor, project: p, stages };
  }

  async function upload(
    who: User,
    url: string,
    contentType: string,
    body: Buffer,
  ) {
    const grant = (
      await who.post(url, { contentType, sizeBytes: body.length }).expect(201)
    ).body as UploadGrantView;
    const put = await fetch(grant.url, {
      method: 'PUT',
      headers: grant.headers,
      body: new Uint8Array(body),
    });
    expect(put.status).toBe(200);
    return grant.key;
  }

  const base = (projectId: string) => `/v1/projects/${projectId}/claims`;

  it('claims a milestone with evidence: private draft, fixed-price ceiling, scanned files, then submitted', async () => {
    const {
      contractor,
      owner,
      supervisor,
      project: p,
      stages,
    } = await project();

    // Evidence from site: the supervisor's update with a photo.
    const photoKey = await upload(
      supervisor,
      `/v1/projects/${p.id}/uploads`,
      'image/jpeg',
      JPEG,
    );
    const update = (
      await supervisor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Foundation finished',
          photos: [{ uploadKey: photoKey }],
        })
        .expect(201)
    ).body as SiteUpdate;

    const ms = (await contractor.get(`${base(p.id)}/milestones`).expect(200))
      .body as ClaimMilestones;
    expect(ms).toMatchObject({ agreementVersion: 1, currency: 'RWF' });
    expect(
      ms.milestones.map((m) => [m.name, m.basis, m.claimed, m.remaining]),
    ).toEqual([
      ['Foundation', 'fixed', 0, 18_000_000],
      ['Plumbing', 'reimbursable', 0, null],
    ]);

    // Files: an invoice (PDF), a photo, and a "PDF" that is not one.
    const invoice = await upload(
      contractor,
      `${base(p.id)}/uploads`,
      'application/pdf',
      PDF,
    );
    const site = await upload(
      contractor,
      `${base(p.id)}/uploads`,
      'image/jpeg',
      JPEG,
    );
    const fake = await upload(
      contractor,
      `${base(p.id)}/uploads`,
      'application/pdf',
      JPEG,
    );
    // A site-update upload key is not a claim upload.
    const other = await upload(
      contractor,
      `/v1/projects/${p.id}/uploads`,
      'image/jpeg',
      JPEG,
    );
    await contractor
      .post(base(p.id), {
        milestoneIndex: 0,
        amount: 1000,
        files: [{ uploadKey: other }],
      })
      .expect(400);

    const created = (
      await contractor
        .post(base(p.id), {
          milestoneIndex: 0,
          amount: 10_000_000,
          note: 'Foundation complete as agreed',
          siteUpdateIds: [update.id],
          files: [
            { uploadKey: invoice, fileName: 'Invoice 041.pdf' },
            { uploadKey: site },
            { uploadKey: fake, fileName: 'scan.pdf' },
          ],
        })
        .expect(201)
    ).body as ClaimView;
    expect(created).toMatchObject({
      number: `C-${kigaliYear()}-0001`,
      status: 'draft',
      milestoneName: 'Foundation',
      milestoneAmount: 18_000_000,
      basis: 'fixed',
      amount: 10_000_000,
      claimedBefore: 0,
      agreementVersion: 1,
      createdByName: 'Eric Mugisha',
      canEdit: true,
    });
    expect(created.updates.map((u) => u.id)).toEqual([update.id]);
    // Nobody gets a link before the virus scan.
    expect(
      created.files.map((f) => [f.kind, f.fileName, f.status, f.url]),
    ).toEqual([
      ['document', 'Invoice 041.pdf', 'processing', null],
      ['photo', null, 'processing', null],
      ['document', 'scan.pdf', 'processing', null],
    ]);

    // A draft is the contractor's business; a supervisor without financial visibility sees no money.
    expect((await owner.get(base(p.id)).expect(200)).body).toEqual([]);
    await owner.get(`${base(p.id)}/${created.id}`).expect(404);
    await supervisor.get(base(p.id)).expect(403);
    await supervisor
      .post(base(p.id), { milestoneIndex: 0, amount: 1 })
      .expect(403);

    // The fixed price is a ceiling, drafts included; a cost-plus estimate is not.
    const over = await contractor
      .post(base(p.id), {
        milestoneIndex: 0,
        amount: 8_000_001,
        siteUpdateIds: [update.id],
      })
      .expect(409);
    expect((over.body as Problem).fieldErrors).toEqual([
      { field: 'amount', message: 'Over the agreed price' },
    ]);
    const plumbing = (
      await contractor
        .post(base(p.id), { milestoneIndex: 1, amount: 6_000_000 })
        .expect(201)
    ).body as ClaimView;
    expect(plumbing).toMatchObject({ basis: 'reimbursable', feePercent: 10 });
    await contractor
      .post(base(p.id), { milestoneIndex: 2, amount: 1 })
      .expect(400);

    // Submitting needs evidence.
    const noEvidence = await contractor
      .post(`${base(p.id)}/${plumbing.id}/submit`)
      .set('If-Match', `"${plumbing.version}"`)
      .expect(409);
    expect((noEvidence.body as Problem).fieldErrors[0].field).toBe('evidence');

    await processFiles();
    const scanned = (
      await contractor.get(`${base(p.id)}/${created.id}`).expect(200)
    ).body as ClaimView;
    expect(scanned.files.map((f) => f.status)).toEqual([
      'ready',
      'ready',
      'failed',
    ]);
    const pdf = await fetch(scanned.files[0].url!);
    expect(pdf.headers.get('content-disposition')).toContain('Invoice 041.pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).equals(PDF)).toBe(true);
    expect(scanned.files[1].thumbUrl).toBeTruthy();

    // Edit the draft: drop the bad file, lower the amount. Versions protect against overwriting.
    await contractor
      .put(`${base(p.id)}/${created.id}`, {
        milestoneIndex: 0,
        amount: 9_000_000,
      })
      .expect(428);
    const edited = (
      await contractor
        .put(`${base(p.id)}/${created.id}`, {
          milestoneIndex: 0,
          amount: 9_000_000,
          note: 'Foundation complete as agreed',
          siteUpdateIds: [update.id],
          removeFileIds: [scanned.files[2].id],
        })
        .set('If-Match', `"${scanned.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(edited.files.map((f) => f.fileName)).toEqual([
      'Invoice 041.pdf',
      null,
    ]);
    expect(edited.amount).toBe(9_000_000);

    const submitted = (
      await contractor
        .post(`${base(p.id)}/${created.id}/submit`)
        .set('If-Match', `"${edited.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(submitted).toMatchObject({
      status: 'submitted',
      submittedByName: 'Eric Mugisha',
      revisionNo: 1,
      savingSendsRevision: true,
    });
    // Editing a claim already sent needs a reason (it sends the next revision).
    await contractor
      .put(`${base(p.id)}/${created.id}`, { milestoneIndex: 0, amount: 1 })
      .set('If-Match', `"${submitted.version}"`)
      .expect(400);

    // The owner now reads it with its evidence; their totals leave out the contractor's drafts.
    const list = (await owner.get(base(p.id)).expect(200))
      .body as ClaimSummary[];
    expect(
      list.map((c) => [c.number, c.status, c.amount, c.evidenceCount]),
    ).toEqual([[`C-${kigaliYear()}-0001`, 'submitted', 9_000_000, 3]]);
    const seen = (await owner.get(`${base(p.id)}/${created.id}`).expect(200))
      .body as ClaimView;
    expect(seen.canEdit).toBe(false);
    expect(seen.updates[0].photos[0].status).toBe('ready');
    expect(seen.files.map((f) => f.status)).toEqual(['ready', 'ready']);
    const ownerMs = (await owner.get(`${base(p.id)}/milestones`).expect(200))
      .body as ClaimMilestones;
    expect(ownerMs.milestones.map((m) => m.claimed)).toEqual([9_000_000, 0]);
    const mine = (await contractor.get(`${base(p.id)}/milestones`).expect(200))
      .body as ClaimMilestones;
    expect(mine.milestones.map((m) => m.claimed)).toEqual([
      9_000_000, 6_000_000,
    ]);

    // Withdrawing frees the amount again.
    const cancelled = (
      await contractor
        .post(`${base(p.id)}/${created.id}/cancel`)
        .set('If-Match', `"${submitted.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(cancelled.status).toBe('cancelled');
    const after = (await contractor.get(`${base(p.id)}/milestones`).expect(200))
      .body as ClaimMilestones;
    expect(after.milestones[0].remaining).toBe(18_000_000);

    const audit = await db.execute<{ action: string }>(
      sql`select action from audit_events where action like 'claim.%' order by created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'claim.created',
      'claim.created',
      'claim.submitted',
      'claim.cancelled',
    ]);
  }, 60_000);

  it('needs an agreement first', async () => {
    const { contractor, project: p } = await project(false);
    const ms = (await contractor.get(`${base(p.id)}/milestones`).expect(200))
      .body as ClaimMilestones;
    expect(ms).toEqual({
      agreementId: null,
      agreementVersion: null,
      currency: 'RWF',
      milestones: [],
    });
    await contractor
      .post(base(p.id), { milestoneIndex: 0, amount: 1 })
      .expect(409);
  });

  it('the owner answers the exact version and amount: changes asked, fixed, approved', async () => {
    const {
      contractor,
      owner,
      supervisor,
      project: p,
      stages,
    } = await project();
    const update = (
      await contractor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Foundation done',
        })
        .expect(201)
    ).body as SiteUpdate;
    const draft = (
      await contractor
        .post(base(p.id), {
          milestoneIndex: 0,
          amount: 9_000_000,
          siteUpdateIds: [update.id],
        })
        .expect(201)
    ).body as ClaimView;
    const sent = (
      await contractor
        .post(`${base(p.id)}/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as ClaimView;
    const url = `${base(p.id)}/${sent.id}/decision`;
    const approve = { decision: 'approve', amount: 9_000_000 };

    // Only the client side answers; the contractor never approves their own claim.
    expect(sent.canDecide).toBe(false);
    await contractor
      .post(url, approve)
      .set('If-Match', `"${sent.version}"`)
      .expect(403);
    await supervisor
      .post(url, approve)
      .set('If-Match', `"${sent.version}"`)
      .expect(403);
    const seen = (await owner.get(`${base(p.id)}/${sent.id}`).expect(200))
      .body as ClaimView;
    expect(seen).toMatchObject({ canDecide: true, decisions: [] });

    await owner.post(url, approve).expect(428);
    await owner
      .post(url, { ...approve, amount: 9_000_001 })
      .set('If-Match', `"${seen.version}"`)
      .expect(409);
    await owner
      .post(url, { decision: 'reject', amount: 9_000_000 })
      .set('If-Match', `"${seen.version}"`)
      .expect(400);

    const asked = (
      await owner
        .post(url, {
          decision: 'request_changes',
          amount: 9_000_000,
          note: 'Please attach the concrete invoice',
        })
        .set('If-Match', `"${seen.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(asked).toMatchObject({
      status: 'changes_requested',
      canDecide: false,
    });
    expect(asked.decisions).toMatchObject([
      {
        kind: 'changes_requested',
        amount: 9_000_000,
        note: 'Please attach the concrete invoice',
        byName: 'Aline Uwase',
      },
    ]);

    // The contractor fixes it and sends it again; the owner's old version is stale.
    const mine = (await contractor.get(`${base(p.id)}/${sent.id}`).expect(200))
      .body as ClaimView;
    expect(mine.canEdit).toBe(true);
    const fixed = (
      await contractor
        .put(`${base(p.id)}/${sent.id}`, {
          milestoneIndex: 0,
          amount: 8_500_000,
          note: 'Invoice attached',
          siteUpdateIds: [update.id],
        })
        .set('If-Match', `"${mine.version}"`)
        .expect(200)
    ).body as ClaimView;
    const resent = (
      await contractor
        .post(`${base(p.id)}/${sent.id}/submit`)
        .set('If-Match', `"${fixed.version}"`)
        .expect(200)
    ).body as ClaimView;
    await owner
      .post(url, { decision: 'approve', amount: 8_500_000 })
      .set('If-Match', `"${asked.version}"`)
      .expect(412);
    const approved = (
      await owner
        .post(url, { decision: 'approve', amount: 8_500_000 })
        .set('If-Match', `"${resent.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(approved).toMatchObject({
      status: 'approved',
      canDecide: false,
      canEdit: false,
    });
    expect(approved.decisions.map((d) => [d.kind, d.amount])).toEqual([
      ['approved', 8_500_000],
      ['changes_requested', 9_000_000],
    ]);
    await owner
      .post(url, {
        decision: 'reject',
        amount: 8_500_000,
        note: 'Changed my mind',
      })
      .set('If-Match', `"${approved.version}"`)
      .expect(409);
    // Approved still counts against the fixed price; nothing was paid.
    const ms = (await owner.get(`${base(p.id)}/milestones`).expect(200))
      .body as ClaimMilestones;
    expect(ms.milestones[0]).toMatchObject({
      claimed: 8_500_000,
      remaining: 9_500_000,
    });

    // The answers are a record: the database refuses to change them.
    await expect(
      db.execute(sql`update claim_decisions set amount = 1`),
    ).rejects.toThrow();
    const audit = await db.execute<{ action: string }>(
      sql`select action from audit_events where action in ('claim.approved', 'claim.changes_requested') order by created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'claim.changes_requested',
      'claim.approved',
    ]);
  });

  it('editing a sent claim sends a new revision and cancels an earlier approval', async () => {
    const { contractor, owner, project: p, stages } = await project();
    const update = (
      await contractor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Foundation done',
        })
        .expect(201)
    ).body as SiteUpdate;
    const invoice = await upload(
      contractor,
      `${base(p.id)}/uploads`,
      'application/pdf',
      PDF,
    );
    const draft = (
      await contractor
        .post(base(p.id), {
          milestoneIndex: 0,
          amount: 9_000_000,
          siteUpdateIds: [update.id],
          files: [{ uploadKey: invoice, fileName: 'Invoice 1.pdf' }],
        })
        .expect(201)
    ).body as ClaimView;
    const sent = (
      await contractor
        .post(`${base(p.id)}/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as ClaimView;
    const approved = (
      await owner
        .post(`${base(p.id)}/${sent.id}/decision`, {
          decision: 'approve',
          amount: 9_000_000,
        })
        .set('If-Match', `"${sent.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(approved.status).toBe('approved');

    // The contractor finds a mistake after approval: lower amount, invoice taken off.
    const mine = (await contractor.get(`${base(p.id)}/${sent.id}`).expect(200))
      .body as ClaimView;
    expect(mine).toMatchObject({ canEdit: true, savingSendsRevision: true });
    await contractor
      .put(`${base(p.id)}/${sent.id}`, {
        milestoneIndex: 1,
        amount: 8_000_000,
        siteUpdateIds: [update.id],
        changeNote: 'Wrong milestone',
      })
      .set('If-Match', `"${mine.version}"`)
      .expect(409);
    const revised = (
      await contractor
        .put(`${base(p.id)}/${sent.id}`, {
          milestoneIndex: 0,
          amount: 8_000_000,
          siteUpdateIds: [update.id],
          removeFileIds: [mine.files[0].id],
          changeNote: 'Only 8 m was poured; invoice was for the whole job',
        })
        .set('If-Match', `"${mine.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(revised).toMatchObject({
      status: 'submitted',
      revisionNo: 2,
      amount: 8_000_000,
      files: [],
    });
    expect(
      revised.revisions.map((r) => [
        r.revisionNo,
        r.amount,
        r.cancelledApproval,
        r.changeNote,
      ]),
    ).toEqual([
      [
        2,
        8_000_000,
        true,
        'Only 8 m was poured; invoice was for the whole job',
      ],
      [1, 9_000_000, false, null],
    ]);

    // The owner must answer revision 2; the old approval answered revision 1.
    const seen = (await owner.get(`${base(p.id)}/${sent.id}`).expect(200))
      .body as ClaimView;
    expect(seen.canDecide).toBe(true);
    expect(seen.decisions.map((d) => [d.kind, d.revisionNo])).toEqual([
      ['approved', 1],
    ]);
    await owner
      .post(`${base(p.id)}/${sent.id}/decision`, {
        decision: 'approve',
        amount: 8_000_000,
      })
      .set('If-Match', `"${approved.version}"`)
      .expect(412);
    const again = (
      await owner
        .post(`${base(p.id)}/${sent.id}/decision`, {
          decision: 'approve',
          amount: 8_000_000,
        })
        .set('If-Match', `"${seen.version}"`)
        .expect(200)
    ).body as ClaimView;
    expect(again.decisions.map((d) => [d.kind, d.revisionNo])).toEqual([
      ['approved', 2],
      ['approved', 1],
    ]);

    // What revision 1 showed is kept: the invoice row stays, hidden; revisions cannot change.
    const kept = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from media where claim_id = ${sent.id} and removed_at is not null`,
    );
    expect(kept.rows[0].n).toBe(1);
    const frozen = await db.execute<{ file_ids: string[] }>(
      sql`select file_ids from claim_revisions where claim_id = ${sent.id} order by revision_no`,
    );
    expect(frozen.rows.map((r) => r.file_ids.length)).toEqual([1, 0]);
    await expect(
      db.execute(sql`update claim_revisions set amount = 1`),
    ).rejects.toThrow();
    const audit = await db.execute<{ action: string }>(
      sql`select action from audit_events where action in ('claim.revised', 'claim.approval_cancelled') order by created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'claim.approval_cancelled',
      'claim.revised',
    ]);
  });

  // Spec §6.6: external payments are recorded with proof and become cash paid only once verified.
  it('records payments made outside JengaLink, verifies them independently, and marks the claim paid', async () => {
    const {
      contractor,
      owner,
      supervisor,
      project: p,
      stages,
    } = await project();
    const update = (
      await contractor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Foundation done',
        })
        .expect(201)
    ).body as SiteUpdate;
    const draft = (
      await contractor
        .post(base(p.id), {
          milestoneIndex: 0,
          amount: 9_000_000,
          siteUpdateIds: [update.id],
        })
        .expect(201)
    ).body as ClaimView;
    const sent = (
      await contractor
        .post(`${base(p.id)}/${draft.id}/submit`)
        .set('If-Match', `"${draft.version}"`)
        .expect(200)
    ).body as ClaimView;
    await owner
      .post(`${base(p.id)}/${sent.id}/decision`, {
        decision: 'approve',
        amount: 9_000_000,
      })
      .set('If-Match', `"${sent.version}"`)
      .expect(200);

    const pay = `/v1/projects/${p.id}/payments`;
    await supervisor.get(pay).expect(403);
    const proof = await upload(owner, `${pay}/uploads`, 'application/pdf', PDF);
    const momo = {
      claimId: sent.id,
      payer: 'Aline Uwase',
      beneficiary: 'Ubaka Builders',
      amount: 5_000_000,
      method: 'mtn_momo',
      reference: 'MP261010.1234.A56789',
      paymentDate: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Kigali',
      }).format(new Date()),
    };
    await owner.post(pay, { ...momo, reference: null }).expect(400);
    await owner.post(pay, { ...momo, amount: 9_000_001 }).expect(409);
    let o = (
      await owner
        .post(pay, {
          ...momo,
          files: [{ uploadKey: proof, fileName: 'momo.pdf' }],
        })
        .expect(201)
    ).body as PaymentsOverview;
    expect(o).toMatchObject({
      cashPaid: 0,
      pendingVerification: 5_000_000,
      owedOnClaims: 9_000_000,
    });
    expect(o.payable).toMatchObject([
      {
        number: sent.number,
        amount: 9_000_000,
        paid: 0,
        pending: 5_000_000,
        open: 4_000_000,
      },
    ]);
    const first = o.payments[0];
    expect(first).toMatchObject({
      status: 'pending_verification',
      claimNumber: sent.number,
      recordedByName: 'Aline Uwase',
      canVerify: false,
      canCancel: true,
    });
    expect(first.files.map((f) => f.fileName)).toEqual(['momo.pdf']);
    const claimNow = (await owner.get(`${base(p.id)}/${sent.id}`).expect(200))
      .body as ClaimView;
    expect(claimNow).toMatchObject({
      status: 'approved',
      paidAmount: 0,
      pendingPayments: 5_000_000,
    });

    // Only someone independent confirms: not whoever recorded it.
    await owner
      .post(`${pay}/${first.id}/verify`, { decision: 'settle' })
      .set('If-Match', `"${first.version}"`)
      .expect(403);
    const theirs = (await contractor.get(pay).expect(200))
      .body as PaymentsOverview;
    expect(theirs.payments[0].canVerify).toBe(true);
    await contractor
      .post(`${pay}/${first.id}/verify`, { decision: 'settle' })
      .expect(428);
    o = (
      await contractor
        .post(`${pay}/${first.id}/verify`, { decision: 'settle' })
        .set('If-Match', `"${first.version}"`)
        .expect(200)
    ).body as PaymentsOverview;
    expect(o).toMatchObject({ cashPaid: 5_000_000, pendingVerification: 0 });
    expect(o.payments[0]).toMatchObject({
      status: 'settled',
      verifiedByName: 'Eric Mugisha',
    });

    // Money recorded on a claim fixes it: no more edits.
    const mine = (await contractor.get(`${base(p.id)}/${sent.id}`).expect(200))
      .body as ClaimView;
    await contractor
      .put(`${base(p.id)}/${sent.id}`, {
        milestoneIndex: 0,
        amount: 8_000_000,
        siteUpdateIds: [update.id],
        changeNote: 'Lower',
      })
      .set('If-Match', `"${mine.version}"`)
      .expect(409);

    // A second entry with the same MoMo reference is flagged; the owner disputes it.
    o = (
      await contractor
        .post(pay, {
          ...momo,
          claimId: null,
          payer: 'Ubaka Builders',
          beneficiary: 'Kigali Hardware',
          amount: 100_000,
          reference: 'mp261010.1234.a56789',
        })
        .expect(201)
    ).body as PaymentsOverview;
    const dup = o.payments[0];
    expect(dup.sameReference).toEqual([first.number]);
    await owner
      .post(`${pay}/${dup.id}/verify`, { decision: 'dispute' })
      .set('If-Match', `"${dup.version}"`)
      .expect(400);
    o = (
      await owner
        .post(`${pay}/${dup.id}/verify`, {
          decision: 'dispute',
          note: 'Same MoMo transaction as the claim payment',
        })
        .set('If-Match', `"${dup.version}"`)
        .expect(200)
    ).body as PaymentsOverview;
    expect(o.payments[0]).toMatchObject({
      status: 'disputed',
      verificationNote: 'Same MoMo transaction as the claim payment',
    });

    // The contractor records an advance and withdraws it.
    o = (
      await contractor
        .post(pay, {
          ...momo,
          claimId: null,
          method: 'cash',
          reference: null,
          amount: 200_000,
        })
        .expect(201)
    ).body as PaymentsOverview;
    o = (
      await contractor
        .post(`${pay}/${o.payments[0].id}/cancel`)
        .set('If-Match', `"${o.payments[0].version}"`)
        .expect(200)
    ).body as PaymentsOverview;
    expect(o.payments[0].status).toBe('cancelled');

    // The rest in cash, confirmed: the claim is paid.
    o = (
      await owner
        .post(pay, {
          ...momo,
          method: 'cash',
          reference: null,
          amount: 4_000_000,
        })
        .expect(201)
    ).body as PaymentsOverview;
    o = (
      await contractor
        .post(`${pay}/${o.payments[0].id}/verify`, { decision: 'settle' })
        .set('If-Match', `"${o.payments[0].version}"`)
        .expect(200)
    ).body as PaymentsOverview;
    expect(o).toMatchObject({
      cashPaid: 9_000_000,
      pendingVerification: 0,
      owedOnClaims: 0,
      payable: [],
    });
    const paid = (await owner.get(`${base(p.id)}/${sent.id}`).expect(200))
      .body as ClaimView;
    expect(paid).toMatchObject({
      status: 'paid',
      paidAmount: 9_000_000,
      canEdit: false,
    });
    await owner
      .post(pay, { ...momo, method: 'cash', reference: null, amount: 1 })
      .expect(409);

    const audit = await db.execute<{ action: string }>(
      sql`select action from audit_events where action like 'payment.%' order by created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'payment.recorded',
      'payment.settled',
      'payment.recorded',
      'payment.disputed',
      'payment.recorded',
      'payment.cancelled',
      'payment.recorded',
      'payment.settled',
    ]);
  });

  // Spec §4.4 / §36.1: the Money screen is computed from claims, answers and confirmed payments.
  it('the Money screen: contract figures, claim steps and what waits on each side, per project and across projects', async () => {
    const {
      contractor,
      owner,
      supervisor,
      project: p,
      stages,
    } = await project();
    const update = (
      await contractor
        .post(`/v1/projects/${p.id}/updates`, {
          stageId: stages[0].id,
          note: 'Foundation done',
        })
        .expect(201)
    ).body as SiteUpdate;
    const claimOf = async (amount: number) => {
      const d = (
        await contractor
          .post(base(p.id), {
            milestoneIndex: 0,
            amount,
            siteUpdateIds: [update.id],
          })
          .expect(201)
      ).body as ClaimView;
      return (
        await contractor
          .post(`${base(p.id)}/${d.id}/submit`)
          .set('If-Match', `"${d.version}"`)
          .expect(200)
      ).body as ClaimView;
    };
    const first = await claimOf(9_000_000);
    await owner
      .post(`${base(p.id)}/${first.id}/decision`, {
        decision: 'approve',
        amount: 9_000_000,
      })
      .set('If-Match', `"${first.version}"`)
      .expect(200);
    await claimOf(3_000_000); // waiting for the owner
    const pay = `/v1/projects/${p.id}/payments`;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
    }).format(new Date());
    let o = (
      await owner
        .post(pay, {
          claimId: first.id,
          payer: 'Aline',
          beneficiary: 'Ubaka',
          amount: 5_000_000,
          method: 'cash',
          paymentDate: today,
        })
        .expect(201)
    ).body as PaymentsOverview;
    await contractor
      .post(`${pay}/${o.payments[0].id}/verify`, { decision: 'settle' })
      .set('If-Match', `"${o.payments[0].version}"`)
      .expect(200);
    o = (
      await owner
        .post(pay, {
          claimId: first.id,
          payer: 'Aline',
          beneficiary: 'Ubaka',
          amount: 1_000_000,
          method: 'cash',
          paymentDate: today,
        })
        .expect(201)
    ).body as PaymentsOverview;

    const money = `/v1/projects/${p.id}/money`;
    await supervisor.get(money).expect(403);
    const mine = (await owner.get(money).expect(200)).body as ProjectMoney;
    expect(mine).toMatchObject({
      side: 'client',
      figures: {
        contract: 23_500_000,
        paid: 5_000_000,
        approvedUnpaid: 4_000_000,
        awaitingDecision: 3_000_000,
        stillToCome: 14_500_000,
        pendingVerification: 1_000_000,
        advances: 0,
      },
      spending: { costBudget: 5_000_000, posted: 0, committed: 0 },
      actions: {
        claimsToDecide: 1,
        paymentsToConfirm: 0,
        spendingToDecide: 0,
        receiptsMissing: 0,
      },
    });
    // Claims newest first, with the dates the step tracker needs.
    expect(
      mine.claims.map((c) => [
        c.amount,
        c.status,
        !!c.approvedAt,
        c.paidAt,
        c.paid,
      ]),
    ).toEqual([
      [3_000_000, 'submitted', false, null, 0],
      [9_000_000, 'approved', true, null, 5_000_000],
    ]);
    expect(mine.payments.map((x) => [x.amount, x.status])).toEqual([
      [1_000_000, 'pending_verification'],
      [5_000_000, 'settled'],
    ]);

    const theirs = (await contractor.get(money).expect(200))
      .body as ProjectMoney;
    expect(theirs).toMatchObject({
      side: 'contractor',
      actions: { claimsToDecide: 0, paymentsToConfirm: 1 },
    });

    // Across projects: owed to the contractor, owed by the owner; the supervisor sees no money.
    const acrossC = (await contractor.get('/v1/money').expect(200))
      .body as MoneyAcross;
    expect(acrossC).toMatchObject({
      owedToMe: 4_000_000,
      owedByMe: 0,
      awaitingDecision: 3_000_000,
      pendingVerification: 1_000_000,
    });
    expect(acrossC.actions.paymentsToConfirm).toBe(1);
    expect(acrossC.projects.map((r) => [r.projectName, r.side])).toEqual([
      ['Kicukiro House', 'contractor'],
    ]);
    const acrossO = (await owner.get('/v1/money').expect(200))
      .body as MoneyAcross;
    expect(acrossO).toMatchObject({ owedToMe: 0, owedByMe: 4_000_000 });
    expect(acrossO.actions.claimsToDecide).toBe(1);
    expect(
      ((await supervisor.get('/v1/money').expect(200)).body as MoneyAcross)
        .projects,
    ).toEqual([]);
  });
});
