import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type ClaimFile,
  type ClaimMilestones,
  type ClaimStatus,
  ClaimDecisionRequest,
  type ClaimSummary,
  type ClaimView,
  claimProblems,
  EDITABLE_CLAIMS,
  RESENT_ON_EDIT,
  MAX_CLAIM_FILE_BYTES,
  MAX_CLAIM_FILES,
  type ProjectRole,
  RequestClaimUploadRequest,
  SaveClaimRequest,
  STANDING_CLAIMS,
  type UploadGrantView,
} from '@jengalink/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import {
  parseIfMatch,
  PreconditionRequiredException,
  VersionConflictException,
} from '../common/versioning';
import { ZodPipe } from '../common/zod.pipe';
import type { Database, Tx } from '../db/client';
import { DB } from '../db/database.module';
import {
  agreements,
  claimDecisions,
  claimRevisions,
  claims,
  claimUpdates,
  media,
  organizations,
  payments,
  projects,
  siteUpdates,
  users,
} from '../db/schema';
import type { QuoteMilestone } from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { AttachmentsService, type Promoted } from '../media/attachments';
import { AccessService, type ProjectAccess } from '../projects/access.service';
import { StorageService } from '../storage/storage.service';
import { SiteUpdatesService } from '../updates/site-updates.service';

/** Who writes and sends claims: the contractor's side (spec §37.1). */
const CLAIMERS: readonly ProjectRole[] = ['contractor', 'manager'];
const savePipe = new ZodPipe(SaveClaimRequest);
const uploadPipe = new ZodPipe(RequestClaimUploadRequest);
/** Sent with the submit button; a claim already sent is resent by saving it (a new revision). */
const SUBMITTABLE: readonly ClaimStatus[] = ['draft', 'changes_requested'];
/** Who answers a claim for the client; never the contractor's side (spec §41). */
const DECIDERS: readonly ProjectRole[] = ['owner', 'delegate'];
const decisionPipe = new ZodPipe(ClaimDecisionRequest);
const decisionKind = {
  approve: 'approved',
  reject: 'rejected',
  request_changes: 'changes_requested',
} as const;
const CANCELLABLE: readonly ClaimStatus[] = [
  'draft',
  'submitted',
  'changes_requested',
];
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

type ClaimRow = typeof claims.$inferSelect;
type AgreementRow = typeof agreements.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SaveReq = ReturnType<typeof savePipe.transform>;

/**
 * Payment claims (spec §37.1): the contractor asks to be paid for a milestone of the current
 * agreement, with evidence. A record only: the owner pays outside JengaLink.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly updates: SiteUpdatesService,
    private readonly files: AttachmentsService,
  ) {}

  /** Signed PUT for one claim file (photo or PDF), bound to this project's claim uploads. */
  async requestUpload(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<UploadGrantView> {
    await this.requireClaimer(userId, projectId);
    const req = uploadPipe.transform(body);
    return this.storage.createUploadGrant(
      req.contentType,
      MAX_CLAIM_FILE_BYTES,
      this.uploadPrefix(projectId),
    );
  }

  /** The current agreement's milestones and what is already claimed on each. */
  async milestones(
    userId: string,
    projectId: string,
  ): Promise<ClaimMilestones> {
    const { claimer } = await this.requireReader(userId, projectId);
    const agreement = await this.currentAgreement(this.db, projectId);
    if (!agreement)
      return {
        agreementId: null,
        agreementVersion: null,
        currency: 'RWF',
        milestones: [],
      };
    const milestones: ClaimMilestones['milestones'] = [];
    for (const [index, m] of agreement.milestones.entries()) {
      const claimed = await this.claimedOn(this.db, projectId, m.name, claimer);
      const basis = m.basis ?? 'fixed';
      milestones.push({
        index,
        name: m.name,
        amount: m.amount,
        basis,
        feePercent: m.feeBasisPoints != null ? m.feeBasisPoints / 100 : null,
        stageId: m.stageId,
        claimed,
        remaining: basis === 'fixed' ? Math.max(0, m.amount - claimed) : null,
      });
    }
    return {
      agreementId: agreement.id,
      agreementVersion: agreement.version,
      currency: agreement.currency,
      milestones,
    };
  }

  /** Claims newest first. Drafts are the contractor side's own business. */
  async list(userId: string, projectId: string): Promise<ClaimSummary[]> {
    const { claimer } = await this.requireReader(userId, projectId);
    const rows = await this.db
      .select({ c: claims, currency: agreements.currency })
      .from(claims)
      .innerJoin(agreements, eq(agreements.id, claims.agreementId))
      .where(
        and(
          eq(claims.projectId, projectId),
          claimer ? undefined : ne(claims.status, 'draft'),
        ),
      )
      .orderBy(desc(claims.updatedAt));
    const evidence = await this.evidenceCounts(rows.map((r) => r.c.id));
    return rows.map(({ c, currency }) => ({
      id: c.id,
      number: c.number,
      status: c.status,
      milestoneName: c.milestoneName,
      amount: c.amount,
      currency,
      evidenceCount: evidence.get(c.id) ?? 0,
      submittedAt: c.submittedAt?.toISOString() ?? null,
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async create(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<ClaimView> {
    const { project } = await this.requireClaimer(userId, projectId);
    const req = savePipe.transform(body);
    const agreement = await this.currentAgreement(this.db, projectId);
    if (!agreement)
      throw new ConflictException(
        'There is no agreement yet: the owner must accept a quote first',
      );
    const milestone = this.milestoneOf(agreement, req.milestoneIndex);
    await this.checkUpdates(projectId, req.siteUpdateIds);
    const promoted = await this.files.promote(
      project,
      req.files,
      this.uploadPrefix(project.id),
    );
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        await this.lockCeiling(tx, projectId);
        await this.checkCeiling(tx, projectId, milestone, req.amount);
        // Per-organization numbering: one writer at a time for this organization.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${'claims:' + project.organizationId}))`,
        );
        const year = todayIn(project.timezone).slice(0, 4);
        const [{ n }] = await tx
          .select({ n: count() })
          .from(claims)
          .where(
            and(
              eq(claims.organizationId, project.organizationId),
              sql`${claims.number} like ${`C-${year}-%`}`,
            ),
          );
        const [c] = await tx
          .insert(claims)
          .values({
            organizationId: project.organizationId,
            projectId,
            number: `C-${year}-${String(n + 1).padStart(4, '0')}`,
            agreementId: agreement.id,
            milestoneIndex: req.milestoneIndex,
            milestoneName: milestone.name,
            milestoneAmount: milestone.amount,
            amount: req.amount,
            note: req.note || null,
            createdBy: userId,
          })
          .returning();
        await this.linkUpdates(tx, c.id, req.siteUpdateIds, userId);
        await this.addFiles(tx, project, c.id, promoted, req, 0, userId);
        await this.recordAudit(tx, 'claim.created', userId, project, c);
        return c.id;
      });
    } catch (err) {
      await this.files.dropKeys(promoted.map((p) => p.key));
      throw err;
    }
    return this.get(userId, projectId, id);
  }

  async get(
    userId: string,
    projectId: string,
    claimId: string,
  ): Promise<ClaimView> {
    const { project, claimer, roles } = await this.requireReader(
      userId,
      projectId,
    );
    const c = await this.find(this.db, projectId, claimId);
    if (c.status === 'draft' && !claimer)
      throw new NotFoundException('Claim not found');
    const [row] = await this.db
      .select({ a: agreements, org: organizations.name })
      .from(agreements)
      .innerJoin(organizations, eq(organizations.id, agreements.organizationId))
      .where(eq(agreements.id, c.agreementId));
    const m = row.a.milestones[c.milestoneIndex] as QuoteMilestone | undefined;
    const money = await this.paymentTotals(c.id);
    // Money recorded on a claim fixes it.
    const fixed = money.paidAmount + money.pendingPayments > 0;
    const linked = await this.db
      .select({ id: claimUpdates.siteUpdateId })
      .from(claimUpdates)
      .where(eq(claimUpdates.claimId, c.id));
    return {
      id: c.id,
      projectId,
      projectName: project.name,
      organizationName: row.org,
      number: c.number,
      status: c.status,
      agreementVersion: row.a.version,
      milestoneIndex: c.milestoneIndex,
      milestoneName: c.milestoneName,
      milestoneAmount: c.milestoneAmount,
      basis: m?.basis ?? 'fixed',
      feePercent: m?.feeBasisPoints != null ? m.feeBasisPoints / 100 : null,
      claimedBefore: await this.claimedOn(
        this.db,
        projectId,
        c.milestoneName,
        claimer,
        c.id,
      ),
      amount: c.amount,
      currency: row.a.currency,
      note: c.note,
      updates: linked.length
        ? await this.updates.views(
            projectId,
            linked.map((l) => l.id),
          )
        : [],
      files: await this.filesOf(c.id),
      createdByName: await this.nameOf(c.createdBy),
      submittedByName: await this.nameOf(c.submittedBy),
      submittedAt: c.submittedAt?.toISOString() ?? null,
      updatedAt: c.updatedAt.toISOString(),
      canEdit: claimer && !fixed && EDITABLE_CLAIMS.includes(c.status),
      ...money,
      revisionNo: c.revisionNo,
      savingSendsRevision:
        claimer && !fixed && RESENT_ON_EDIT.includes(c.status),
      revisions: await this.revisionsOf(c.id),
      // Someone on both sides (an owner who is also the contractor) never approves their own claim.
      canDecide:
        c.status === 'submitted' &&
        roles.some((r) => DECIDERS.includes(r)) &&
        !claimer,
      decisions: await this.decisionsOf(c.id),
      version: c.revision,
    };
  }

  /**
   * Saves a draft, or a claim sent back for changes. Saving a claim already sent (submitted or
   * approved) sends the next revision at once and cancels an approval. If-Match = the claim's version.
   */
  async save(
    userId: string,
    projectId: string,
    claimId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<ClaimView> {
    const { project } = await this.requireClaimer(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = savePipe.transform(body);
    await this.checkUpdates(projectId, req.siteUpdateIds);
    const promoted = await this.files.promote(
      project,
      req.files,
      this.uploadPrefix(project.id),
    );
    let removed: string[];
    try {
      removed = await this.db.transaction(async (tx) => {
        const c = await this.find(tx, projectId, claimId, true);
        if (c.revision !== expected)
          throw new VersionConflictException(c.revision);
        if (!EDITABLE_CLAIMS.includes(c.status))
          throw new ConflictException(`This claim is ${c.status}`);
        const resend = RESENT_ON_EDIT.includes(c.status);
        // Money recorded against it fixes the claim: correct the payment instead.
        const { paidAmount, pendingPayments } = await this.paymentTotals(
          c.id,
          tx,
        );
        if (paidAmount + pendingPayments > 0)
          throw new ConflictException(
            'Payments are recorded on this claim, so it can no longer change',
          );
        if (resend && (req.changeNote ?? '').length < 3)
          throw new BadRequestException({
            message:
              'Say what changed: the owner sees it with the new revision',
            fieldErrors: [{ field: 'changeNote', message: 'Required' }],
          });
        // A draft follows the current agreement; a claim already sent keeps its milestone.
        let agreement: AgreementRow | undefined;
        if (c.status === 'draft') {
          agreement = await this.currentAgreement(tx, projectId);
        } else {
          if (req.milestoneIndex !== c.milestoneIndex)
            throw new ConflictException(
              'The milestone of a claim already sent cannot change',
            );
          [agreement] = await tx
            .select()
            .from(agreements)
            .where(eq(agreements.id, c.agreementId));
        }
        if (!agreement) throw new ConflictException('There is no agreement');
        const m = this.milestoneOf(agreement, req.milestoneIndex);
        await this.lockCeiling(tx, projectId);
        await this.checkCeiling(tx, projectId, m, req.amount, c.id);
        await tx
          .update(claims)
          .set({
            agreementId: agreement.id,
            milestoneIndex: req.milestoneIndex,
            milestoneName: m.name,
            milestoneAmount: m.amount,
            amount: req.amount,
            note: req.note || null,
            updatedAt: new Date(),
            revision: sql`${claims.revision} + 1`,
          })
          .where(eq(claims.id, c.id));
        await tx.delete(claimUpdates).where(eq(claimUpdates.claimId, c.id));
        await this.linkUpdates(tx, c.id, req.siteUpdateIds, userId);
        // Once sent, a file stays (an earlier revision showed it); it is only taken off.
        const which = and(
          eq(media.claimId, c.id),
          inArray(media.id, req.removeFileIds),
        );
        let gone: { key: string; thumb: string | null }[] = [];
        if (req.removeFileIds.length && c.revisionNo > 0)
          await tx
            .update(media)
            .set({ removedAt: new Date(), updatedAt: new Date() })
            .where(and(which, isNull(media.removedAt)));
        else if (req.removeFileIds.length)
          gone = await tx
            .delete(media)
            .where(which)
            .returning({ key: media.storageKey, thumb: media.thumbKey });
        const [{ kept, last }] = await tx
          .select({
            kept: count(),
            last: sql<number>`coalesce(max(${media.position}), -1)::int`,
          })
          .from(media)
          .where(and(eq(media.claimId, c.id), isNull(media.removedAt)));
        if (kept + promoted.length > MAX_CLAIM_FILES)
          throw new BadRequestException({
            message: `A claim takes at most ${MAX_CLAIM_FILES} files`,
            fieldErrors: [{ field: 'files', message: 'Too many files' }],
          });
        await this.addFiles(tx, project, c.id, promoted, req, last + 1, userId);
        if (resend)
          await this.sendRevision(tx, project, c.id, userId, {
            changeNote: req.changeNote ?? null,
            cancelledApproval: c.status === 'approved',
          });
        return gone.flatMap((g) => (g.thumb ? [g.key, g.thumb] : [g.key]));
      });
    } catch (err) {
      await this.files.dropKeys(promoted.map((p) => p.key));
      throw err;
    }
    // Storage is not transactional: old files go only once their rows are gone.
    await this.files.dropKeys(removed);
    return this.get(userId, projectId, claimId);
  }

  /** Sends the claim to the owner: evidence required, fixed prices not exceeded. */
  async submit(
    userId: string,
    projectId: string,
    claimId: string,
    ifMatch: string | undefined,
  ): Promise<ClaimView> {
    const { project } = await this.requireClaimer(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const c = await this.find(tx, projectId, claimId, true);
      if (c.revision !== expected)
        throw new VersionConflictException(c.revision);
      if (!SUBMITTABLE.includes(c.status))
        throw new ConflictException(`This claim is ${c.status}`);
      await this.sendRevision(tx, project, c.id, userId, {
        changeNote: null,
        cancelledApproval: false,
      });
    });
    return this.get(userId, projectId, claimId);
  }

  /**
   * The owner approves, rejects or asks for changes on the exact version and amount they read.
   * Approving does not pay: JengaLink records it, and the payment is recorded later.
   */
  async decide(
    userId: string,
    projectId: string,
    claimId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<ClaimView> {
    const { project, roles, claimer } = await this.requireReader(
      userId,
      projectId,
    );
    if (!roles.some((r) => DECIDERS.includes(r)) || claimer)
      throw new ForbiddenException(
        'Only the owner (or their delegate) can answer a payment claim',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = decisionPipe.transform(body);
    await this.db.transaction(async (tx) => {
      const c = await this.find(tx, projectId, claimId, true);
      if (c.status === 'draft') throw new NotFoundException('Claim not found');
      if (c.revision !== expected)
        throw new VersionConflictException(c.revision);
      if (c.status !== 'submitted')
        throw new ConflictException(`This claim is ${c.status}`);
      if (req.amount !== c.amount)
        throw new ConflictException({
          message: 'The amount changed since you opened this claim',
          fieldErrors: [{ field: 'amount', message: 'Does not match' }],
        });
      const kind = decisionKind[req.decision];
      await tx.insert(claimDecisions).values({
        organizationId: project.organizationId,
        projectId,
        claimId: c.id,
        kind,
        amount: c.amount,
        claimRevision: c.revision,
        revisionNo: c.revisionNo,
        note: req.note || null,
        actorId: userId,
      });
      await tx
        .update(claims)
        .set({
          status: kind,
          updatedAt: new Date(),
          revision: sql`${claims.revision} + 1`,
        })
        .where(eq(claims.id, c.id));
      await this.recordAudit(tx, `claim.${kind}`, userId, project, c);
      await recordEvent(
        tx,
        'claim.decided',
        { claimId: c.id, projectId, decision: kind, amount: c.amount },
        userId,
      );
    });
    return this.get(userId, projectId, claimId);
  }

  /** Withdraws a claim not yet approved; it stops counting against the milestone. */
  async cancel(
    userId: string,
    projectId: string,
    claimId: string,
    ifMatch: string | undefined,
  ): Promise<ClaimView> {
    const { project } = await this.requireClaimer(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const c = await this.find(tx, projectId, claimId, true);
      if (c.revision !== expected)
        throw new VersionConflictException(c.revision);
      if (!CANCELLABLE.includes(c.status))
        throw new ConflictException(`This claim is ${c.status}`);
      await tx
        .update(claims)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
          revision: sql`${claims.revision} + 1`,
        })
        .where(eq(claims.id, c.id));
      await this.recordAudit(tx, 'claim.cancelled', userId, project, c);
    });
    return this.get(userId, projectId, claimId);
  }

  /* ---------- internals ---------- */

  /** Settled (cash paid) and pending-verification payments on a claim. */
  private async paymentTotals(claimId: string, db: Database | Tx = this.db) {
    const rows = await db
      .select({
        status: payments.status,
        total: sql<string>`sum(${payments.amount})`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.claimId, claimId),
          inArray(payments.status, ['settled', 'pending_verification']),
        ),
      )
      .groupBy(payments.status);
    const of = (s: string) =>
      Number(rows.find((r) => r.status === s)?.total ?? 0);
    return {
      paidAmount: of('settled'),
      pendingPayments: of('pending_verification'),
    };
  }

  /**
   * Sends the claim as it stands as the next revision: evidence required, fixed prices not
   * exceeded. Freezes what the owner is sent; an approval of the revision before is cancelled.
   */
  private async sendRevision(
    tx: Tx,
    project: ProjectRow,
    claimId: string,
    userId: string,
    opts: { changeNote: string | null; cancelledApproval: boolean },
  ) {
    const c = await this.find(tx, project.id, claimId, true);
    await this.lockCeiling(tx, project.id);
    const [a] = await tx
      .select()
      .from(agreements)
      .where(eq(agreements.id, c.agreementId));
    const fixed =
      (a.milestones[c.milestoneIndex]?.basis ?? 'fixed') === 'fixed';
    const claimed = await this.claimedOn(
      tx,
      project.id,
      c.milestoneName,
      true,
      c.id,
    );
    const evidence = (await this.evidenceCounts([c.id], tx)).get(c.id) ?? 0;
    const problems = claimProblems({
      amount: c.amount,
      evidence,
      remaining: fixed ? Math.max(0, c.milestoneAmount - claimed) : null,
    });
    if (problems.includes('evidence'))
      throw new ConflictException({
        message: 'Add evidence first: a site update, a photo or a document',
        fieldErrors: [{ field: 'evidence', message: 'No evidence' }],
      });
    if (problems.includes('overClaim'))
      throw new ConflictException({
        message: 'This is more than is left on the fixed-price milestone',
        fieldErrors: [{ field: 'amount', message: 'Over the agreed price' }],
      });
    const ups = await tx
      .select({ id: claimUpdates.siteUpdateId })
      .from(claimUpdates)
      .where(eq(claimUpdates.claimId, c.id));
    const files = await tx
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.claimId, c.id),
          isNull(media.removedAt),
          inArray(media.scanStatus, ['pending', 'clean']),
        ),
      )
      .orderBy(asc(media.position));
    const revisionNo = c.revisionNo + 1;
    await tx.insert(claimRevisions).values({
      organizationId: project.organizationId,
      projectId: project.id,
      claimId: c.id,
      revisionNo,
      agreementId: c.agreementId,
      milestoneIndex: c.milestoneIndex,
      milestoneName: c.milestoneName,
      milestoneAmount: c.milestoneAmount,
      amount: c.amount,
      note: c.note,
      siteUpdateIds: ups.map((u) => u.id),
      fileIds: files.map((f) => f.id),
      changeNote: opts.changeNote,
      cancelledApproval: opts.cancelledApproval,
      createdBy: userId,
    });
    await tx
      .update(claims)
      .set({
        status: 'submitted',
        revisionNo,
        submittedAt: new Date(),
        submittedBy: userId,
        updatedAt: new Date(),
        revision: sql`${claims.revision} + 1`,
      })
      .where(eq(claims.id, c.id));
    if (opts.cancelledApproval)
      await this.recordAudit(
        tx,
        'claim.approval_cancelled',
        userId,
        project,
        c,
      );
    await this.recordAudit(
      tx,
      revisionNo > 1 ? 'claim.revised' : 'claim.submitted',
      userId,
      project,
      c,
    );
    await recordEvent(
      tx,
      'claim.submitted',
      {
        claimId: c.id,
        projectId: project.id,
        amount: c.amount,
        revisionNo,
        cancelledApproval: opts.cancelledApproval,
      },
      userId,
    );
  }

  private async revisionsOf(claimId: string): Promise<ClaimView['revisions']> {
    const rows = await this.db
      .select({ r: claimRevisions, name: users.displayName })
      .from(claimRevisions)
      .leftJoin(users, eq(users.id, claimRevisions.createdBy))
      .where(eq(claimRevisions.claimId, claimId))
      .orderBy(desc(claimRevisions.revisionNo));
    return rows.map(({ r, name }) => ({
      revisionNo: r.revisionNo,
      amount: r.amount,
      milestoneName: r.milestoneName,
      changeNote: r.changeNote,
      cancelledApproval: r.cancelledApproval,
      byName: name,
      at: r.createdAt.toISOString(),
    }));
  }

  private uploadPrefix(projectId: string) {
    return `tmp/${projectId}/claims/`;
  }

  /** Money is not for everyone on site: the contractor's side, the owner, and members given financial visibility. */
  private async requireReader(userId: string, projectId: string) {
    const access = await this.access.requireProject(userId, projectId);
    const claimer = access.roles.some((r) => CLAIMERS.includes(r));
    if (!claimer && !access.financialVisibility)
      throw new ForbiddenException('You cannot see this project’s money');
    return { ...access, claimer };
  }

  private async requireClaimer(
    userId: string,
    projectId: string,
  ): Promise<ProjectAccess> {
    const access = await this.access.requireProject(userId, projectId);
    if (!access.roles.some((r) => CLAIMERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor or project manager can write payment claims',
      );
    if (access.project.status !== 'active')
      throw new ConflictException('Claims are for active projects');
    return access;
  }

  private async currentAgreement(
    db: Database | Tx,
    projectId: string,
  ): Promise<AgreementRow | undefined> {
    const [a] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.projectId, projectId))
      .orderBy(desc(agreements.version))
      .limit(1);
    return a;
  }

  private milestoneOf(agreement: AgreementRow, index: number): QuoteMilestone {
    const m = agreement.milestones[index] as QuoteMilestone | undefined;
    if (!m)
      throw new BadRequestException({
        message: 'Unknown milestone',
        fieldErrors: [
          { field: 'milestoneIndex', message: 'Not in the current agreement' },
        ],
      });
    return m;
  }

  /** One claim writer per project at a time, so two claims cannot both take the last amount. */
  private lockCeiling(tx: Tx, projectId: string) {
    return tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${'claim-ceiling:' + projectId}))`,
    );
  }

  /**
   * Standing claims on a milestone, matched by name across agreement versions (a new version
   * keeps its milestones' names). Drafts count only for the contractor's side.
   */
  private async claimedOn(
    db: Database | Tx,
    projectId: string,
    name: string,
    withDrafts: boolean,
    exceptId?: string,
  ): Promise<number> {
    const statuses = STANDING_CLAIMS.filter((s) => withDrafts || s !== 'draft');
    const [{ total }] = await db
      .select({ total: sql<string>`coalesce(sum(${claims.amount}), 0)` })
      .from(claims)
      .where(
        and(
          eq(claims.projectId, projectId),
          sql`lower(${claims.milestoneName}) = lower(${name})`,
          inArray(claims.status, [...statuses]),
          exceptId ? ne(claims.id, exceptId) : undefined,
        ),
      );
    return Number(total);
  }

  private async checkCeiling(
    tx: Tx,
    projectId: string,
    m: QuoteMilestone,
    amount: number,
    exceptId?: string,
  ) {
    if ((m.basis ?? 'fixed') !== 'fixed') return;
    const claimed = await this.claimedOn(tx, projectId, m.name, true, exceptId);
    const left = Math.max(0, m.amount - claimed);
    if (amount > left)
      throw new ConflictException({
        message: `Only ${left} is left to claim on “${m.name}”`,
        fieldErrors: [{ field: 'amount', message: 'Over the agreed price' }],
      });
  }

  private async checkUpdates(projectId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await this.db
      .select({ id: siteUpdates.id })
      .from(siteUpdates)
      .where(
        and(eq(siteUpdates.projectId, projectId), inArray(siteUpdates.id, ids)),
      );
    if (found.length !== new Set(ids).size)
      throw new BadRequestException({
        message: 'Unknown site update',
        fieldErrors: [
          { field: 'siteUpdateIds', message: 'Not an update of this project' },
        ],
      });
  }

  private async linkUpdates(
    tx: Tx,
    claimId: string,
    ids: string[],
    userId: string,
  ) {
    const unique = [...new Set(ids)];
    if (unique.length)
      await tx.insert(claimUpdates).values(
        unique.map((siteUpdateId) => ({
          claimId,
          siteUpdateId,
          createdBy: userId,
        })),
      );
  }

  private async addFiles(
    tx: Tx,
    project: ProjectRow,
    claimId: string,
    promoted: Promoted[],
    req: SaveReq,
    from: number,
    userId: string,
  ) {
    if (!promoted.length) return;
    await tx.insert(media).values(
      promoted.map((m, i) => ({
        organizationId: project.organizationId,
        projectId: project.id,
        claimId,
        fileName: req.files[i].fileName || null,
        position: from + i,
        storageKey: m.key,
        contentType: m.contentType,
        sizeBytes: m.sizeBytes,
        createdBy: userId,
      })),
    );
    // Scanned (photos also thumbnailed) by the media pipeline before anyone gets a link.
    await recordEvent(
      tx,
      'claim.files_added',
      { claimId, projectId: project.id },
      userId,
    );
  }

  /** Linked site updates plus files the scan has not blocked. */
  private async evidenceCounts(
    ids: string[],
    db: Database | Tx = this.db,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const ups = await db
      .select({ id: claimUpdates.claimId, n: count() })
      .from(claimUpdates)
      .where(inArray(claimUpdates.claimId, ids))
      .groupBy(claimUpdates.claimId);
    const files = await db
      .select({ id: media.claimId, n: count() })
      .from(media)
      .where(
        and(
          inArray(media.claimId, ids),
          isNull(media.removedAt),
          inArray(media.scanStatus, ['pending', 'clean']),
        ),
      )
      .groupBy(media.claimId);
    for (const r of [...ups, ...files])
      if (r.id) out.set(r.id, (out.get(r.id) ?? 0) + r.n);
    return out;
  }

  private async filesOf(claimId: string): Promise<ClaimFile[]> {
    const rows = await this.db
      .select()
      .from(media)
      .where(and(eq(media.claimId, claimId), isNull(media.removedAt)))
      .orderBy(asc(media.position));
    return this.files.views(rows);
  }

  private async decisionsOf(claimId: string): Promise<ClaimView['decisions']> {
    const rows = await this.db
      .select({ d: claimDecisions, name: users.displayName })
      .from(claimDecisions)
      .leftJoin(users, eq(users.id, claimDecisions.actorId))
      .where(eq(claimDecisions.claimId, claimId))
      .orderBy(desc(claimDecisions.createdAt));
    return rows.map(({ d, name }) => ({
      kind: d.kind,
      revisionNo: d.revisionNo,
      amount: d.amount,
      note: d.note,
      byName: name,
      at: d.createdAt.toISOString(),
    }));
  }

  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const by = alias(users, 'person');
    const [u] = await this.db
      .select({ name: by.displayName })
      .from(by)
      .where(eq(by.id, userId));
    return u?.name ?? null;
  }

  private async find(
    db: Database | Tx,
    projectId: string,
    claimId: string,
    lock = false,
  ): Promise<ClaimRow> {
    const q = db
      .select()
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.projectId, projectId)));
    const [c] = lock ? await q.for('update') : await q;
    if (!c) throw new NotFoundException('Claim not found');
    return c;
  }

  private recordAudit(
    tx: Tx,
    action:
      | 'claim.created'
      | 'claim.submitted'
      | 'claim.cancelled'
      | 'claim.approved'
      | 'claim.rejected'
      | 'claim.changes_requested'
      | 'claim.revised'
      | 'claim.approval_cancelled',
    userId: string,
    project: ProjectRow,
    c: ClaimRow,
  ) {
    return this.audit.record(tx, {
      action,
      actor: { userId },
      organizationId: project.organizationId,
      projectId: project.id,
      target: { type: 'claim', id: c.id },
      metadata: { number: c.number, amount: c.amount },
    });
  }
}
