import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { stageTemplates } from '@jengalink/contracts';
import type {
  CreatedInvitation,
  InvitationView,
  MemberView,
  LocationOptions,
  OrganizationView,
  ProjectStage,
  ProjectAcceptanceView,
  ProjectSummary,
  StagePlan,
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

const PHONES = {
  contractor: '0788000001',
  owner: '0788000002',
  stranger: '0788000003',
  supervisor: '0722000004',
};
const e164 = (local: string) => `+250${local.slice(1)}`;

describe('organizations, projects, memberships and invitations (e2e)', () => {
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
    await db.execute(sql`truncate invitations, project_memberships, organization_memberships, projects,
      organizations, sessions, otp_challenges, users, outbox_events, processed_events cascade`);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** Signs a user in by phone (or email) and returns an authed request helper. */
  async function user(
    contact: string,
    name: string,
    channel: 'sms' | 'email' = 'sms',
  ) {
    const destination = channel === 'sms' ? e164(contact) : contact;
    const started = (
      await http()
        .post('/v1/auth/otp/start')
        .send({ channel, destination: contact })
        .expect(202)
    ).body as StartOtpResponse;
    const v = (
      await http()
        .post('/v1/auth/otp/verify')
        .send({
          challengeId: started.challengeId,
          code: sender.lastCodeFor(destination),
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
      id: v.user.id,
      get: (url: string) => http().get(url).set(auth),
      post: (url: string, body?: object) =>
        http()
          .post(url)
          .set(auth)
          .set('Idempotency-Key', randomUUID())
          .send(body ?? {}),
      del: (url: string) => http().delete(url).set(auth),
      put: (url: string, body?: object) =>
        http()
          .put(url)
          .set(auth)
          .send(body ?? {}),
      /** Reads the project's ETag, then accepts it as owner with If-Match (Draft → Active). */
      activate: async (projectId: string, status: number) => {
        const res = await http().get(`/v1/projects/${projectId}`).set(auth);
        const etag = res.headers.etag as string | undefined;
        const r = http()
          .post(`/v1/projects/${projectId}/acceptance`)
          .set(auth)
          .send({ decision: 'accept' });
        return (etag ? r.set('If-Match', etag) : r).expect(status);
      },
    };
  }

  async function contractorWithProject() {
    const contractor = await user(PHONES.contractor, 'Eric Mugisha');
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
          contractValue: 45_000_000,
          stages: [
            { name: 'Foundation', weight: 60 },
            { name: 'Walls and roof', weight: 40 },
          ],
        })
        .expect(201)
    ).body as ProjectSummary;
    return { contractor, org, project };
  }

  async function inviteAndAccept(
    inviter: Awaited<ReturnType<typeof user>>,
    projectId: string,
    phone: string,
    name: string,
    role: string,
  ) {
    const inv = (
      await inviter
        .post(`/v1/projects/${projectId}/invitations`, {
          channel: 'sms',
          recipient: phone,
          role,
        })
        .expect(201)
    ).body as CreatedInvitation;
    const member = await user(phone, name);
    await member.post(`/v1/invitations/${inv.id}/accept`).expect(200);
    return member;
  }

  it('Gate 2: invite a second user; a third user cannot see the project through any endpoint', async () => {
    const { contractor, project } = await contractorWithProject();
    expect(project).toMatchObject({
      status: 'draft',
      myRoles: ['contractor'],
      hasOwner: false,
      organizationName: 'Ubaka Builders',
    });

    // Only the owner can start the project, by accepting it.
    await contractor.activate(project.id, 403);

    const inv = (
      await contractor
        .post(`/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: PHONES.owner,
          role: 'owner',
        })
        .expect(201)
    ).body as CreatedInvitation;
    expect(inv).toMatchObject({
      state: 'pending',
      role: 'owner',
      projectName: 'Kicukiro House',
      sentTo: '+250 78* *** 002',
    });
    expect(inv.link).toMatch(/\/invite\/[\w-]{20,}$/);

    const owner = await user(PHONES.owner, 'Aline Uwase');
    const mine = (await owner.get('/v1/invitations').expect(200))
      .body as InvitationView[];
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      projectName: 'Kicukiro House',
      invitedBy: 'Eric Mugisha',
    });
    await owner.post(`/v1/invitations/${inv.id}/accept`).expect(200);

    const asOwner = (await owner.get(`/v1/projects/${project.id}`).expect(200))
      .body as ProjectSummary;
    expect(asOwner.myRoles).toEqual(['owner']);
    await contractor.activate(project.id, 403);
    await owner.activate(project.id, 200);
    const active = (
      await contractor.get(`/v1/projects/${project.id}`).expect(200)
    ).body as ProjectSummary;
    expect(active.status).toBe('active');

    // The stranger knows the project id, and still sees nothing.
    const stranger = await user(PHONES.stranger, 'Stranger');
    expect((await stranger.get('/v1/projects').expect(200)).body).toEqual([]);
    await stranger.get(`/v1/projects/${project.id}`).expect(404);
    await stranger.get(`/v1/projects/${project.id}/members`).expect(404);
    await stranger.activate(project.id, 404);
    await stranger
      .post(`/v1/projects/${project.id}/invitations`, {
        channel: 'sms',
        recipient: PHONES.stranger,
        role: 'viewer',
      })
      .expect(404);
    const members = (
      await owner.get(`/v1/projects/${project.id}/members`).expect(200)
    ).body as MemberView[];
    await stranger
      .del(`/v1/projects/${project.id}/members/${members[0].membershipId}`)
      .expect(404);
    expect((await stranger.get('/v1/invitations').expect(200)).body).toEqual(
      [],
    );
  });

  it('binds an invitation to the phone it was sent to', async () => {
    const { contractor, project } = await contractorWithProject();
    const inv = (
      await contractor
        .post(`/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: PHONES.owner,
          role: 'owner',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const stranger = await user(PHONES.stranger, 'Stranger');
    const res = await stranger
      .post(`/v1/invitations/${inv.id}/accept`)
      .expect(403);
    expect((res.body as { message: string }).message).toContain(
      '+250 78* *** 002',
    );
    const token = inv.link.split('/').pop()!;
    await stranger.get(`/v1/invitations/token/${token}`).expect(403);

    const owner = await user(PHONES.owner, 'Aline Uwase');
    const viaLink = (
      await owner.get(`/v1/invitations/token/${token}`).expect(200)
    ).body as InvitationView;
    expect(viaLink.id).toBe(inv.id);
  });

  it('expires invitations after 7 days and allows each one only once', async () => {
    const { contractor, project } = await contractorWithProject();
    const first = (
      await contractor
        .post(`/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: PHONES.owner,
          role: 'owner',
        })
        .expect(201)
    ).body as CreatedInvitation;
    expect(new Date(first.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      6.9 * 86_400_000,
    );

    const owner = await user(PHONES.owner, 'Aline Uwase');
    await owner.post(`/v1/invitations/${first.id}/accept`).expect(200);
    await owner.post(`/v1/invitations/${first.id}/accept`).expect(409);

    const viewer = (
      await owner
        .post(`/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: PHONES.supervisor,
          role: 'viewer',
        })
        .expect(201)
    ).body as CreatedInvitation;
    await db.execute(
      sql`update invitations set expires_at = now() - interval '1 minute' where id = ${viewer.id}`,
    );
    const late = await user(PHONES.supervisor, 'Jean Habimana');
    await late.post(`/v1/invitations/${viewer.id}/accept`).expect(410);
    expect((await late.get('/v1/invitations').expect(200)).body).toEqual([]);
  });

  it('limits who may invite whom', async () => {
    const { contractor, project } = await contractorWithProject();
    await contractor
      .post(`/v1/projects/${project.id}/invitations`, {
        channel: 'sms',
        recipient: PHONES.stranger,
        role: 'finance',
      })
      .expect(403);
    await inviteAndAccept(
      contractor,
      project.id,
      PHONES.owner,
      'Aline Uwase',
      'owner',
    );
    // Once an owner exists, only the owner adds owners.
    await contractor
      .post(`/v1/projects/${project.id}/invitations`, {
        channel: 'sms',
        recipient: PHONES.stranger,
        role: 'owner',
      })
      .expect(403);
    await contractor
      .post(`/v1/projects/${project.id}/invitations`, {
        channel: 'sms',
        recipient: PHONES.supervisor,
        role: 'supervisor',
      })
      .expect(201);
    await contractor
      .post(`/v1/projects/${project.id}/invitations`, {
        channel: 'sms',
        recipient: '+32470123456',
        role: 'viewer',
      })
      .expect(400);
  });

  it('revokes access on the very next request, but never removes the last owner', async () => {
    const { contractor, project } = await contractorWithProject();
    const owner = await inviteAndAccept(
      contractor,
      project.id,
      PHONES.owner,
      'Aline Uwase',
      'owner',
    );
    const supervisor = await inviteAndAccept(
      owner,
      project.id,
      PHONES.supervisor,
      'Jean Habimana',
      'supervisor',
    );
    await supervisor.get(`/v1/projects/${project.id}`).expect(200);

    const members = (
      await owner.get(`/v1/projects/${project.id}/members`).expect(200)
    ).body as MemberView[];
    const sup = members.find((m) => m.role === 'supervisor')!;
    const own = members.find((m) => m.role === 'owner')!;
    expect(sup.contact).toBe('+250 72* *** 004');

    await contractor
      .del(`/v1/projects/${project.id}/members/${own.membershipId}`)
      .expect(403);
    await owner
      .del(`/v1/projects/${project.id}/members/${own.membershipId}`)
      .expect(409);

    await owner
      .del(`/v1/projects/${project.id}/members/${sup.membershipId}`)
      .expect(204);
    await supervisor.get(`/v1/projects/${project.id}`).expect(404);
    expect((await supervisor.get('/v1/projects').expect(200)).body).toEqual([]);
  });

  it('lets a household owner create and start a project without an invitation', async () => {
    const owner = await user(PHONES.owner, 'Aline Uwase');
    const org = (
      await owner
        .post('/v1/organizations', { name: 'Uwase family', kind: 'household' })
        .expect(201)
    ).body as OrganizationView;
    const project = (
      await owner
        .post('/v1/projects', {
          organizationId: org.id,
          name: 'Rubavu house',
          contractValue: 45_000_000,
          stages: [
            { name: 'Foundation', weight: 60 },
            { name: 'Walls and roof', weight: 40 },
          ],
        })
        .expect(201)
    ).body as ProjectSummary;
    expect(project).toMatchObject({ myRoles: ['owner'], hasOwner: true });
    await owner.activate(project.id, 200);
    // Not a member of that organization: cannot create projects in it.
    const stranger = await user(PHONES.stranger, 'Stranger');
    await stranger
      .post('/v1/projects', { organizationId: org.id, name: 'Sneaky' })
      .expect(404);
  });

  it('re-inviting replaces the earlier pending invitation, and the inviter can withdraw it', async () => {
    const { contractor, project } = await contractorWithProject();
    const a = (
      await contractor
        .post(`/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: PHONES.owner,
          role: 'owner',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const b = (
      await contractor
        .post(`/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: PHONES.owner,
          role: 'owner',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const owner = await user(PHONES.owner, 'Aline Uwase');
    await owner.post(`/v1/invitations/${a.id}/accept`).expect(409);
    await contractor.del(`/v1/invitations/${b.id}`).expect(204);
    await owner.post(`/v1/invitations/${b.id}/accept`).expect(409);
    expect((await owner.get('/v1/invitations').expect(200)).body).toEqual([]);
  });

  it('invites to an organization by email; only admins can invite', async () => {
    const { contractor, org } = await contractorWithProject();
    const inv = (
      await contractor
        .post(`/v1/organizations/${org.id}/invitations`, {
          channel: 'email',
          recipient: 'Office@Ubaka.rw',
          role: 'member',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const office = await user('office@ubaka.rw', 'Office', 'email');
    await office.post(`/v1/invitations/${inv.id}/accept`).expect(200);
    const orgs = (await office.get('/v1/organizations').expect(200))
      .body as OrganizationView[];
    expect(orgs).toEqual([
      {
        id: org.id,
        name: 'Ubaka Builders',
        kind: 'contractor',
        myRole: 'member',
      },
    ]);
    // Organization membership alone does not grant project access (spec §3.1).
    expect((await office.get('/v1/projects').expect(200)).body).toEqual([]);
    await office
      .post(`/v1/organizations/${org.id}/invitations`, {
        channel: 'email',
        recipient: 'x@y.rw',
        role: 'member',
      })
      .expect(403);
  });

  it('sends the invitation message from the outbox', async () => {
    const { contractor, project } = await contractorWithProject();
    await contractor
      .post(`/v1/projects/${project.id}/invitations`, {
        channel: 'sms',
        recipient: PHONES.owner,
        role: 'owner',
      })
      .expect(201);
    await jobs.start({ relayIntervalMs: 100, pollingIntervalSeconds: 0.5 });
    try {
      const deadline = Date.now() + 10_000;
      while (
        !sender.lastTo(e164(PHONES.owner))?.text.includes('invited') &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await jobs.stop();
    }
    const msg = sender.lastTo(e164(PHONES.owner))!;
    expect(msg.text).toContain('Eric Mugisha invited you to "Kicukiro House"');
    expect(msg.text).toContain('/invitations');
  });
  describe('project wizard (Phase 3)', () => {
    async function contractorOrg() {
      const contractor = await user(PHONES.contractor, 'Eric Mugisha');
      const org = (
        await contractor
          .post('/v1/organizations', {
            name: 'Ubaka Builders',
            kind: 'contractor',
          })
          .expect(201)
      ).body as OrganizationView;
      return { contractor, org };
    }
    const houseStages = stageTemplates.house.map((s) => ({
      name: `Stage ${s.key}`,
      weight: s.weight,
    }));

    it('creates a typed project with official location spelling, contract value and template stages', async () => {
      const { contractor, org } = await contractorOrg();
      const project = (
        await contractor
          .post('/v1/projects', {
            organizationId: org.id,
            name: 'Kicukiro House',
            type: 'house',
            location: {
              province: 'kigali city',
              district: 'KICUKIRO',
              sector: 'Niboye',
            },
            contractValue: 45_000_000,
            stages: houseStages,
          })
          .expect(201)
      ).body as ProjectSummary;
      expect(project).toMatchObject({
        type: 'house',
        contractValue: 45_000_000,
        stageCount: 8,
        currency: 'RWF',
        location: {
          province: 'Kigali City',
          district: 'Kicukiro',
          sector: 'Niboye',
        },
      });
      const stages = (
        await contractor.get(`/v1/projects/${project.id}/stages`).expect(200)
      ).body as ProjectStage[];
      expect(stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(stages.reduce((t, s) => t + s.weight, 0)).toBe(100);
      expect(stages[0]).toMatchObject({
        name: 'Stage sitePrep',
        status: 'not_started',
      });

      // Strangers cannot see the stages either.
      const stranger = await user(PHONES.stranger, 'Stranger');
      await stranger.get(`/v1/projects/${project.id}/stages`).expect(404);
    });

    it('rejects stage weights that do not total 100, and unknown or skipped location levels', async () => {
      const { contractor, org } = await contractorOrg();
      const base = { organizationId: org.id, name: 'Bad House', type: 'house' };
      const bad = await contractor
        .post('/v1/projects', {
          ...base,
          stages: [
            { name: 'Foundation', weight: 60 },
            { name: 'Roof', weight: 30 },
          ],
        })
        .expect(400);
      expect(JSON.stringify(bad.body)).toContain('total 100');
      const unknown = await contractor
        .post('/v1/projects', {
          ...base,
          location: { province: 'Kigali City', district: 'Atlantis' },
        })
        .expect(400);
      expect(unknown.body).toMatchObject({
        fieldErrors: [{ field: 'location.district' }],
      });
      await contractor
        .post('/v1/projects', {
          ...base,
          location: { province: 'Kigali City', sector: 'Niboye' },
        })
        .expect(400);
    });

    it('serves the location picker one level at a time', async () => {
      const { contractor } = await contractorOrg();
      const provinces = (await contractor.get('/v1/locations/rw').expect(200))
        .body as LocationOptions;
      expect(provinces.level).toBe('province');
      expect(provinces.options).toHaveLength(5);
      const sectors = (
        await contractor
          .get('/v1/locations/rw?province=Kigali%20City&district=Kicukiro')
          .expect(200)
      ).body as LocationOptions;
      expect(sectors.level).toBe('sector');
      expect(sectors.options).toHaveLength(10);
      expect(sectors.options).toContain('Niboye');
      await contractor.get('/v1/locations/rw?province=Nowhere').expect(400);
      await http().get('/v1/locations/rw').expect(401);
    });
  });
  describe('owner invitation (Phase 3)', () => {
    it('shows the invited owner what they will see before they accept', async () => {
      const contractor = await user(PHONES.contractor, 'Eric Mugisha');
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
            type: 'house',
            location: { province: 'Kigali City', district: 'Kicukiro' },
            contractValue: 45_000_000,
            stages: stageTemplates.house.map((s) => ({
              name: `Stage ${s.key}`,
              weight: s.weight,
            })),
          })
          .expect(201)
      ).body as ProjectSummary;
      const inv = (
        await contractor
          .post(`/v1/projects/${project.id}/invitations`, {
            channel: 'sms',
            recipient: PHONES.owner,
            role: 'owner',
          })
          .expect(201)
      ).body as CreatedInvitation;
      const preview = {
        organizationKind: 'contractor',
        role: 'owner',
        financialVisibility: true,
        project: {
          type: 'house',
          status: 'draft',
          currency: 'RWF',
          contractValue: 45_000_000,
          stageCount: 8,
          province: 'Kigali City',
          district: 'Kicukiro',
        },
      };
      expect(inv).toMatchObject(preview);

      // The contractor sees the pending invitation on the project.
      const sent = (
        await contractor
          .get(`/v1/projects/${project.id}/invitations`)
          .expect(200)
      ).body as InvitationView[];
      expect(sent).toEqual([
        expect.objectContaining({ id: inv.id, state: 'pending' }),
      ]);

      // The owner opens it from the list or the link and sees the same preview.
      const owner = await user(PHONES.owner, 'Aline Uwase');
      const one = (await owner.get(`/v1/invitations/${inv.id}`).expect(200))
        .body as InvitationView;
      expect(one).toMatchObject(preview);
      const token = inv.link.split('/').pop()!;
      expect(
        (await owner.get(`/v1/invitations/token/${token}`).expect(200)).body,
      ).toMatchObject(preview);

      // Nobody else can open it.
      const stranger = await user(PHONES.stranger, 'Stranger');
      const denied = await stranger
        .get(`/v1/invitations/${inv.id}`)
        .expect(403);
      expect(JSON.stringify(denied.body)).not.toContain('Kicukiro');

      await owner.post(`/v1/invitations/${inv.id}/accept`).expect(200);
      // The project changed (it has an owner now), so its revision and ETag change too.
      const fresh = await contractor
        .get(`/v1/projects/${project.id}`)
        .expect(200);
      expect(fresh.headers['cache-control']).toBe('no-store');
      expect(fresh.body).toMatchObject({
        hasOwner: true,
        revision: project.revision + 1,
      });
      const after = (
        await contractor
          .get(`/v1/projects/${project.id}/invitations`)
          .expect(200)
      ).body as InvitationView[];
      expect(after[0].state).toBe('accepted');
    });

    it('only members who may invite can list the invitations of a project', async () => {
      const { contractor, project } = await contractorWithProject();
      const owner = await inviteAndAccept(
        contractor,
        project.id,
        PHONES.owner,
        'Aline Uwase',
        'owner',
      );
      const viewer = await inviteAndAccept(
        owner,
        project.id,
        PHONES.supervisor,
        'Jean Viewer',
        'viewer',
      );
      await viewer.get(`/v1/projects/${project.id}/invitations`).expect(403);
      const all = (
        await owner.get(`/v1/projects/${project.id}/invitations`).expect(200)
      ).body as InvitationView[];
      expect(all.map((i) => i.role)).toEqual(['viewer', 'owner']);
    });
  });
  describe('stage plan (Phase 3)', () => {
    async function draftWithStages() {
      const contractor = await user(PHONES.contractor, 'Eric Mugisha');
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
            contractValue: 45_000_000,
            stages: [
              { name: 'Foundation', weight: 40 },
              { name: 'Walls', weight: 40 },
              { name: 'Roof', weight: 20 },
            ],
          })
          .expect(201)
      ).body as ProjectSummary;
      return { contractor, org, project };
    }
    const put = (
      who: Awaited<ReturnType<typeof user>>,
      projectId: string,
      body: object,
      ifMatch?: string,
    ) => {
      const r = who.put(`/v1/projects/${projectId}/plan`, body);
      return ifMatch ? r.set('If-Match', ifMatch) : r;
    };

    it('saves weights, planned dates and acceptance criteria as one versioned plan', async () => {
      const { contractor, project } = await draftWithStages();
      const read = await contractor
        .get(`/v1/projects/${project.id}/plan`)
        .expect(200);
      const plan = read.body as StagePlan;
      expect(read.headers.etag).toBe('"1"');
      expect(plan).toMatchObject({ canEdit: true, locked: false, revision: 1 });
      const [foundation, walls] = plan.stages;
      expect(foundation.criteria).toEqual([]);

      const body = {
        stages: [
          {
            id: foundation.id,
            name: 'Foundation and slab',
            weight: 35,
            description: 'Strip footings and ground slab',
            plannedStart: '2026-11-02',
            plannedEnd: '2026-11-27',
            criteria: [
              'Footings match the drawings',
              'Slab level checked at 5 points',
            ],
          },
          {
            id: walls.id,
            name: 'Walls',
            weight: 45,
            plannedStart: '2026-11-30',
          },
          {
            name: 'Roof and gutters',
            weight: 20,
            criteria: ['No leaks after rain'],
          },
        ],
      };
      await put(contractor, project.id, body).expect(428);
      await put(contractor, project.id, body, '"7"').expect(412);
      const saved = await put(
        contractor,
        project.id,
        body,
        read.headers.etag,
      ).expect(200);
      expect(saved.headers.etag).toBe('"2"');
      const after = saved.body as StagePlan;
      expect(after.stages.map((s) => [s.name, s.weight, s.position])).toEqual([
        ['Foundation and slab', 35, 1],
        ['Walls', 45, 2],
        ['Roof and gutters', 20, 3],
      ]);
      expect(after.stages[0]).toMatchObject({
        id: foundation.id,
        description: 'Strip footings and ground slab',
        plannedStart: '2026-11-02',
        plannedEnd: '2026-11-27',
        criteria: [
          'Footings match the drawings',
          'Slab level checked at 5 points',
        ],
      });
      // The old "Roof" stage was removed; the new one has a new id.
      expect(after.stages.map((s) => s.id)).not.toContain(plan.stages[2].id);
      // The same old version cannot be saved twice.
      await put(contractor, project.id, body, '"1"').expect(412);

      // The save is in the audit trail (owners read it once they join).
      const owner = await inviteAndAccept(
        contractor,
        project.id,
        PHONES.owner,
        'Aline Uwase',
        'owner',
      );
      const trail = (
        await owner.get(`/v1/projects/${project.id}/audit`).expect(200)
      ).body as { action: string; metadata: object }[];
      expect(
        trail.find((e) => e.action === 'stage_plan.saved')?.metadata,
      ).toMatchObject({
        stages: 3,
        added: 1,
        removed: 1,
        withDates: 1,
        withCriteria: 2,
      });
    });

    it('rejects weights that do not total 100, dates out of order and stages of another project', async () => {
      const { contractor, org, project } = await draftWithStages();
      const plan = (
        await contractor.get(`/v1/projects/${project.id}/plan`).expect(200)
      ).body as StagePlan;
      const total = await put(
        contractor,
        project.id,
        { stages: [{ name: 'Foundation', weight: 90 }] },
        '"1"',
      ).expect(400);
      expect(JSON.stringify(total.body)).toContain(
        'Stage weights must total 100',
      );
      const dates = await put(
        contractor,
        project.id,
        {
          stages: [
            {
              name: 'Foundation',
              weight: 100,
              plannedStart: '2026-12-01',
              plannedEnd: '2026-11-01',
            },
          ],
        },
        '"1"',
      ).expect(400);
      expect(
        (dates.body as { fieldErrors: { field: string }[] }).fieldErrors.map(
          (f) => f.field,
        ),
      ).toContain('stages.0.plannedEnd');

      const other = (
        await contractor
          .post('/v1/projects', {
            organizationId: org.id,
            name: 'Second house',
            location: { province: 'Kigali City', district: 'Gasabo' },
            stages: [{ name: 'Foundation', weight: 100 }],
          })
          .expect(201)
      ).body as ProjectSummary;
      const otherStages = (
        await contractor.get(`/v1/projects/${other.id}/stages`).expect(200)
      ).body as ProjectStage[];
      const foreign = await put(
        contractor,
        project.id,
        {
          stages: [{ id: otherStages[0].id, name: 'Foundation', weight: 100 }],
        },
        '"1"',
      ).expect(400);
      expect(
        (foreign.body as { fieldErrors: { field: string }[] }).fieldErrors[0]
          .field,
      ).toBe('stages.0.id');
      // Nothing changed: still the original three stages at revision 1.
      const again = (
        await contractor.get(`/v1/projects/${project.id}/plan`).expect(200)
      ).body as StagePlan;
      expect(again.revision).toBe(1);
      expect(again.stages.map((s) => s.id)).toEqual(
        plan.stages.map((s) => s.id),
      );
    });

    it('lets viewers read the plan only, and locks it once the project starts', async () => {
      const { contractor, project } = await draftWithStages();
      const owner = await inviteAndAccept(
        contractor,
        project.id,
        PHONES.owner,
        'Aline Uwase',
        'owner',
      );
      const viewer = await inviteAndAccept(
        owner,
        project.id,
        PHONES.supervisor,
        'Jean Viewer',
        'viewer',
      );
      const seen = (
        await viewer.get(`/v1/projects/${project.id}/plan`).expect(200)
      ).body as StagePlan;
      expect(seen.canEdit).toBe(false);
      await put(
        viewer,
        project.id,
        { stages: [{ name: 'Everything', weight: 100 }] },
        `"${seen.revision}"`,
      ).expect(403);

      // The owner can adjust the plan too while it is a draft.
      const ownerPlan = (
        await owner.get(`/v1/projects/${project.id}/plan`).expect(200)
      ).body as StagePlan;
      expect(ownerPlan.canEdit).toBe(true);

      await owner.activate(project.id, 200);
      const locked = (
        await contractor.get(`/v1/projects/${project.id}/plan`).expect(200)
      ).body as StagePlan;
      expect(locked.locked).toBe(true);
      const res = await put(
        contractor,
        project.id,
        {
          stages: locked.stages.map((s) => ({
            id: s.id,
            name: s.name,
            weight: s.weight,
          })),
        },
        `"${locked.revision}"`,
      ).expect(409);
      expect((res.body as { message: string }).message).toContain('locked');
    });
  });
  describe('owner accepts the project (Phase 3)', () => {
    const decide = (
      who: Awaited<ReturnType<typeof user>>,
      projectId: string,
      body: object,
      ifMatch?: string,
    ) => {
      const r = who.post(`/v1/projects/${projectId}/acceptance`, body);
      return ifMatch ? r.set('If-Match', ifMatch) : r;
    };

    it('lets the owner ask for changes, then accept the exact revision they reviewed', async () => {
      const { contractor, project } = await contractorWithProject();
      const owner = await inviteAndAccept(
        contractor,
        project.id,
        PHONES.owner,
        'Aline Uwase',
        'owner',
      );

      const review = await owner
        .get(`/v1/projects/${project.id}/acceptance`)
        .expect(200);
      const view = review.body as ProjectAcceptanceView;
      expect(review.headers.etag).toBe('"2"');
      expect(view).toMatchObject({
        projectName: 'Kicukiro House',
        organizationName: 'Ubaka Builders',
        status: 'draft',
        contractValue: 45_000_000,
        canDecide: true,
        ready: true,
        readiness: { stages: true, contractValue: true },
        history: [],
      });
      expect(view.stages.map((s) => s.name)).toEqual([
        'Foundation',
        'Walls and roof',
      ]);

      // The contractor sees the same review but cannot decide.
      const asContractor = (
        await contractor
          .get(`/v1/projects/${project.id}/acceptance`)
          .expect(200)
      ).body as ProjectAcceptanceView;
      expect(asContractor.canDecide).toBe(false);
      await decide(
        contractor,
        project.id,
        { decision: 'accept' },
        '"2"',
      ).expect(403);

      // Asking for changes needs a note, and keeps the project a draft.
      const noNote = await decide(
        owner,
        project.id,
        { decision: 'request_changes' },
        '"2"',
      ).expect(400);
      expect(
        (noNote.body as { fieldErrors: { field: string }[] }).fieldErrors[0]
          .field,
      ).toBe('note');
      const asked = (
        await decide(
          owner,
          project.id,
          {
            decision: 'request_changes',
            note: 'Walls and roof share looks too low',
          },
          '"2"',
        ).expect(200)
      ).body as ProjectAcceptanceView;
      expect(asked).toMatchObject({ status: 'draft', revision: 2 });
      expect(asked.history[0]).toMatchObject({
        decision: 'changes_requested',
        note: 'Walls and roof share looks too low',
        decidedByName: 'Aline Uwase',
        projectRevision: 2,
      });

      // The contractor sees the note on the plan and changes value and shares.
      const plan = (
        await contractor.get(`/v1/projects/${project.id}/plan`).expect(200)
      ).body as StagePlan;
      expect(plan.latestDecision).toMatchObject({
        decision: 'changes_requested',
        note: 'Walls and roof share looks too low',
      });
      const edited = await contractor
        .put(`/v1/projects/${project.id}/plan`, {
          contractValue: 48_000_000,
          stages: plan.stages.map((s, i) => ({
            id: s.id,
            name: s.name,
            weight: i === 0 ? 50 : 50,
          })),
        })
        .set('If-Match', '"2"')
        .expect(200);
      expect(edited.headers.etag).toBe('"3"');

      // Accepting the version reviewed before the edit is refused.
      await decide(owner, project.id, { decision: 'accept' }, '"2"').expect(
        412,
      );
      const accepted = await decide(
        owner,
        project.id,
        { decision: 'accept' },
        '"3"',
      ).expect(200);
      expect(accepted.headers.etag).toBe('"4"');
      expect(accepted.body as ProjectAcceptanceView).toMatchObject({
        status: 'active',
        canDecide: false,
        history: [
          {
            decision: 'accepted',
            contractValue: 48_000_000,
            stageCount: 2,
            projectRevision: 3,
          },
          { decision: 'changes_requested' },
        ],
      });

      // The accepted plan is now the locked baseline.
      await contractor
        .put(`/v1/projects/${project.id}/plan`, {
          stages: [{ name: 'Everything', weight: 100 }],
        })
        .set('If-Match', '"4"')
        .expect(409);
      await decide(owner, project.id, { decision: 'accept' }, '"4"').expect(
        409,
      );

      // The decision keeps a copy of exactly what was accepted, and cannot be edited.
      const rows = await db.execute<{
        stages: { name: string; weight: number }[];
      }>(
        sql`select stages from project_acceptances where decision = 'accepted'`,
      );
      expect(rows.rows[0].stages.map((s) => [s.name, s.weight])).toEqual([
        ['Foundation', 50],
        ['Walls and roof', 50],
      ]);
      await expect(
        db.execute(sql`update project_acceptances set note = 'edited'`),
      ).rejects.toThrow();

      const trail = (
        await owner.get(`/v1/projects/${project.id}/audit`).expect(200)
      ).body as { action: string }[];
      expect(trail.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'project.changes_requested',
          'project.accepted',
        ]),
      );
    });

    it('cannot be accepted until it has stages and an agreed contract value', async () => {
      const contractor = await user(PHONES.contractor, 'Eric Mugisha');
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
            name: 'No value yet',
            stages: [{ name: 'Foundation', weight: 100 }],
          })
          .expect(201)
      ).body as ProjectSummary;
      const owner = await inviteAndAccept(
        contractor,
        project.id,
        PHONES.owner,
        'Aline Uwase',
        'owner',
      );
      const view = (
        await owner.get(`/v1/projects/${project.id}/acceptance`).expect(200)
      ).body as ProjectAcceptanceView;
      expect(view).toMatchObject({
        ready: false,
        readiness: { stages: true, contractValue: false },
      });
      const refused = await decide(
        owner,
        project.id,
        { decision: 'accept' },
        `"${view.revision}"`,
      ).expect(409);
      expect(
        (refused.body as { fieldErrors: { field: string }[] }).fieldErrors.map(
          (f) => f.field,
        ),
      ).toEqual(['contractValue']);

      const plan = (
        await contractor.get(`/v1/projects/${project.id}/plan`).expect(200)
      ).body as StagePlan;
      await contractor
        .put(`/v1/projects/${project.id}/plan`, {
          contractValue: 30_000_000,
          stages: plan.stages.map((s) => ({
            id: s.id,
            name: s.name,
            weight: s.weight,
          })),
        })
        .set('If-Match', `"${plan.revision}"`)
        .expect(200);
      await decide(
        owner,
        project.id,
        { decision: 'accept' },
        `"${plan.revision + 1}"`,
      ).expect(200);
    });
  });
});
