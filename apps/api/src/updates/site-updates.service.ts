import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateSiteUpdateRequest,
  MAX_PHOTO_BYTES,
  PhotoContentType,
  type ProjectRole,
  RequestUploadRequest,
  type SiteUpdate,
  type StageTimeline,
  type ProjectProgress,
  type ProjectOverview,
  displayStatusOf,
  nextActionFor,
  progressPercents,
  StageReviewRequest,
  SubmitStageRequest,
  UpdatesQuery,
  photoTime,
  type UploadGrantView,
} from '@jengalink/contracts';
import { and, asc, count, desc, eq, inArray, lt, max, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ZodPipe } from '../common/zod.pipe';
import type { Database, Tx } from '../db/client';
import { AuditService } from '../audit/audit.service';
import {
  parseIfMatch,
  PreconditionRequiredException,
  VersionConflictException,
} from '../common/versioning';
import { DB } from '../db/database.module';
import {
  media,
  organizations,
  projectMemberships,
  projects,
  siteUpdates,
  stageReviews,
  stages,
  users,
} from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { AccessService, seesMoney } from '../projects/access.service';
import {
  mediaKey,
  StorageService,
  UploadRejectedError,
} from '../storage/storage.service';

/** Who reports from site (spec §3.2): contractor, supervisor and project manager. */
export const REPORTERS: readonly ProjectRole[] = [
  'contractor',
  'supervisor',
  'manager',
];
const uploadPipe = new ZodPipe(RequestUploadRequest);
const createPipe = new ZodPipe(CreateSiteUpdateRequest);
const queryPipe = new ZodPipe(UpdatesQuery);
const submitPipe = new ZodPipe(SubmitStageRequest);
const reviewPipe = new ZodPipe(StageReviewRequest);
/** Who says a stage is done, and who accepts it (spec §3.2). */
const SUBMITTERS: readonly ProjectRole[] = ['contractor', 'manager'];
const REVIEWERS: readonly ProjectRole[] = ['owner', 'delegate'];
const SUBMITTABLE: readonly string[] = [
  'not_started',
  'in_progress',
  'changes_required',
];

/** Today's date in the project's time zone, as YYYY-MM-DD. */
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

@Injectable()
export class SiteUpdatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** A signed PUT for one photo, bound to this project by its temporary key. */
  async requestUpload(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<UploadGrantView> {
    await this.requireReporter(userId, projectId);
    const req = uploadPipe.transform(body);
    return this.storage.createUploadGrant(
      req.contentType,
      MAX_PHOTO_BYTES,
      `tmp/${projectId}/`,
    );
  }

  /**
   * Creates the update and moves its photos from temporary to final keys.
   * Photos are checked (exists, size, type) before anything is saved.
   */
  async create(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<SiteUpdate> {
    const project = await this.requireReporter(userId, projectId);
    const req = createPipe.transform(body);
    if (project.status !== 'active')
      throw new ConflictException(
        'Site updates start once the owner has accepted the project.',
      );
    const [stage] = await this.db
      .select({ id: stages.id })
      .from(stages)
      .where(and(eq(stages.id, req.stageId), eq(stages.projectId, projectId)));
    if (!stage)
      throw new BadRequestException({
        message: 'Unknown stage',
        fieldErrors: [
          { field: 'stageId', message: 'Not a stage of this project' },
        ],
      });
    const prefix = `tmp/${projectId}/`;
    const badKey = req.photos.findIndex(
      (p) => !p.uploadKey.startsWith(prefix) || p.uploadKey.includes('..'),
    );
    if (badKey >= 0)
      throw new BadRequestException({
        message: 'Unknown photo upload',
        fieldErrors: [
          {
            field: `photos.${badKey}.uploadKey`,
            message: 'Not an upload for this project',
          },
        ],
      });

    // Promote first (storage is not transactional); a failed photo stops the whole update.
    const promoted: { key: string; sizeBytes: number; contentType: string }[] =
      [];
    try {
      for (const p of req.photos) {
        const mediaId = crypto.randomUUID();
        promoted.push(
          await this.storage.promoteChecked(
            p.uploadKey,
            {
              maxBytes: MAX_PHOTO_BYTES,
              contentTypes: PhotoContentType.options,
            },
            mediaKey(project.organizationId, projectId, mediaId),
          ),
        );
      }
    } catch (err) {
      await Promise.all(
        promoted.map((m) => this.storage.delete(m.key).catch(() => undefined)),
      );
      if (err instanceof UploadRejectedError)
        throw new BadRequestException({
          message: `A photo could not be used: ${err.message}`,
          fieldErrors: [
            { field: `photos.${promoted.length}`, message: err.message },
          ],
        });
      throw err;
    }

    const id = await this.db.transaction(async (tx) => {
      const [update] = await tx
        .insert(siteUpdates)
        .values({
          organizationId: project.organizationId,
          projectId,
          stageId: req.stageId,
          eventDate: req.eventDate ?? todayIn(project.timezone),
          note: req.note || null,
          blockers: req.blockers || null,
          createdBy: userId,
        })
        .returning({ id: siteUpdates.id });
      if (promoted.length)
        await tx.insert(media).values(
          promoted.map((m, i) => ({
            organizationId: project.organizationId,
            projectId,
            siteUpdateId: update.id,
            position: i,
            storageKey: m.key,
            contentType: m.contentType,
            sizeBytes: m.sizeBytes,
            capturedAt: req.photos[i].capturedAt
              ? new Date(req.photos[i].capturedAt)
              : null,
            capturedAtSource: req.photos[i].capturedAt
              ? ('device' as const)
              : null,
            createdBy: userId,
          })),
        );
      await recordEvent(
        tx,
        'site_update.submitted',
        {
          siteUpdateId: update.id,
          projectId,
          photos: promoted.length,
          hasBlockers: !!req.blockers,
        },
        userId,
      );
      return update.id;
    });
    const [view] = await this.views(projectId, [id]);
    return view;
  }

  /** Updates newest first, with short-lived photo links. Any member may read. */
  async list(
    userId: string,
    projectId: string,
    query: unknown = {},
  ): Promise<SiteUpdate[]> {
    await this.access.requireProject(userId, projectId);
    const q = queryPipe.transform(query);
    return this.views(projectId, undefined, {
      stageId: q.stageId,
      before: q.before ? new Date(q.before) : undefined,
      limit: q.limit ?? 20,
    });
  }

  /** Accepted and reported progress plus what each stage shows on the tower (spec §5.3). */
  async progress(userId: string, projectId: string): Promise<ProjectProgress> {
    await this.access.requireProject(userId, projectId);
    return this.progressOf(projectId);
  }

  /** Progress without an access check (callers check first). */
  async progressOf(
    projectId: string,
    /** Read inside the caller's transaction (an export's consistent snapshot). */
    db: Database | Tx = this.db,
  ): Promise<ProjectProgress> {
    const stageRows = await db
      .select()
      .from(stages)
      .where(eq(stages.projectId, projectId))
      .orderBy(asc(stages.position));
    const counts = await db
      .select({
        stageId: siteUpdates.stageId,
        n: count(),
        last: max(siteUpdates.createdAt),
      })
      .from(siteUpdates)
      .where(eq(siteUpdates.projectId, projectId))
      .groupBy(siteUpdates.stageId);
    // The newest update per stage decides whether it is currently blocked.
    const latest = await db.execute<{
      stage_id: string;
      blockers: string | null;
    }>(
      sql`select distinct on (stage_id) stage_id, blockers from site_updates
          where project_id = ${projectId} order by stage_id, created_at desc`,
    );
    // The owner's latest "changes requested" note per stage.
    const notes = await db.execute<{
      stage_id: string;
      note: string | null;
    }>(
      sql`select distinct on (stage_id) stage_id, note from stage_reviews
          where project_id = ${projectId} and kind = 'changes_requested' order by stage_id, created_at desc`,
    );
    const changeNotes = new Map(notes.rows.map((r) => [r.stage_id, r.note]));
    const byStage = new Map(counts.map((c) => [c.stageId, c]));
    const blockers = new Map(latest.rows.map((r) => [r.stage_id, r.blockers]));
    const list = stageRows.map((s) => {
      const facts = {
        weight: s.weight,
        status: s.status,
        updateCount: byStage.get(s.id)?.n ?? 0,
        blocker: blockers.get(s.id) ?? null,
      };
      const last = byStage.get(s.id)?.last;
      return {
        id: s.id,
        name: s.name,
        position: s.position,
        revision: s.revision,
        changesNote:
          s.status === 'changes_required'
            ? (changeNotes.get(s.id) ?? null)
            : null,
        ...facts,
        displayStatus: displayStatusOf(facts),
        lastUpdateAt: last ? new Date(last).toISOString() : null,
      };
    });
    const lastTimes = list
      .map((s) => s.lastUpdateAt)
      .filter((x): x is string => !!x)
      .sort();
    return {
      projectId,
      ...progressPercents(list),
      stages: list,
      lastUpdateAt: lastTimes.at(-1) ?? null,
    };
  }

  /** One stage's photo story: details, every update, and the first and latest photo for before/after. */
  async timeline(
    userId: string,
    projectId: string,
    stageId: string,
  ): Promise<StageTimeline> {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    const [stage] = await this.db
      .select()
      .from(stages)
      .where(and(eq(stages.id, stageId), eq(stages.projectId, projectId)));
    if (!stage) throw new NotFoundException('Stage not found');
    const reviews = await this.reviewsOf(stageId);
    const updates = await this.views(projectId, undefined, {
      stageId,
      limit: 50,
    });
    const ready = updates
      .flatMap((u) => u.photos)
      .filter((p) => p.status === 'ready')
      .sort((a, b) => photoTime(a).localeCompare(photoTime(b)));
    return {
      stage: {
        id: stage.id,
        name: stage.name,
        position: stage.position,
        weight: stage.weight,
        status: stage.status,
        revision: stage.revision,
        plannedStart: stage.plannedStart,
        plannedEnd: stage.plannedEnd,
        criteria: stage.criteria,
      },
      before: ready.length >= 2 ? ready[0] : null,
      after: ready.length >= 2 ? ready[ready.length - 1] : null,
      photoCount: ready.length,
      updates,
      reviews,
      canSubmit:
        project.status === 'active' &&
        roles.some((r) => SUBMITTERS.includes(r)) &&
        SUBMITTABLE.includes(stage.status) &&
        updates.length > 0,
      canReview:
        project.status === 'active' &&
        roles.some((r) => REVIEWERS.includes(r)) &&
        stage.status === 'ready_for_review',
    };
  }

  /* ---------- stage review (spec §13.2) ---------- */

  /**
   * The contractor or manager says the stage is done. It needs at least one site update
   * as evidence; the owner then accepts the exact revision or asks for changes.
   */
  async submitStage(
    userId: string,
    projectId: string,
    stageId: string,
    body: unknown,
  ) {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => SUBMITTERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor or project manager can submit a stage for review',
      );
    const req = submitPipe.transform(body);
    if (project.status !== 'active')
      throw new ConflictException('The project has not started');
    await this.db.transaction(async (tx) => {
      const [stage] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.id, stageId), eq(stages.projectId, projectId)))
        .for('update');
      if (!stage) throw new NotFoundException('Stage not found');
      if (!SUBMITTABLE.includes(stage.status))
        throw new ConflictException(
          stage.status === 'accepted'
            ? 'This stage is already accepted'
            : 'This stage is already waiting for review',
        );
      const [evidence] = await tx
        .select({ n: count() })
        .from(siteUpdates)
        .where(eq(siteUpdates.stageId, stageId));
      if (!evidence.n)
        throw new ConflictException(
          'Post at least one site update for this stage before submitting it',
        );
      const revision = stage.revision + 1;
      await tx
        .update(stages)
        .set({ status: 'ready_for_review', revision, updatedAt: new Date() })
        .where(eq(stages.id, stageId));
      await this.recordReview(
        tx,
        project,
        stage,
        'submitted',
        req.note || null,
        revision,
        userId,
      );
    });
    return this.timeline(userId, projectId, stageId);
  }

  /** The owner accepts the exact stage revision (If-Match) or asks for changes with a note. */
  async reviewStage(
    userId: string,
    projectId: string,
    stageId: string,
    ifMatch: string | undefined,
    body: unknown,
  ) {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => REVIEWERS.includes(r)))
      throw new ForbiddenException(
        'Only the owner can accept a stage or ask for changes',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = reviewPipe.transform(body);
    await this.db.transaction(async (tx) => {
      const [stage] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.id, stageId), eq(stages.projectId, projectId)))
        .for('update');
      if (!stage) throw new NotFoundException('Stage not found');
      if (stage.revision !== expected)
        throw new VersionConflictException(stage.revision);
      if (stage.status !== 'ready_for_review')
        throw new ConflictException('This stage is not waiting for review');
      const accepted = req.decision === 'accept';
      const revision = stage.revision + 1;
      await tx
        .update(stages)
        .set({
          status: accepted ? 'accepted' : 'changes_required',
          revision,
          updatedAt: new Date(),
        })
        .where(eq(stages.id, stageId));
      await this.recordReview(
        tx,
        project,
        stage,
        accepted ? 'accepted' : 'changes_requested',
        req.note || null,
        expected,
        userId,
      );
    });
    return this.timeline(userId, projectId, stageId);
  }

  private async recordReview(
    tx: Tx,
    project: { organizationId: string; id: string },
    stage: typeof stages.$inferSelect,
    kind: 'submitted' | 'accepted' | 'changes_requested',
    note: string | null,
    stageRevision: number,
    userId: string,
  ) {
    const [row] = await tx
      .insert(stageReviews)
      .values({
        organizationId: project.organizationId,
        projectId: project.id,
        stageId: stage.id,
        kind,
        note,
        stageRevision,
        criteria: stage.criteria,
        actorId: userId,
      })
      .returning({ id: stageReviews.id });
    await this.audit.record(tx, {
      action:
        kind === 'submitted'
          ? 'stage.submitted'
          : kind === 'accepted'
            ? 'stage.accepted'
            : 'stage.changes_requested',
      actor: { userId },
      organizationId: project.organizationId,
      projectId: project.id,
      target: { type: 'stage', id: stage.id },
      metadata: {
        stage: stage.name,
        weight: stage.weight,
        revision: stageRevision,
      },
    });
    await recordEvent(
      tx,
      'stage.reviewed',
      { reviewId: row.id, projectId: project.id, stageId: stage.id, kind },
      userId,
    );
  }

  private async reviewsOf(stageId: string) {
    const actor = alias(users, 'actor');
    const rows = await this.db
      .select({ r: stageReviews, name: actor.displayName })
      .from(stageReviews)
      .leftJoin(actor, eq(actor.id, stageReviews.actorId))
      .where(eq(stageReviews.stageId, stageId))
      .orderBy(desc(stageReviews.createdAt));
    return rows.map(({ r, name }) => ({
      id: r.id,
      kind: r.kind,
      note: r.note,
      actorName: name,
      stageRevision: r.stageRevision,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /* ---------- multi-project overview ---------- */

  /** Every project of the caller with progress, blockers and the next action for their role. */
  async overview(userId: string): Promise<ProjectOverview[]> {
    const mine = await this.db
      .select({
        p: projects,
        orgName: organizations.name,
        role: projectMemberships.role,
        finance: projectMemberships.financialVisibility,
      })
      .from(projectMemberships)
      .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
      .where(
        and(
          eq(projectMemberships.userId, userId),
          eq(projectMemberships.status, 'active'),
        ),
      )
      .orderBy(desc(projects.updatedAt));
    const grouped = new Map<
      string,
      {
        p: typeof projects.$inferSelect;
        orgName: string;
        roles: ProjectRole[];
        finance: boolean;
      }
    >();
    for (const r of mine) {
      const g = grouped.get(r.p.id) ?? {
        p: r.p,
        orgName: r.orgName,
        roles: [],
        finance: false,
      };
      g.roles.push(r.role);
      g.finance ||= r.finance || r.role === 'owner';
      grouped.set(r.p.id, g);
    }
    const owners = await this.db
      .select({ projectId: projectMemberships.projectId })
      .from(projectMemberships)
      .where(
        and(
          inArray(
            projectMemberships.projectId,
            [...grouped.keys()].length
              ? [...grouped.keys()]
              : ['00000000-0000-0000-0000-000000000000'],
          ),
          eq(projectMemberships.role, 'owner'),
          eq(projectMemberships.status, 'active'),
        ),
      );
    const withOwner = new Set(owners.map((o) => o.projectId));
    const out: ProjectOverview[] = [];
    for (const { p, orgName, roles, finance } of grouped.values()) {
      const prog = await this.progressOf(p.id);
      const base = {
        status: p.status,
        myRoles: roles,
        hasOwner: withOwner.has(p.id),
        contractValue: p.contractValue,
        lastUpdateAt: prog.lastUpdateAt,
      };
      out.push({
        id: p.id,
        name: p.name,
        organizationName: orgName,
        ...base,
        acceptedPercent: prog.acceptedPercent,
        reportedPercent: prog.reportedPercent,
        stageCount: prog.stages.length,
        blockers: prog.stages
          .filter((s) => s.displayStatus === 'blocked' && s.blocker)
          .map((s) => ({ stageId: s.id, stageName: s.name, text: s.blocker! })),
        waitingReview: prog.stages.filter(
          (s) => s.status === 'ready_for_review',
        ).length,
        changesRequested: prog.stages.filter(
          (s) => s.status === 'changes_required',
        ).length,
        nextAction: nextActionFor({ ...base, stages: prog.stages }),
        // The next action may know a value exists; only money readers see it.
        contractValue: seesMoney(roles, finance) ? p.contractValue : null,
        seesMoney: seesMoney(roles, finance),
      });
    }
    // Projects needing something first, then by most recent activity.
    return out.sort(
      (a, b) =>
        Number(b.nextAction.kind !== 'none') -
          Number(a.nextAction.kind !== 'none') ||
        (b.lastUpdateAt ?? '').localeCompare(a.lastUpdateAt ?? ''),
    );
  }

  private async requireReporter(userId: string, projectId: string) {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => REPORTERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor, site supervisor or project manager can post site updates',
      );
    return project;
  }

  /** Update views without an access check (callers check first). */
  async views(
    projectId: string,
    ids?: string[],
    opts: { stageId?: string; before?: Date; limit?: number } = {},
  ): Promise<SiteUpdate[]> {
    const author = alias(users, 'author');
    const rows = await this.db
      .select({
        u: siteUpdates,
        stageName: stages.name,
        authorName: author.displayName,
      })
      .from(siteUpdates)
      .innerJoin(stages, eq(stages.id, siteUpdates.stageId))
      .leftJoin(author, eq(author.id, siteUpdates.createdBy))
      .where(
        and(
          eq(siteUpdates.projectId, projectId),
          ids ? inArray(siteUpdates.id, ids) : undefined,
          opts.stageId ? eq(siteUpdates.stageId, opts.stageId) : undefined,
          opts.before ? lt(siteUpdates.createdAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(siteUpdates.createdAt))
      .limit(opts.limit ?? 50);
    if (!rows.length) return [];
    const photos = await this.db
      .select()
      .from(media)
      .where(
        inArray(
          media.siteUpdateId,
          rows.map((r) => r.u.id),
        ),
      )
      .orderBy(asc(media.position));
    // Links only for clean photos: nothing unscanned or blocked is ever handed out.
    const links = new Map(
      await Promise.all(
        photos
          .filter((p) => p.scanStatus === 'clean')
          .map(
            async (p) =>
              [
                p.id,
                {
                  url: await this.storage.createDownloadUrl(p.storageKey),
                  thumbUrl: p.thumbKey
                    ? await this.storage.createDownloadUrl(p.thumbKey)
                    : null,
                },
              ] as const,
          ),
      ),
    );
    const status = {
      pending: 'processing',
      clean: 'ready',
      infected: 'blocked',
      failed: 'failed',
    } as const;
    return rows.map(({ u, stageName, authorName }) => ({
      id: u.id,
      projectId: u.projectId,
      stageId: u.stageId,
      stageName,
      authorName,
      eventDate: u.eventDate,
      note: u.note,
      blockers: u.blockers,
      submittedAt: u.createdAt.toISOString(),
      revision: u.revision,
      photos: photos
        .filter((p) => p.siteUpdateId === u.id)
        .map((p) => ({
          id: p.id,
          status: status[p.scanStatus],
          url: links.get(p.id)?.url ?? null,
          thumbUrl: links.get(p.id)?.thumbUrl ?? null,
          contentType: p.contentType,
          width: p.width,
          height: p.height,
          capturedAt: p.capturedAt?.toISOString() ?? null,
          capturedAtSource: p.capturedAtSource,
          uploadedAt: p.createdAt.toISOString(),
        })),
    }));
  }
}
