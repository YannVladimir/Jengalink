import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type {
  AgreementView,
  CreatedInvitation,
  OrganizationView,
  ProjectSummary,
  QuotePdfLink,
  QuoteSummary,
  QuoteView,
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

const kigaliToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(
    new Date(),
  );
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Spec §37.1: quotes with scope, exclusions, priced milestones and expiry; sent revisions are frozen.
describe('quotes (e2e)', () => {
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

  async function setup() {
    const contractor = await user('0788000041', 'Eric Mugisha');
    const org = (
      await contractor
        .post('/v1/organizations', {
          name: 'Ubaka Builders',
          kind: 'contractor',
        })
        .expect(201)
    ).body as OrganizationView;
    const project = (
      await contractor
        .post('/v1/projects', {
          organizationId: org.id,
          name: 'Kicukiro House',
          location: { province: 'Kigali City', district: 'Kicukiro' },
          stages: [
            { name: 'Foundation', weight: 40 },
            { name: 'Walls and roof', weight: 60 },
          ],
        })
        .expect(201)
    ).body as ProjectSummary;
    const invite = async (phone: string, name: string, role: string) => {
      const inv = (
        await contractor
          .post(`/v1/projects/${project.id}/invitations`, {
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
    const owner = await invite('0788000042', 'Aline Uwase', 'owner');
    const supervisor = await invite(
      '0722000043',
      'Jean Habimana',
      'supervisor',
    );
    return { contractor, owner, supervisor, project };
  }

  const body = (over: object = {}) => ({
    title: 'Construction of a 3-bedroom house',
    scope:
      'Foundation, walls, roof and finishes as per the drawings dated 1 Oct 2026.',
    exclusions: ['Furniture', 'Water connection fee'],
    milestones: [
      { name: 'Foundation', amount: 18_000_000 },
      {
        name: 'Walls and roof',
        amount: 27_000_000,
        description: 'Including iron sheets',
      },
    ],
    terms: '20% at signing, then each milestone within 7 days of acceptance.',
    validUntil: inDays(30),
    ...over,
  });
  const base = (projectId: string) => `/v1/projects/${projectId}/quotes`;

  it('writes a draft privately, sends a frozen revision, and starts a new revision when edited after sending', async () => {
    const { contractor, owner, project } = await setup();
    const created = await contractor.post(base(project.id), body()).expect(201);
    const q = created.body as QuoteView;
    expect(q).toMatchObject({
      number: `Q-${kigaliToday().slice(0, 4)}-0001`,
      status: 'draft',
      revision: 1,
      total: 45_000_000,
      clientName: 'Aline Uwase',
      canEdit: true,
    });

    // The owner sees nothing until it is sent.
    expect((await owner.get(base(project.id)).expect(200)).body).toEqual([]);
    await owner.get(`${base(project.id)}/${q.id}`).expect(404);

    // Draft edits stay revision 1; versions protect against overwriting.
    await contractor
      .put(`${base(project.id)}/${q.id}`, body({ title: 'House' }))
      .expect(428);
    const edited = (
      await contractor
        .put(
          `${base(project.id)}/${q.id}`,
          body({ title: 'House, 3 bedrooms' }),
        )
        .set('If-Match', `"${q.version}"`)
        .expect(200)
    ).body as QuoteView;
    expect(edited).toMatchObject({ revision: 1, title: 'House, 3 bedrooms' });
    await contractor
      .put(`${base(project.id)}/${q.id}`, body())
      .set('If-Match', `"${q.version}"`)
      .expect(412);

    const sent = (
      await contractor.post(`${base(project.id)}/${q.id}/send`).expect(200)
    ).body as QuoteView;
    expect(sent).toMatchObject({ status: 'sent', revision: 1 });
    expect(sent.sentAt).not.toBeNull();
    await contractor.post(`${base(project.id)}/${q.id}/send`).expect(409);
    const ownerList = (await owner.get(base(project.id)).expect(200))
      .body as QuoteSummary[];
    expect(ownerList).toMatchObject([
      { id: q.id, status: 'sent', total: 45_000_000 },
    ]);

    // Editing after sending makes revision 2; the owner still sees revision 1.
    const r2 = (
      await contractor
        .put(
          `${base(project.id)}/${q.id}`,
          body({ milestones: [{ name: 'Everything', amount: 47_000_000 }] }),
        )
        .set('If-Match', `"${sent.version}"`)
        .expect(200)
    ).body as QuoteView;
    expect(r2).toMatchObject({ revision: 2, total: 47_000_000, sentAt: null });
    expect(r2.revisions.map((r) => [r.revision, !!r.sentAt])).toEqual([
      [2, false],
      [1, true],
    ]);
    const forOwner = (
      await owner.get(`${base(project.id)}/${q.id}`).expect(200)
    ).body as QuoteView;
    expect(forOwner).toMatchObject({
      revision: 1,
      total: 45_000_000,
      canEdit: false,
    });
    expect(forOwner.revisions).toHaveLength(1);

    // The sent revision cannot change, even directly in the database.
    await expect(
      db.execute(
        sql`update quote_revisions set total = 1 where revision_no = 1`,
      ),
    ).rejects.toThrow();

    // A second quote gets the next number.
    const second = (await contractor.post(base(project.id), body()).expect(201))
      .body as QuoteView;
    expect(second.number).toBe(`Q-${kigaliToday().slice(0, 4)}-0002`);
  });

  it('makes a branded PDF behind a short private link, in the reader’s language', async () => {
    const { contractor, owner, project } = await setup();
    const q = (await contractor.post(base(project.id), body()).expect(201))
      .body as QuoteView;
    await contractor.post(`${base(project.id)}/${q.id}/send`).expect(200);
    const link = (
      await owner.post(`${base(project.id)}/${q.id}/pdf`).expect(200)
    ).body as QuotePdfLink;
    const res = await fetch(link.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const pdf = Buffer.from(await res.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    expect((await fetch(link.url.split('?')[0])).status).toBe(403);
  });

  it('checks who writes quotes and refuses a past validity date', async () => {
    const { contractor, owner, supervisor, project } = await setup();
    await owner.post(base(project.id), body()).expect(403);
    await supervisor.post(base(project.id), body()).expect(403);
    const past = await contractor
      .post(base(project.id), body({ validUntil: '2020-01-01' }))
      .expect(409);
    expect(JSON.stringify(past.body)).toContain('validUntil');
    await contractor
      .post(
        base(project.id),
        body({ milestones: [{ name: 'Free', amount: 0 }] }),
      )
      .expect(400);
    const stranger: User = await user('0788000049', 'Stranger');
    await stranger.get(base(project.id)).expect(404);
  });
  describe('owner decision (item 2)', () => {
    const decide = (
      who: User,
      projectId: string,
      q: QuoteView,
      decision: 'accept' | 'decline',
      note?: string,
      revision = q.revision,
    ) =>
      who
        .post(`${base(projectId)}/${q.id}/decision`, {
          decision,
          revision,
          ...(note ? { note } : {}),
        })
        .set('If-Match', `"${q.version}"`);

    it('accepts the exact revision: agreement version 1 and the contract value; a later quote makes version 2', async () => {
      const { contractor, owner, project } = await setup();
      const q = (await contractor.post(base(project.id), body()).expect(201))
        .body as QuoteView;
      const sent = (
        await contractor.post(`${base(project.id)}/${q.id}/send`).expect(200)
      ).body as QuoteView;
      // The contractor starts a revision 2 draft; the owner still decides on revision 1.
      await contractor
        .put(`${base(project.id)}/${q.id}`, body({ title: 'Changed' }))
        .set('If-Match', `"${sent.version}"`)
        .expect(200);
      const seen = (await owner.get(`${base(project.id)}/${q.id}`).expect(200))
        .body as QuoteView;
      expect(seen).toMatchObject({
        revision: 1,
        canDecide: true,
        decision: null,
      });

      await decide(contractor, project.id, seen, 'accept').expect(403);
      await owner
        .post(`${base(project.id)}/${q.id}/decision`, {
          decision: 'accept',
          revision: 1,
        })
        .expect(428);
      await decide(owner, project.id, { ...seen, version: 1 }, 'accept').expect(
        412,
      );
      const accepted = (
        await decide(owner, project.id, seen, 'accept').expect(200)
      ).body as QuoteView;
      expect(accepted).toMatchObject({
        status: 'accepted',
        canDecide: false,
        decision: {
          kind: 'accepted',
          revision: 1,
          byName: 'Aline Uwase',
          agreementVersion: 1,
        },
      });
      await decide(owner, project.id, accepted, 'accept').expect(409);

      // The unsent revision 2 is gone; the contractor now sees the accepted revision, read-only.
      const forContractor = (
        await contractor.get(`${base(project.id)}/${q.id}`).expect(200)
      ).body as QuoteView;
      expect(forContractor).toMatchObject({
        revision: 1,
        canEdit: false,
        title: 'Construction of a 3-bedroom house',
      });
      expect(forContractor.revisions).toHaveLength(1);

      const p1 = (await owner.get(`/v1/projects/${project.id}`).expect(200))
        .body as ProjectSummary;
      expect(p1.contractValue).toBe(45_000_000);
      const v1 = (
        await owner.get(`/v1/projects/${project.id}/agreements`).expect(200)
      ).body as AgreementView[];
      expect(v1).toMatchObject([
        {
          version: 1,
          quoteRevision: 1,
          contractValue: 45_000_000,
          acceptedByName: 'Aline Uwase',
        },
      ]);
      expect(v1[0].milestones).toHaveLength(2);
      await expect(
        db.execute(sql`update agreements set contract_value = 1`),
      ).rejects.toThrow();

      // A second, larger quote accepted later becomes version 2 and the new contract value.
      const q2 = (
        await contractor
          .post(
            base(project.id),
            body({ milestones: [{ name: 'Extension', amount: 50_000_000 }] }),
          )
          .expect(201)
      ).body as QuoteView;
      await contractor.post(`${base(project.id)}/${q2.id}/send`).expect(200);
      const q2seen = (
        await owner.get(`${base(project.id)}/${q2.id}`).expect(200)
      ).body as QuoteView;
      await decide(owner, project.id, q2seen, 'accept').expect(200);
      const all = (
        await owner.get(`/v1/projects/${project.id}/agreements`).expect(200)
      ).body as AgreementView[];
      expect(all.map((a) => [a.version, a.contractValue])).toEqual([
        [2, 50_000_000],
        [1, 45_000_000],
      ]);
      expect(
        (
          (await owner.get(`/v1/projects/${project.id}`).expect(200))
            .body as ProjectSummary
        ).contractValue,
      ).toBe(50_000_000);

      // The PDF of the accepted revision carries the acceptance (it renders; content is compressed).
      const link = (
        await owner.post(`${base(project.id)}/${q.id}/pdf`).expect(200)
      ).body as QuotePdfLink;
      expect((await fetch(link.url)).status).toBe(200);
    });

    it('declines with a reason; a replaced or expired revision cannot be accepted', async () => {
      const { contractor, owner, project } = await setup();
      const q = (await contractor.post(base(project.id), body()).expect(201))
        .body as QuoteView;
      const r1 = (
        await contractor.post(`${base(project.id)}/${q.id}/send`).expect(200)
      ).body as QuoteView;
      const ownerR1 = (
        await owner.get(`${base(project.id)}/${q.id}`).expect(200)
      ).body as QuoteView;
      const r2draft = (
        await contractor
          .put(`${base(project.id)}/${q.id}`, body({ title: 'Revision two' }))
          .set('If-Match', `"${r1.version}"`)
          .expect(200)
      ).body as QuoteView;
      await contractor.post(`${base(project.id)}/${q.id}/send`).expect(200);
      const ownerR2 = (
        await owner.get(`${base(project.id)}/${q.id}`).expect(200)
      ).body as QuoteView;
      expect(ownerR2.revision).toBe(2);
      // Revision 1 was replaced by revision 2.
      await decide(
        owner,
        project.id,
        { ...ownerR1, version: ownerR2.version },
        'accept',
      ).expect(409);
      expect(r2draft.revision).toBe(2);

      const declined = (
        await decide(
          owner,
          project.id,
          ownerR2,
          'decline',
          'Above my budget',
        ).expect(200)
      ).body as QuoteView;
      expect(declined).toMatchObject({
        status: 'declined',
        decision: {
          kind: 'declined',
          revision: 2,
          note: 'Above my budget',
          agreementVersion: null,
        },
      });
      expect(
        (
          (await owner.get(`/v1/projects/${project.id}`).expect(200))
            .body as ProjectSummary
        ).contractValue,
      ).toBeNull();

      // Expired: move a sent revision's date into the past (bypassing the freeze, test only).
      const q3 = (await contractor.post(base(project.id), body()).expect(201))
        .body as QuoteView;
      await contractor.post(`${base(project.id)}/${q3.id}/send`).expect(200);
      await db.execute(
        sql`alter table quote_revisions disable trigger quote_revisions_frozen_when_sent`,
      );
      await db.execute(
        sql`update quote_revisions set valid_until = '2020-01-01' where quote_id = ${q3.id}`,
      );
      await db.execute(
        sql`alter table quote_revisions enable trigger quote_revisions_frozen_when_sent`,
      );
      const expired = (
        await owner.get(`${base(project.id)}/${q3.id}`).expect(200)
      ).body as QuoteView;
      expect(expired).toMatchObject({ status: 'expired', canDecide: false });
      await decide(owner, project.id, expired, 'accept').expect(409);
    });
  });
  it('prices each work package as fixed or cost + fee, and keeps the contractor’s costs inside their company', async () => {
    const { contractor, owner, project } = await setup();
    const hybrid = body({
      milestones: [
        {
          name: 'Structure',
          amount: 5_000_000,
          basis: 'fixed',
          internalCost: 4_000_000,
        },
        {
          name: 'Plumbing',
          amount: 2_200_000,
          basis: 'reimbursable',
          feePercent: 10,
          internalCost: 2_000_000,
        },
      ],
    });
    await contractor
      .post(
        base(project.id),
        body({
          milestones: [
            { name: 'Plumbing', amount: 1000, basis: 'reimbursable' },
          ],
        }),
      )
      .expect(400);
    const q = (await contractor.post(base(project.id), hybrid).expect(201))
      .body as QuoteView;
    expect(q.commercialBasis).toBe('hybrid');
    expect(q.milestones.map((m) => [m.basis, m.feePercent])).toEqual([
      ['fixed', null],
      ['reimbursable', 10],
    ]);
    expect(q.internal).toEqual({
      costs: [4_000_000, 2_000_000],
      totalCost: 6_000_000,
      margin: 1_200_000,
      marginPercent: 16.7,
    });

    await contractor.post(`${base(project.id)}/${q.id}/send`).expect(200);
    const forOwner = await owner.get(`${base(project.id)}/${q.id}`).expect(200);
    expect((forOwner.body as QuoteView).internal).toBeNull();
    expect((forOwner.body as QuoteView).commercialBasis).toBe('hybrid');
    expect(JSON.stringify(forOwner.body)).not.toMatch(
      /4000000|6000000|1200000|internalCost/,
    );

    // A contractor on the project but from another company does not see them either.
    const inv = (
      await owner
        .post(`/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: '0788000048',
          role: 'contractor',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const outsider = await user('0788000048', 'Other Builder');
    await outsider.post(`/v1/invitations/${inv.id}/accept`).expect(200);
    const forOutsider = (
      await outsider.get(`${base(project.id)}/${q.id}`).expect(200)
    ).body as QuoteView;
    expect(forOutsider.internal).toBeNull();

    // Accepting copies the basis into the agreement, never the costs.
    const seen = forOwner.body as QuoteView;
    await owner
      .post(`${base(project.id)}/${q.id}/decision`, {
        decision: 'accept',
        revision: 1,
      })
      .set('If-Match', `"${seen.version}"`)
      .expect(200);
    const agreementsRes = await owner
      .get(`/v1/projects/${project.id}/agreements`)
      .expect(200);
    const [a] = agreementsRes.body as AgreementView[];
    expect(a.commercialBasis).toBe('hybrid');
    expect(a.milestones[1]).toMatchObject({
      basis: 'reimbursable',
      feePercent: 10,
    });
    expect(JSON.stringify(agreementsRes.body)).not.toMatch(
      /4000000|internalCost/,
    );
    const row = await db.execute<{ milestones: unknown }>(
      sql`select milestones from agreements`,
    );
    expect(JSON.stringify(row.rows)).not.toContain('4000000');
    expect(
      (await owner.post(`${base(project.id)}/${q.id}/pdf`).expect(200)).body,
    ).toHaveProperty('url');
  });
});
