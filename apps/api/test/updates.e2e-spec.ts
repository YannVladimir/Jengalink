import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type {
  CreatedInvitation,
  CreatedReportShare,
  OrganizationView,
  ProjectStage,
  ReportShareView,
  SharedReportView,
  ProjectSummary,
  ProjectOverview,
  ProjectProgress,
  SiteUpdate,
  StageTimeline,
  StartOtpResponse,
  UploadGrantView,
  VerifyOtpResponse,
  WeeklyReportSummary,
  WeeklyReportView,
} from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { Database } from '../src/db/client';
import { DB } from '../src/db/database.module';
import { ConsoleMessageSender } from '../src/messaging/message-sender';
import { configureApp } from '../src/app.setup';

import sharp from 'sharp';
import { JobsService } from '../src/jobs/jobs.service';
import { StorageService } from '../src/storage/storage.service';

/** A real 1600×1200 site "photo"; `taken` adds an EXIF capture time (camera local clock). */
const photo = (taken?: string) =>
  sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#c08a5a' },
  })
    .jpeg({ quality: 80 })
    .withExif({
      IFD0: { Make: 'TestCam' },
      ...(taken ? { IFD2: { DateTimeOriginal: taken } } : {}),
    })
    .toBuffer();
// The standard harmless antivirus test file, assembled at run time.
const EICAR = Buffer.from(
  'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
  'base64',
);
let JPEG: Buffer;

// Spec §14.1: site updates with stage, note, blockers and photos in private storage.
describe('site updates (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;
  let jobs: JobsService;
  let storage: StorageService;

  beforeAll(async () => {
    JPEG = await photo();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleRef.get(DB);
    sender = moduleRef.get(ConsoleMessageSender);
    jobs = moduleRef.get(JobsService);
    storage = moduleRef.get(StorageService);
  });

  /** Runs the background jobs until no photo is waiting for the pipeline. */
  async function processPhotos() {
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
    };
  }
  type User = Awaited<ReturnType<typeof user>>;

  async function inviteAndAccept(
    inviter: User,
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

  /** Contractor, owner and supervisor on an active project. */
  async function activeProject() {
    const contractor = await user('0788000031', 'Eric Mugisha');
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
          contractValue: 45_000_000,
          stages: [
            { name: 'Foundation', weight: 60 },
            { name: 'Walls', weight: 40 },
          ],
        })
        .expect(201)
    ).body as ProjectSummary;
    const owner = await inviteAndAccept(
      contractor,
      project.id,
      '0788000032',
      'Aline Uwase',
      'owner',
    );
    const supervisor = await inviteAndAccept(
      contractor,
      project.id,
      '0722000033',
      'Jean Habimana',
      'supervisor',
    );
    const etag = (await owner.get(`/v1/projects/${project.id}`).expect(200))
      .headers.etag;
    await owner
      .post(`/v1/projects/${project.id}/acceptance`, { decision: 'accept' })
      .set('If-Match', etag)
      .expect(200);
    const stages = (
      await contractor.get(`/v1/projects/${project.id}/stages`).expect(200)
    ).body as ProjectStage[];
    return { contractor, owner, supervisor, org, project, stages };
  }

  async function uploadPhoto(
    who: User,
    projectId: string,
    body: Buffer = JPEG,
  ) {
    const grant = (
      await who
        .post(`/v1/projects/${projectId}/uploads`, {
          contentType: 'image/jpeg',
          sizeBytes: body.length,
        })
        .expect(201)
    ).body as UploadGrantView;
    const put = await fetch(grant.url, {
      method: 'PUT',
      headers: grant.headers,
      body,
    });
    expect(put.status).toBe(200);
    return grant.key;
  }

  it('posts an update with photos, keeps originals private and replays a retried send', async () => {
    const { supervisor, owner, project, stages } = await activeProject();
    const k1 = await uploadPhoto(supervisor, project.id);
    const k2 = await uploadPhoto(supervisor, project.id);
    expect(k1.startsWith(`tmp/${project.id}/`)).toBe(true);

    const key = randomUUID();
    const body = {
      stageId: stages[0].id,
      eventDate: '2026-11-03',
      note: 'Footings poured on the east side',
      blockers: 'Rain stopped work after 3 pm',
      photos: [
        { uploadKey: k1, capturedAt: '2026-11-03T09:15:00+02:00' },
        { uploadKey: k2 },
      ],
    };
    const created = await supervisor
      .post(`/v1/projects/${project.id}/updates`, body, key)
      .expect(201);
    const update = created.body as SiteUpdate;
    expect(update).toMatchObject({
      stageName: 'Foundation',
      authorName: 'Jean Habimana',
      eventDate: '2026-11-03',
      note: 'Footings poured on the east side',
      blockers: 'Rain stopped work after 3 pm',
      revision: 1,
    });
    expect(update.photos).toHaveLength(2);
    // Nobody gets a link before the virus scan.
    expect(update.photos.map((p) => [p.status, p.url, p.thumbUrl])).toEqual([
      ['processing', null, null],
      ['processing', null, null],
    ]);
    expect(update.photos[0]).toMatchObject({
      capturedAt: '2026-11-03T07:15:00.000Z',
      capturedAtSource: 'device',
    });
    expect(update.photos[1].capturedAt).toBeNull();

    await processPhotos();
    const [ready] = (
      await owner.get(`/v1/projects/${project.id}/updates`).expect(200)
    ).body as SiteUpdate[];
    expect(ready.photos.map((p) => p.status)).toEqual(['ready', 'ready']);
    expect(ready.photos[0]).toMatchObject({ width: 1600, height: 1200 });

    // The original is readable through its short-lived signed link only.
    const original = await fetch(ready.photos[0].url!);
    expect(original.status).toBe(200);
    expect(Buffer.from(await original.arrayBuffer()).equals(JPEG)).toBe(true);
    expect((await fetch(ready.photos[0].url!.split('?')[0])).status).toBe(403);
    // The thumbnail is small, a JPEG, and carries no metadata (EXIF, GPS).
    const thumb = Buffer.from(
      await (await fetch(ready.photos[0].thumbUrl!)).arrayBuffer(),
    );
    const meta = await sharp(thumb).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual([
      'jpeg',
      480,
      360,
      undefined,
    ]);
    expect(thumb.length).toBeLessThan(JPEG.length);

    // A retry with the same key returns the same update, not a second one.
    const again = await supervisor
      .post(`/v1/projects/${project.id}/updates`, body, key)
      .expect(201);
    expect((again.body as SiteUpdate).id).toBe(update.id);
    expect(again.headers['idempotent-replayed']).toBe('true');

    // The owner reads it; the temporary upload cannot be reused.
    const list = (
      await owner.get(`/v1/projects/${project.id}/updates`).expect(200)
    ).body as SiteUpdate[];
    expect(list.map((u) => u.id)).toEqual([update.id]);
    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[0].id,
        photos: [{ uploadKey: k1 }],
      })
      .expect(400);

    const events = await db.execute<{ type: string }>(
      sql`select type from outbox_events where type = 'site_update.submitted'`,
    );
    expect(events.rows).toHaveLength(1);
  }, 60_000);

  it('checks who reports, which stage, which upload and that the project has started', async () => {
    const { contractor, owner, project, stages } = await activeProject();
    // Owners read updates; they do not post them.
    await owner
      .post(`/v1/projects/${project.id}/uploads`, { contentType: 'image/jpeg' })
      .expect(403);
    await owner
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[0].id,
        note: 'Looks good',
      })
      .expect(403);

    // A photo or a note is needed; files must be photos.
    const empty = await contractor
      .post(`/v1/projects/${project.id}/updates`, { stageId: stages[0].id })
      .expect(400);
    expect(JSON.stringify(empty.body)).toContain('Add a photo or a short note');
    await contractor
      .post(`/v1/projects/${project.id}/uploads`, {
        contentType: 'application/pdf',
      })
      .expect(400);

    // A note alone is fine (quick text update).
    await contractor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[1].id,
        note: 'Bricks delivered',
      })
      .expect(201);

    // Another project's stage or upload is refused.
    const other = (
      await contractor
        .post('/v1/projects', {
          organizationId: project.organizationId,
          name: 'Second house',
          contractValue: 1_000_000,
          stages: [{ name: 'Foundation', weight: 100 }],
        })
        .expect(201)
    ).body as ProjectSummary;
    const otherStages = (
      await contractor.get(`/v1/projects/${other.id}/stages`).expect(200)
    ).body as ProjectStage[];
    const wrongStage = await contractor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: otherStages[0].id,
        note: 'Wrong stage',
      })
      .expect(400);
    expect(JSON.stringify(wrongStage.body)).toContain('stageId');
    // The second project is still a draft: no site updates before the owner accepts.
    await contractor
      .post(`/v1/projects/${other.id}/updates`, {
        stageId: otherStages[0].id,
        note: 'Too early',
      })
      .expect(409);
    const draftKey = await uploadPhoto(contractor, other.id);
    const foreign = await contractor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[0].id,
        photos: [{ uploadKey: draftKey }],
      })
      .expect(400);
    expect(JSON.stringify(foreign.body)).toContain('photos.0.uploadKey');

    // Strangers learn nothing.
    const stranger = await user('0788000039', 'Stranger');
    await stranger
      .post(`/v1/projects/${project.id}/uploads`, { contentType: 'image/jpeg' })
      .expect(404);
    await stranger.get(`/v1/projects/${project.id}/updates`).expect(404);
  });

  it('scans every photo: reads EXIF capture time, blocks a virus, refuses a file that is not a photo', async () => {
    const { supervisor, owner, project, stages } = await activeProject();
    const withExif = await uploadPhoto(
      supervisor,
      project.id,
      await photo('2026:09:02 14:05:09'),
    );
    const virus = await uploadPhoto(supervisor, project.id, EICAR);
    const broken = await uploadPhoto(
      supervisor,
      project.id,
      Buffer.from('not really a photo'),
    );
    const update = (
      await supervisor
        .post(`/v1/projects/${project.id}/updates`, {
          stageId: stages[0].id,
          note: 'Three photos',
          photos: [
            { uploadKey: withExif },
            { uploadKey: virus },
            { uploadKey: broken },
          ],
        })
        .expect(201)
    ).body as SiteUpdate;
    await processPhotos();

    const [after] = (
      await owner.get(`/v1/projects/${project.id}/updates`).expect(200)
    ).body as SiteUpdate[];
    const [good, blocked, bad] = after.photos;
    // No time from the phone, so the camera's EXIF time is used (project time zone, Kigali +02:00).
    expect(good).toMatchObject({
      status: 'ready',
      capturedAt: '2026-09-02T12:05:09.000Z',
      capturedAtSource: 'exif',
    });
    expect(good.uploadedAt > good.capturedAt!).toBe(true);
    expect(blocked).toMatchObject({
      status: 'blocked',
      url: null,
      thumbUrl: null,
    });
    expect(bad).toMatchObject({ status: 'failed', url: null, thumbUrl: null });

    // The infected original is gone from storage, and the block is in the audit trail.
    const rows = await db.execute<{
      storage_key: string;
      processing_error: string;
    }>(
      sql`select storage_key, processing_error from media where site_update_id = ${update.id} order by position`,
    );
    expect(await storage.exists(rows.rows[1].storage_key)).toBe(false);
    expect(rows.rows[1].processing_error).toContain('virus scan');
    const trail = (
      await owner.get(`/v1/projects/${project.id}/audit`).expect(200)
    ).body as { action: string }[];
    expect(trail.map((e) => e.action)).toContain('media.quarantined');
  }, 60_000);
  it('serves the feed by stage and page, and a stage timeline with before and after photos', async () => {
    const { supervisor, owner, project, stages } = await activeProject();
    const post = async (stageId: string, note: string, taken: string[]) => {
      const keys = [];
      for (const t of taken)
        keys.push(await uploadPhoto(supervisor, project.id, await photo(t)));
      return (
        await supervisor
          .post(`/v1/projects/${project.id}/updates`, {
            stageId,
            note,
            photos: keys.map((k) => ({ uploadKey: k })),
          })
          .expect(201)
      ).body as SiteUpdate;
    };
    const first = await post(stages[0].id, 'Trenches dug', [
      '2026:09:01 08:00:00',
    ]);
    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[1].id,
        note: 'Bricks delivered',
      })
      .expect(201);
    const last = await post(stages[0].id, 'Footings poured', [
      '2026:09:20 16:30:00',
      '2026:09:10 10:00:00',
    ]);
    await processPhotos();

    // Filter by stage.
    const foundation = (
      await owner
        .get(`/v1/projects/${project.id}/updates?stageId=${stages[0].id}`)
        .expect(200)
    ).body as SiteUpdate[];
    expect(foundation.map((u) => u.note)).toEqual([
      'Footings poured',
      'Trenches dug',
    ]);

    // Page through, newest first.
    const page1 = (
      await owner.get(`/v1/projects/${project.id}/updates?limit=2`).expect(200)
    ).body as SiteUpdate[];
    expect(page1.map((u) => u.note)).toEqual([
      'Footings poured',
      'Bricks delivered',
    ]);
    const page2 = (
      await owner
        .get(
          `/v1/projects/${project.id}/updates?limit=2&before=${encodeURIComponent(page1[1].submittedAt)}`,
        )
        .expect(200)
    ).body as SiteUpdate[];
    expect(page2.map((u) => u.id)).toEqual([first.id]);
    await owner.get(`/v1/projects/${project.id}/updates?limit=999`).expect(400);

    // Timeline: before = earliest photo by capture time, after = latest.
    const tl = (
      await owner
        .get(`/v1/projects/${project.id}/stages/${stages[0].id}/timeline`)
        .expect(200)
    ).body as StageTimeline;
    expect(tl.stage.name).toBe('Foundation');
    expect(tl.photoCount).toBe(3);
    expect(tl.before?.capturedAt).toBe('2026-09-01T06:00:00.000Z');
    expect(tl.after?.capturedAt).toBe('2026-09-20T14:30:00.000Z');
    expect(tl.updates.map((u) => u.id)).toEqual([last.id, first.id]);

    // One photo is not enough for before/after; another project's stage is not found.
    const walls = (
      await owner
        .get(`/v1/projects/${project.id}/stages/${stages[1].id}/timeline`)
        .expect(200)
    ).body as StageTimeline;
    expect([walls.before, walls.after, walls.photoCount]).toEqual([
      null,
      null,
      0,
    ]);
    await owner
      .get(
        `/v1/projects/${project.id}/stages/01900000-0000-7000-8000-000000000099/timeline`,
      )
      .expect(404);
  }, 60_000);
  it('reports progress from real stages: accepted weight, reported weight, and blocked or active stages', async () => {
    const { supervisor, owner, project, stages } = await activeProject();
    const read = async () =>
      (await owner.get(`/v1/projects/${project.id}/progress`).expect(200))
        .body as ProjectProgress;

    const empty = await read();
    expect(empty).toMatchObject({
      acceptedPercent: 0,
      reportedPercent: 0,
      lastUpdateAt: null,
    });
    expect(empty.stages.map((s) => s.displayStatus)).toEqual([
      'planned',
      'planned',
    ]);

    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[0].id,
        note: 'Digging',
        blockers: 'Rain',
      })
      .expect(201);
    const blocked = await read();
    expect(blocked.stages[0]).toMatchObject({
      displayStatus: 'blocked',
      blocker: 'Rain',
      updateCount: 1,
    });
    expect(blocked.lastUpdateAt).not.toBeNull();

    // A newer update without a blocker clears it.
    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[0].id,
        note: 'Dry again',
      })
      .expect(201);
    expect((await read()).stages[0]).toMatchObject({
      displayStatus: 'in_progress',
      blocker: null,
      updateCount: 2,
    });

    // Stage review comes in a later item; set the statuses directly to check the sums.
    await db.execute(
      sql`update stages set status = 'ready_for_review' where id = ${stages[0].id}`,
    );
    await db.execute(
      sql`update stages set status = 'accepted' where id = ${stages[1].id}`,
    );
    const done = await read();
    expect([done.acceptedPercent, done.reportedPercent]).toEqual([40, 60]);
    expect(done.stages.map((s) => s.displayStatus)).toEqual([
      'ready_for_review',
      'accepted',
    ]);
  });
  it('runs stage review: submit, ask for changes, resubmit, accept the exact revision; next actions follow', async () => {
    const { contractor, supervisor, owner, project, stages } =
      await activeProject();
    const tl = (who: User = owner) =>
      who
        .get(`/v1/projects/${project.id}/stages/${stages[0].id}/timeline`)
        .expect(200)
        .then((r) => r.body as StageTimeline);
    const submit = (who: User, stageId = stages[0].id) =>
      who.post(`/v1/projects/${project.id}/stages/${stageId}/submit`, {
        note: 'Footings done',
      });
    const review = (body: object, ifMatch?: string) => {
      const r = owner.post(
        `/v1/projects/${project.id}/stages/${stages[0].id}/review`,
        body,
      );
      return ifMatch ? r.set('If-Match', ifMatch) : r;
    };
    const next = async (who: User) =>
      (
        (await who.get('/v1/overview').expect(200)).body as ProjectOverview[]
      ).find((p) => p.id === project.id)!.nextAction;

    // Evidence first: a stage with no update cannot be submitted.
    await submit(contractor, stages[1].id).expect(409);
    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[0].id,
        note: 'Footings poured',
      })
      .expect(201);
    expect((await tl(contractor)).canSubmit).toBe(true);
    await submit(supervisor).expect(403);
    await submit(owner).expect(403);

    const submitted = (await submit(contractor).expect(200))
      .body as StageTimeline;
    expect(submitted.stage).toMatchObject({
      status: 'ready_for_review',
      revision: 2,
    });
    expect(submitted.canReview).toBe(false);
    await submit(contractor).expect(409);
    const forOwner = await tl();
    expect(forOwner.canReview).toBe(true);
    expect(forOwner.reviews[0]).toMatchObject({
      kind: 'submitted',
      note: 'Footings done',
      actorName: 'Eric Mugisha',
    });
    expect(await next(owner)).toMatchObject({
      kind: 'review_stage',
      stageName: 'Foundation',
    });
    expect(
      (await owner.get(`/v1/projects/${project.id}/progress`).expect(200)).body,
    ).toMatchObject({ acceptedPercent: 0, reportedPercent: 60 });

    // The owner decides on the exact revision.
    await review({ decision: 'accept' }).expect(428);
    await review({ decision: 'accept' }, '"1"').expect(412);
    await review({ decision: 'request_changes' }, '"2"').expect(400);
    const changed = (
      await review(
        { decision: 'request_changes', note: 'Show the level check photos' },
        '"2"',
      ).expect(200)
    ).body as StageTimeline;
    expect(changed.stage).toMatchObject({
      status: 'changes_required',
      revision: 3,
    });
    const prog = (
      await contractor.get(`/v1/projects/${project.id}/progress`).expect(200)
    ).body as ProjectProgress;
    expect(prog.stages[0]).toMatchObject({
      displayStatus: 'changes_required',
      changesNote: 'Show the level check photos',
    });
    expect(await next(contractor)).toMatchObject({
      kind: 'fix_changes',
      stageName: 'Foundation',
    });

    // Resubmit, then accept.
    await submit(contractor).expect(200);
    await review({ decision: 'accept' }, '"3"').expect(412);
    const done = (await review({ decision: 'accept' }, '"4"').expect(200))
      .body as StageTimeline;
    expect(done.stage.status).toBe('accepted');
    expect(done.reviews.map((r) => r.kind)).toEqual([
      'accepted',
      'submitted',
      'changes_requested',
      'submitted',
    ]);
    expect(
      (await owner.get(`/v1/projects/${project.id}/progress`).expect(200)).body,
    ).toMatchObject({ acceptedPercent: 60, reportedPercent: 0 });
    await submit(contractor).expect(409);
    await review({ decision: 'accept' }, '"5"').expect(409);

    const trail = (
      await owner.get(`/v1/projects/${project.id}/audit`).expect(200)
    ).body as { action: string }[];
    expect(trail.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'stage.submitted',
        'stage.changes_requested',
        'stage.accepted',
      ]),
    );
    await expect(
      db.execute(sql`update stage_reviews set note = 'x'`),
    ).rejects.toThrow();
  });

  it('lists every project with progress, blockers and the next action for each role', async () => {
    const { contractor, supervisor, owner, project, stages } =
      await activeProject();
    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[1].id,
        note: 'Bricks short',
        blockers: 'Waiting for bricks',
      })
      .expect(201);
    // A second, draft project without an owner.
    const draft = (
      await contractor
        .post('/v1/projects', {
          organizationId: project.organizationId,
          name: 'Draft house',
          contractValue: 1_000_000,
          stages: [{ name: 'All', weight: 100 }],
        })
        .expect(201)
    ).body as ProjectSummary;
    const list = (await contractor.get('/v1/overview').expect(200))
      .body as ProjectOverview[];
    const active = list.find((p) => p.id === project.id)!;
    expect(active).toMatchObject({
      status: 'active',
      hasOwner: true,
      blockers: [{ stageName: 'Walls', text: 'Waiting for bricks' }],
      nextAction: { kind: 'clear_blocker', stageName: 'Walls' },
    });
    expect(list.find((p) => p.id === draft.id)).toMatchObject({
      hasOwner: false,
      nextAction: { kind: 'invite_owner' },
    });
    // The owner only sees their own project.
    const mine = (await owner.get('/v1/overview').expect(200))
      .body as ProjectOverview[];
    expect(mine.map((p) => p.id)).toEqual([project.id]);
    expect(mine[0].nextAction.kind).toBe('none');
  });

  // Spec §14, §15 (A0): the one-tap weekly report freezes the week from records.
  it('the weekly report: a frozen snapshot of the week, money only for money readers, acknowledged by the owner, one-page PDF', async () => {
    const { contractor, owner, supervisor, project, stages } =
      await activeProject();
    const kigaliToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
    }).format(new Date());
    const base = `/v1/projects/${project.id}/reports`;

    // Last week's report first (nothing yet), so this week can show the change.
    const lastWeek = new Date(Date.now() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const previous = (
      await supervisor.post(base, { weekOf: lastWeek }).expect(201)
    ).body as WeeklyReportView;
    expect(previous.data.progress).toMatchObject({
      accepted: 0,
      acceptedChange: null,
    });

    // This week: two updates with photos, one with a blocker; the first stage is sent for review.
    for (const [note, blockers] of [
      ['Footings poured', null],
      ['Waiting for steel', 'Steel delivery late'],
    ] as const) {
      const key = await uploadPhoto(supervisor, project.id);
      await supervisor
        .post(`/v1/projects/${project.id}/updates`, {
          stageId: stages[0].id,
          eventDate: kigaliToday,
          note,
          ...(blockers ? { blockers } : {}),
          photos: [{ uploadKey: key }],
        })
        .expect(201);
    }
    await processPhotos();
    const timeline = (
      await contractor
        .get(`/v1/projects/${project.id}/stages/${stages[0].id}/timeline`)
        .expect(200)
    ).body as { revision: number };
    await contractor
      .post(`/v1/projects/${project.id}/stages/${stages[0].id}/submit`, {})
      .set('If-Match', `"${timeline.revision}"`)
      .expect(200);
    await owner.post(base, {}).expect(403); // the owner reads reports; site reporters write them

    const report = (await supervisor.post(base, {}).expect(201))
      .body as WeeklyReportView;
    expect(report).toMatchObject({
      revisionNo: 1,
      generatedByName: 'Jean Habimana',
      acknowledgedAt: null,
      canAcknowledge: false,
    });
    expect(report.data).toMatchObject({
      projectName: 'Kicukiro House',
      organizationName: 'Ubaka Builders',
      progress: { accepted: 0, reported: 60, acceptedChange: 0 },
      work: {
        updates: 2,
        photos: 2,
        authors: ['Jean Habimana'],
        stagesWorked: ['Foundation'],
        blockers: [{ stage: 'Foundation', text: 'Steel delivery late' }],
      },
    });
    expect(report.data.stages.map((x) => [x.name, x.status])).toEqual([
      ['Foundation', 'ready_for_review'],
      ['Walls', 'planned'],
    ]);
    expect(report.data.decisions.map((x) => [x.kind, x.title])).toEqual([
      ['stage_review', 'Foundation'],
    ]);
    expect(report.data.next.map((x) => x.stage)).toEqual(['Walls']); // only stages not started yet
    expect(report.data.photoIds).toHaveLength(2);
    expect(report.photos.every((ph) => ph.thumbUrl && ph.url)).toBe(true);
    // Money is in the snapshot, but a site supervisor without money access does not see it.
    expect(report.data.money).toBeNull();
    const ownerView = (await owner.get(`${base}/${report.id}`).expect(200))
      .body as WeeklyReportView;
    expect(ownerView.data.money).toMatchObject({
      contract: 45_000_000,
      paid: 0,
    });
    expect(ownerView.canAcknowledge).toBe(true);

    // Frozen: later records do not change it; generating again makes revision 2 of the same week.
    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[1].id,
        eventDate: kigaliToday,
        note: 'Walls started',
        photos: [],
      })
      .expect(201);
    expect(
      (
        (await owner.get(`${base}/${report.id}`).expect(200))
          .body as WeeklyReportView
      ).data.work.updates,
    ).toBe(2);
    const second = (await contractor.post(base, {}).expect(201))
      .body as WeeklyReportView;
    expect(second).toMatchObject({
      revisionNo: 2,
      weekStart: report.weekStart,
    });
    expect(second.data.work.updates).toBe(3);
    const list = (await owner.get(base).expect(200))
      .body as WeeklyReportSummary[];
    expect(list.map((x) => [x.weekStart, x.revisionNo])).toEqual([
      [report.weekStart, 2],
      [previous.weekStart, 1],
    ]);

    // The owner marks it reviewed, once.
    await supervisor.post(`${base}/${second.id}/acknowledge`).expect(403);
    const acked = (
      await owner.post(`${base}/${second.id}/acknowledge`).expect(200)
    ).body as WeeklyReportView;
    expect(acked).toMatchObject({
      acknowledgedByName: 'Aline Uwase',
      canAcknowledge: false,
    });
    const again = (
      await owner.post(`${base}/${second.id}/acknowledge`).expect(200)
    ).body as WeeklyReportView;
    expect(again.acknowledgedAt).toBe(acked.acknowledgedAt);

    // The one-page PDF, with the photos embedded.
    const link = (await owner.post(`${base}/${second.id}/pdf`).expect(200))
      .body as { url: string };
    const pdf = Buffer.from(await (await fetch(link.url)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
    expect(
      (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length,
    ).toBe(1);
  }, 60_000);

  // Spec §26.5, §12: a limited report link — chosen sections, privacy preview, expiry, revocation.
  it('report links: privacy preview, no names or exact place, money only when chosen, expiry and revocation', async () => {
    const { contractor, owner, supervisor, project, stages } =
      await activeProject();
    await db.execute(
      sql`update projects set location = location || '{"sector":"Gatenga","district":"Kicukiro"}'::jsonb where id = ${project.id}`,
    );
    const kigaliToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
    }).format(new Date());
    const key = await uploadPhoto(supervisor, project.id);
    await supervisor
      .post(`/v1/projects/${project.id}/updates`, {
        stageId: stages[0].id,
        eventDate: kigaliToday,
        note: 'Footings poured',
        blockers: 'Steel delivery late',
        photos: [{ uploadKey: key }],
      })
      .expect(201);
    await processPhotos();
    const report = (
      await supervisor
        .post(`/v1/projects/${project.id}/reports`, {})
        .expect(201)
    ).body as WeeklyReportView;
    const base = `/v1/projects/${project.id}/reports/${report.id}/shares`;
    // A stage with site updates is underway even before its status changes: not "coming next".
    expect(report.data.next.map((n) => n.stage)).toEqual(['Walls']);
    const lean = {
      sections: ['work', 'photos', 'decisions'],
      expiresInDays: 7,
      allowDownload: false,
    };

    // The site supervisor reads reports but does not share them; a bad body is refused.
    await supervisor.post(base, lean).expect(403);
    await contractor.post(base, { ...lean, expiresInDays: 3 }).expect(400);

    // The privacy preview is exactly what the link shows: no names, district only, thumbnails only.
    const preview = (await contractor.post(`${base}/preview`, lean).expect(200))
      .body as SharedReportView;
    expect(preview).toMatchObject({
      sharedByName: 'Eric Mugisha',
      sections: ['work', 'photos', 'decisions'],
      allowDownload: false,
    });
    expect(preview.data.place).toBe('Kicukiro'); // the district, never the exact place
    expect(preview.data.work).toMatchObject({
      updates: 1,
      authors: [],
      blockers: [{ stage: 'Foundation', text: 'Steel delivery late' }],
    });
    expect([preview.data.money, preview.data.next]).toEqual([null, []]);
    expect(preview.photos).toHaveLength(1);
    expect(preview.photos[0].url).toContain('thumb');
    expect(
      ((await contractor.get(base).expect(200)).body as ReportShareView[])
        .length,
    ).toBe(0); // a preview makes no link

    const made = (await contractor.post(base, lean).expect(201))
      .body as CreatedReportShare;
    expect(made).toMatchObject({
      status: 'active',
      viewCount: 0,
      canRevoke: true,
      createdByName: 'Eric Mugisha',
    });
    const token = made.url.split('/s/')[1];
    expect(token.length).toBeGreaterThanOrEqual(40);

    // The recipient needs no account; each open is counted; no download on this link.
    const opened = (await http().get(`/v1/shared/reports/${token}`).expect(200))
      .body as SharedReportView;
    expect(opened.data).toEqual(preview.data);
    expect(opened.data.progress).toEqual(report.data.progress);
    await http().post(`/v1/shared/reports/${token}/pdf`).expect(403);
    await http()
      .get('/v1/shared/reports/not-a-real-link-token-at-all')
      .expect(404);
    const listed = (
      (await owner.get(base).expect(200)).body as ReportShareView[]
    )[0];
    expect(listed).toMatchObject({
      viewCount: 1,
      canRevoke: true,
      status: 'active',
    });
    expect(listed.lastViewedAt).not.toBeNull();

    // The owner shares the money too, with the PDF; amounts appear only with money.
    const money = (
      await owner
        .post(base, {
          sections: ['money', 'decisions'],
          expiresInDays: 1,
          allowDownload: true,
        })
        .expect(201)
    ).body as CreatedReportShare;
    const moneyToken = money.url.split('/s/')[1];
    const withMoney = (
      await http().get(`/v1/shared/reports/${moneyToken}`).expect(200)
    ).body as SharedReportView;
    expect(withMoney.data.money).toMatchObject({ contract: 45_000_000 });
    expect(withMoney.data.work.updates).toBe(0);
    const link = (
      await http()
        .post(`/v1/shared/reports/${moneyToken}/pdf?lang=fr`)
        .expect(200)
    ).body as { url: string };
    const pdf = Buffer.from(await (await fetch(link.url)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length,
    ).toBe(1);

    // The contractor cannot stop the owner's link; the owner can stop the contractor's.
    await contractor.post(`${base}/${money.id}/revoke`).expect(403);
    await supervisor.post(`${base}/${made.id}/revoke`).expect(403);
    const stopped = (await owner.post(`${base}/${made.id}/revoke`).expect(200))
      .body as ReportShareView;
    expect(stopped).toMatchObject({ status: 'revoked', canRevoke: false });
    expect(
      (
        (await http().get(`/v1/shared/reports/${token}`).expect(410)).body as {
          message: string;
        }
      ).message,
    ).toMatch(/stopped/);

    // Expired links stop on their own.
    await db.execute(
      sql`update report_shares set expires_at = now() - interval '1 minute' where id = ${money.id}`,
    );
    await http().get(`/v1/shared/reports/${moneyToken}`).expect(410);
    await http().post(`/v1/shared/reports/${moneyToken}/pdf`).expect(410);
    const audit = await db.execute<{ action: string }>(
      sql`select action from audit_events where action like 'report.share%' order by created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'report.shared',
      'report.shared',
      'report.share_revoked',
    ]);
  }, 60_000);

  // Spec §14.2, Phase 6: what the phone's send queue relies on when updates arrive late, twice or not at all.
  it('offline arrivals: late updates keep their day, resends replay, and refusals say no access, conflict or lost upload', async () => {
    const { contractor, supervisor, project, stages } = await activeProject();
    const base = `/v1/projects/${project.id}/updates`;
    const threeDaysAgo = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
    }).format(new Date(Date.now() - 3 * 86_400_000));

    // Written offline three days ago, sent now: the work day and the photo time are the phone's.
    const key = await uploadPhoto(supervisor, project.id);
    const body = {
      stageId: stages[0].id,
      eventDate: threeDaysAgo,
      note: 'Footings poured (written offline)',
      photos: [
        { uploadKey: key, capturedAt: `${threeDaysAgo}T09:15:00+02:00` },
      ],
    };
    const sendKey = randomUUID();
    const first = (await supervisor.post(base, body, sendKey).expect(201))
      .body as SiteUpdate;
    expect(first.eventDate).toBe(threeDaysAgo);

    // The reply was lost; the phone sends again under the same key: the same update comes back.
    const again = await supervisor.post(base, body, sendKey).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as SiteUpdate).id).toBe(first.id);
    // Two copies racing (a second device with the same queue copy): still one update.
    const raceKey = randomUUID();
    const raced = await Promise.all(
      [0, 1].map(() =>
        supervisor.post(
          base,
          { stageId: stages[0].id, note: 'Raced send' },
          raceKey,
        ),
      ),
    );
    expect(
      raced.map((r) => r.status).filter((c) => c === 201).length,
    ).toBeGreaterThanOrEqual(1);
    expect(raced.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const count = async (note: string) =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from site_updates where note = ${note}`,
        )
      ).rows[0].n;
    expect(await count('Footings poured (written offline)')).toBe(1);
    expect(await count('Raced send')).toBe(1);
    // An edited copy under the old key is refused (the phone sends edits under a new key).
    await supervisor
      .post(base, { ...body, note: 'Edited later' }, sendKey)
      .expect(409);

    // Uploads: another project's upload, and one that is gone (expired while offline) → "upload again".
    const lost = await supervisor
      .post(base, {
        stageId: stages[0].id,
        photos: [{ uploadKey: `tmp/${randomUUID()}/x.jpg` }],
      })
      .expect(400);
    expect(
      (lost.body as { fieldErrors: { field: string }[] }).fieldErrors[0].field,
    ).toMatch(/^photos\.0/);
    const gone = await supervisor
      .post(base, {
        stageId: stages[0].id,
        photos: [{ uploadKey: `tmp/${project.id}/never-uploaded.jpg` }],
      })
      .expect(400);
    expect(
      (gone.body as { fieldErrors: { field: string }[] }).fieldErrors[0].field,
    ).toMatch(/^photos\.0/);

    // The project was paused while the phone was offline: a conflict, nothing stored.
    await db.execute(
      sql`update projects set status = 'paused' where id = ${project.id}`,
    );
    await supervisor
      .post(base, { stageId: stages[0].id, note: 'While paused' })
      .expect(409);
    await db.execute(
      sql`update projects set status = 'active' where id = ${project.id}`,
    );

    // Signed out on another device (session ended): the old tokens no longer work (checked before any project).
    const started = (
      await http()
        .post('/v1/auth/otp/start')
        .send({ channel: 'sms', destination: '0788000039' })
        .expect(202)
    ).body as StartOtpResponse;
    const v = (
      await http()
        .post('/v1/auth/otp/verify')
        .send({
          challengeId: started.challengeId,
          code: sender.lastCodeFor('+250788000039'),
        })
        .expect(200)
    ).body as VerifyOtpResponse;
    await http()
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${v.accessToken}`)
      .expect(204);
    await http()
      .post(base)
      .set('Authorization', `Bearer ${v.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ stageId: stages[0].id, note: 'After logout' })
      .expect(401);
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: v.refreshToken })
      .expect(401);

    // Removed from the project: 404 (the project is no longer theirs); still a member but no longer a reporter: 403.
    const members = (
      await contractor.get(`/v1/projects/${project.id}/members`).expect(200)
    ).body as { membershipId: string; role: string }[];
    const sup = members.find((m) => m.role === 'supervisor')!;
    await db.execute(
      sql`update project_memberships set status = 'revoked', revoked_at = now() where id = ${sup.membershipId}`,
    );
    await supervisor
      .post(base, { stageId: stages[0].id, note: 'After removal' })
      .expect(404);
    await db.execute(
      sql`update project_memberships set status = 'active', revoked_at = null, role = 'viewer' where id = ${sup.membershipId}`,
    );
    await supervisor
      .post(base, { stageId: stages[0].id, note: 'As a viewer' })
      .expect(403);
    expect(await count('After removal')).toBe(0);
  }, 60_000);
});
