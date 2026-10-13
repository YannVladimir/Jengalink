import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type BudgetChangeLine,
  type BudgetChangesOverview,
  type BudgetChangeView,
  BudgetChangeDecisionRequest,
  MAX_CHANGE_FILES,
  MAX_CLAIM_FILE_BYTES,
  type ProjectRole,
  RequestClaimUploadRequest,
  reimbursableFloor,
  SaveBudgetChangeRequest,
  type UploadGrantView,
} from '@jengalink/contracts';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
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
  budgetChangeDecisions,
  budgetChanges,
  budgetMovements,
  claims,
  media,
  projects,
  users,
} from '../db/schema';
import type { ChangeLine, QuoteMilestone } from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { AttachmentsService, type Promoted } from '../media/attachments';
import { AccessService } from '../projects/access.service';
import { StorageService } from '../storage/storage.service';

/** Who proposes: the contractor's side. Who approves: the client side, never a proposer. */
const PROPOSERS: readonly ProjectRole[] = ['contractor', 'manager'];
const DECIDERS: readonly ProjectRole[] = ['owner', 'delegate'];
const EDITABLE = ['draft', 'submitted'] as const;
const savePipe = new ZodPipe(SaveBudgetChangeRequest);
const decisionPipe = new ZodPipe(BudgetChangeDecisionRequest);
const uploadPipe = new ZodPipe(RequestClaimUploadRequest);
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

type ChangeRow = typeof budgetChanges.$inferSelect;
type AgreementRow = typeof agreements.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SaveReq = ReturnType<typeof savePipe.transform>;
const feeOf = (m: { feeBasisPoints?: number | null }) =>
  m.feeBasisPoints != null ? m.feeBasisPoints / 100 : null;

/**
 * Budget changes (spec §2 A0, §6.1, §7). Deltas to named packages, with a reason; the owner's
 * approval applies the change as the next agreement version in one transaction (never twice,
 * never in place). A reduction cannot go below what is already claimed (fixed price) or spent
 * and reserved (cost + fee).
 */
@Injectable()
export class ChangesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly files: AttachmentsService,
  ) {}

  async requestUpload(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<UploadGrantView> {
    await this.requireProposer(userId, projectId);
    const req = uploadPipe.transform(body);
    return this.storage.createUploadGrant(
      req.contentType,
      MAX_CLAIM_FILE_BYTES,
      this.prefix(projectId),
    );
  }

  /** The budget's history per package (original, approved changes, current) and every change. */
  async overview(
    userId: string,
    projectId: string,
  ): Promise<BudgetChangesOverview> {
    const { project, proposer } = await this.requireReader(userId, projectId);
    const versions = await this.db
      .select()
      .from(agreements)
      .where(eq(agreements.projectId, projectId))
      .orderBy(asc(agreements.version));
    const current = versions.at(-1);
    // The baseline is the latest version that came from a quote; changes after it are "approved changes".
    const baseline = [...versions].reverse().find((v) => !v.changeId);
    const lines = (current?.milestones ?? []).map((m, index) => {
      const original =
        baseline?.milestones.find(
          (b) => b.name.toLowerCase() === m.name.toLowerCase(),
        )?.amount ?? 0;
      return {
        index,
        name: m.name,
        basis: m.basis ?? ('fixed' as const),
        original,
        changes: m.amount - original,
        current: m.amount,
      };
    });
    const rows = await this.db
      .select({ c: budgetChanges, applied: agreements.version })
      .from(budgetChanges)
      .leftJoin(agreements, eq(agreements.id, budgetChanges.appliedAgreementId))
      .where(eq(budgetChanges.projectId, projectId))
      .orderBy(desc(budgetChanges.updatedAt));
    return {
      agreementVersion: current?.version ?? null,
      currency: current?.currency ?? 'RWF',
      lines,
      original: lines.reduce((t, l) => t + l.original, 0),
      additions: lines.reduce((t, l) => t + Math.max(0, l.changes), 0),
      reductions: lines.reduce((t, l) => t + Math.min(0, l.changes), 0),
      current: lines.reduce((t, l) => t + l.current, 0),
      changes: rows
        .filter(({ c }) => proposer || c.status !== 'draft')
        .map(({ c, applied }) => ({
          id: c.id,
          number: c.number,
          status: c.status,
          category: c.category,
          netDelta: c.netDelta,
          appliedVersion: applied,
          updatedAt: c.updatedAt.toISOString(),
        })),
      canPropose: proposer && !!current && project.status === 'active',
    };
  }

  async create(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<BudgetChangeView> {
    const { project } = await this.requireProposer(userId, projectId);
    const req = savePipe.transform(body);
    const base = await this.currentAgreement(this.db, projectId);
    if (!base)
      throw new ConflictException('There is no agreement yet to change');
    const lines = this.linesOf(base, req);
    const promoted = await this.files.promote(
      project,
      req.files,
      this.prefix(projectId),
    );
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${'changes:' + project.organizationId}))`,
        );
        const year = todayIn(project.timezone).slice(0, 4);
        const [{ n }] = await tx
          .select({ n: count() })
          .from(budgetChanges)
          .where(
            and(
              eq(budgetChanges.organizationId, project.organizationId),
              sql`${budgetChanges.number} like ${`CH-${year}-%`}`,
            ),
          );
        const [c] = await tx
          .insert(budgetChanges)
          .values({
            organizationId: project.organizationId,
            projectId,
            number: `CH-${year}-${String(n + 1).padStart(4, '0')}`,
            baseAgreementId: base.id,
            category: req.category,
            reason: req.reason,
            scheduleDays: req.scheduleDays ?? null,
            lines,
            netDelta: lines.reduce((t, l) => t + l.delta, 0),
            createdBy: userId,
          })
          .returning();
        await this.addFiles(tx, project, c.id, promoted, req, 0, userId);
        await this.recordAudit(tx, 'change.created', userId, project, c);
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
    changeId: string,
  ): Promise<BudgetChangeView> {
    const { proposer, roles } = await this.requireReader(userId, projectId);
    const c = await this.find(this.db, projectId, changeId);
    if (c.status === 'draft' && !proposer)
      throw new NotFoundException('Change not found');
    const [base] = await this.db
      .select()
      .from(agreements)
      .where(eq(agreements.id, c.baseAgreementId));
    const current = await this.currentAgreement(this.db, projectId);
    const [applied] = c.appliedAgreementId
      ? await this.db
          .select({ version: agreements.version })
          .from(agreements)
          .where(eq(agreements.id, c.appliedAgreementId))
      : [];
    const floors = await this.floorsOf(this.db, projectId, c.lines);
    const lines: BudgetChangeLine[] = c.lines.map((l, i) => {
      const before =
        l.milestoneIndex != null
          ? (base.milestones[l.milestoneIndex]?.amount ?? 0)
          : 0;
      return {
        milestoneIndex: l.milestoneIndex,
        name: l.name,
        basis: l.basis,
        feePercent: l.feeBasisPoints != null ? l.feeBasisPoints / 100 : null,
        before,
        delta: l.delta,
        after: before + l.delta,
        floor: floors[i],
      };
    });
    const fileRows = await this.db
      .select()
      .from(media)
      .where(eq(media.budgetChangeId, c.id))
      .orderBy(asc(media.position));
    const open = (EDITABLE as readonly string[]).includes(c.status);
    const decider = roles.some((r) => DECIDERS.includes(r)) && !proposer;
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      category: c.category,
      reason: c.reason,
      scheduleDays: c.scheduleDays,
      baseVersion: base.version,
      stale: open && current?.id !== base.id,
      lines,
      netDelta: c.netDelta,
      contractBefore: base.contractValue,
      contractAfter: base.contractValue + c.netDelta,
      currency: base.currency,
      files: await this.files.views(fileRows),
      decisions: await this.decisionsOf(c.id),
      createdByName: await this.nameOf(c.createdBy),
      submittedAt: c.submittedAt?.toISOString() ?? null,
      appliedVersion: applied?.version ?? null,
      canEdit: proposer && open,
      canDecide: decider && c.status === 'submitted',
      canWithdraw: proposer && open,
      version: c.revision,
    };
  }

  /** Saves a change not yet answered; it follows the current agreement. If-Match = version. */
  async save(
    userId: string,
    projectId: string,
    changeId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<BudgetChangeView> {
    const { project } = await this.requireProposer(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = savePipe.transform(body);
    const base = await this.currentAgreement(this.db, projectId);
    if (!base) throw new ConflictException('There is no agreement to change');
    const lines = this.linesOf(base, req);
    const promoted = await this.files.promote(
      project,
      req.files,
      this.prefix(projectId),
    );
    let removed: string[];
    try {
      removed = await this.db.transaction(async (tx) => {
        const c = await this.find(tx, projectId, changeId, true);
        if (c.revision !== expected)
          throw new VersionConflictException(c.revision);
        if (!(EDITABLE as readonly string[]).includes(c.status))
          throw new ConflictException(`This change is ${c.status}`);
        await tx
          .update(budgetChanges)
          .set({
            baseAgreementId: base.id,
            category: req.category,
            reason: req.reason,
            scheduleDays: req.scheduleDays ?? null,
            lines,
            netDelta: lines.reduce((t, l) => t + l.delta, 0),
            updatedAt: new Date(),
            revision: sql`${budgetChanges.revision} + 1`,
          })
          .where(eq(budgetChanges.id, c.id));
        const gone = req.removeFileIds.length
          ? await tx
              .delete(media)
              .where(
                and(
                  eq(media.budgetChangeId, c.id),
                  inArray(media.id, req.removeFileIds),
                ),
              )
              .returning({ key: media.storageKey, thumb: media.thumbKey })
          : [];
        const [{ kept, last }] = await tx
          .select({
            kept: count(),
            last: sql<number>`coalesce(max(${media.position}), -1)::int`,
          })
          .from(media)
          .where(eq(media.budgetChangeId, c.id));
        if (kept + promoted.length > MAX_CHANGE_FILES)
          throw new BadRequestException({
            message: `A change takes at most ${MAX_CHANGE_FILES} files`,
            fieldErrors: [{ field: 'files', message: 'Too many files' }],
          });
        await this.addFiles(tx, project, c.id, promoted, req, last + 1, userId);
        return gone.flatMap((g) => (g.thumb ? [g.key, g.thumb] : [g.key]));
      });
    } catch (err) {
      await this.files.dropKeys(promoted.map((p) => p.key));
      throw err;
    }
    await this.files.dropKeys(removed);
    return this.get(userId, projectId, changeId);
  }

  /** Sends the change to the owner: it must still be based on the current agreement and respect the floors. */
  async submit(
    userId: string,
    projectId: string,
    changeId: string,
    ifMatch: string | undefined,
  ): Promise<BudgetChangeView> {
    const { project } = await this.requireProposer(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const c = await this.find(tx, projectId, changeId, true);
      if (c.revision !== expected)
        throw new VersionConflictException(c.revision);
      if (c.status !== 'draft')
        throw new ConflictException(`This change is ${c.status}`);
      await this.checkApplicable(tx, projectId, c);
      await tx
        .update(budgetChanges)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          submittedBy: userId,
          updatedAt: new Date(),
          revision: sql`${budgetChanges.revision} + 1`,
        })
        .where(eq(budgetChanges.id, c.id));
      await this.recordAudit(tx, 'change.submitted', userId, project, c);
      await recordEvent(
        tx,
        'change.submitted',
        { changeId: c.id, projectId, netDelta: c.netDelta },
        userId,
      );
    });
    return this.get(userId, projectId, changeId);
  }

  /**
   * The owner answers the exact net change on screen. Approval applies it in the same
   * transaction: the next agreement version, the new contract value, the decision record.
   */
  async decide(
    userId: string,
    projectId: string,
    changeId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<BudgetChangeView> {
    const { project, roles, proposer } = await this.requireReader(
      userId,
      projectId,
    );
    if (!roles.some((r) => DECIDERS.includes(r)) || proposer)
      throw new ForbiddenException(
        'Only the owner (or their delegate) can answer a budget change',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = decisionPipe.transform(body);
    await this.db.transaction(async (tx) => {
      const c = await this.find(tx, projectId, changeId, true);
      if (c.status === 'draft') throw new NotFoundException('Change not found');
      if (c.revision !== expected)
        throw new VersionConflictException(c.revision);
      if (c.status !== 'submitted')
        throw new ConflictException(`This change is ${c.status}`);
      if (req.netDelta !== c.netDelta)
        throw new ConflictException({
          message: 'The change was edited since you opened it',
          fieldErrors: [{ field: 'netDelta', message: 'Does not match' }],
        });
      const approved = req.decision === 'approve';
      let appliedId: string | null = null;
      if (approved) {
        const base = await this.checkApplicable(tx, projectId, c);
        const milestones: QuoteMilestone[] = base.milestones.map((m) => ({
          ...m,
        }));
        for (const l of c.lines) {
          if (l.milestoneIndex != null)
            milestones[l.milestoneIndex] = {
              ...milestones[l.milestoneIndex],
              amount: milestones[l.milestoneIndex].amount + l.delta,
            };
          else
            milestones.push({
              name: l.name,
              description: null,
              amount: l.delta,
              stageId: null,
              basis: l.basis,
              feeBasisPoints: l.feeBasisPoints,
            });
        }
        const contractValue = milestones.reduce((t, m) => t + m.amount, 0);
        // The unique (project, version) index makes a second application impossible.
        const [a] = await tx
          .insert(agreements)
          .values({
            organizationId: project.organizationId,
            projectId,
            version: base.version + 1,
            quoteId: base.quoteId,
            quoteNumber: base.quoteNumber,
            quoteRevisionNo: base.quoteRevisionNo,
            title: base.title,
            scope: base.scope,
            exclusions: base.exclusions,
            milestones,
            terms: base.terms,
            currency: base.currency,
            contractValue,
            acceptedBy: userId,
            changeId: c.id,
          })
          .returning({ id: agreements.id });
        appliedId = a.id;
        await tx
          .update(projects)
          .set({
            contractValue,
            updatedAt: new Date(),
            revision: sql`${projects.revision} + 1`,
          })
          .where(eq(projects.id, projectId));
      }
      await tx.insert(budgetChangeDecisions).values({
        organizationId: project.organizationId,
        projectId,
        changeId: c.id,
        kind: approved ? 'approved' : 'rejected',
        netDelta: c.netDelta,
        changeRevision: c.revision,
        note: req.note || null,
        actorId: userId,
      });
      await tx
        .update(budgetChanges)
        .set({
          status: approved ? 'applied' : 'rejected',
          appliedAgreementId: appliedId,
          updatedAt: new Date(),
          revision: sql`${budgetChanges.revision} + 1`,
        })
        .where(eq(budgetChanges.id, c.id));
      await this.recordAudit(
        tx,
        approved ? 'change.applied' : 'change.rejected',
        userId,
        project,
        c,
      );
      await recordEvent(
        tx,
        'change.decided',
        {
          changeId: c.id,
          projectId,
          decision: approved ? 'applied' : 'rejected',
          netDelta: c.netDelta,
        },
        userId,
      );
    });
    return this.get(userId, projectId, changeId);
  }

  async withdraw(
    userId: string,
    projectId: string,
    changeId: string,
    ifMatch: string | undefined,
  ): Promise<BudgetChangeView> {
    const { project } = await this.requireProposer(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const c = await this.find(tx, projectId, changeId, true);
      if (c.revision !== expected)
        throw new VersionConflictException(c.revision);
      if (!(EDITABLE as readonly string[]).includes(c.status))
        throw new ConflictException(`This change is ${c.status}`);
      await tx
        .update(budgetChanges)
        .set({
          status: 'withdrawn',
          updatedAt: new Date(),
          revision: sql`${budgetChanges.revision} + 1`,
        })
        .where(eq(budgetChanges.id, c.id));
      await this.recordAudit(tx, 'change.withdrawn', userId, project, c);
    });
    return this.get(userId, projectId, changeId);
  }

  /* ---------- internals ---------- */

  private prefix(projectId: string) {
    return `tmp/${projectId}/changes/`;
  }

  private async requireReader(userId: string, projectId: string) {
    const access = await this.access.requireProject(userId, projectId);
    const proposer = access.roles.some((r) => PROPOSERS.includes(r));
    if (
      !proposer &&
      !access.financialVisibility &&
      !access.roles.includes('finance')
    )
      throw new ForbiddenException('You cannot see this project’s money');
    return { ...access, proposer };
  }

  private async requireProposer(userId: string, projectId: string) {
    const access = await this.access.requireProject(userId, projectId);
    if (!access.roles.some((r) => PROPOSERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor or project manager can propose budget changes',
      );
    if (access.project.status !== 'active')
      throw new ConflictException('Budget changes are for active projects');
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

  /** Resolves lines against the agreement: existing packages by position, new ones described. */
  private linesOf(base: AgreementRow, req: SaveReq): ChangeLine[] {
    return req.lines.map((l, i) => {
      if (l.milestoneIndex != null) {
        const m = base.milestones[l.milestoneIndex];
        if (!m)
          throw new BadRequestException({
            message: 'Unknown package',
            fieldErrors: [
              {
                field: `lines.${i}.milestoneIndex`,
                message: 'Not in the current agreement',
              },
            ],
          });
        if (m.amount + l.delta < 0)
          throw new BadRequestException({
            message: `“${m.name}” cannot go below zero`,
            fieldErrors: [{ field: `lines.${i}.delta`, message: 'Below zero' }],
          });
        return {
          milestoneIndex: l.milestoneIndex,
          name: m.name,
          basis: m.basis ?? 'fixed',
          feeBasisPoints: m.feeBasisPoints ?? null,
          delta: l.delta,
        };
      }
      const p = l.newPackage!;
      if (
        base.milestones.some(
          (m) => m.name.toLowerCase() === p.name.toLowerCase(),
        )
      )
        throw new BadRequestException({
          message: `“${p.name}” is already a package`,
          fieldErrors: [
            { field: `lines.${i}.newPackage.name`, message: 'Already exists' },
          ],
        });
      return {
        milestoneIndex: null,
        name: p.name,
        basis: p.basis,
        feeBasisPoints:
          p.basis === 'reimbursable' && p.feePercent != null
            ? Math.round(p.feePercent * 100)
            : null,
        delta: l.delta,
      };
    });
  }

  /** What each line may not go below: claimed (fixed price) or spent and reserved (cost + fee). */
  private async floorsOf(
    db: Database | Tx,
    projectId: string,
    lines: ChangeLine[],
  ): Promise<number[]> {
    const out: number[] = [];
    for (const l of lines) {
      if (l.milestoneIndex == null) {
        out.push(0);
        continue;
      }
      const key = l.name.toLowerCase();
      if (l.basis === 'fixed') {
        const [{ total }] = await db
          .select({ total: sql<string>`coalesce(sum(${claims.amount}), 0)` })
          .from(claims)
          .where(
            and(
              eq(claims.projectId, projectId),
              sql`lower(${claims.milestoneName}) = ${key}`,
              inArray(claims.status, [
                'submitted',
                'approved',
                'paid',
                'changes_requested',
              ]),
            ),
          );
        out.push(Number(total));
      } else {
        const sums = await db
          .select({
            kind: budgetMovements.kind,
            total: sql<string>`coalesce(sum(${budgetMovements.amount}), 0)`,
          })
          .from(budgetMovements)
          .where(
            and(
              eq(budgetMovements.projectId, projectId),
              eq(budgetMovements.budgetLine, key),
            ),
          )
          .groupBy(budgetMovements.kind);
        const of = (k: string) =>
          Number(sums.find((s) => s.kind === k)?.total ?? 0);
        // Spent plus still reserved = everything reserved minus what was released.
        out.push(reimbursableFloor(of('reserve') - of('release'), feeOf(l)));
      }
    }
    return out;
  }

  /** Based on the current agreement, and no package below its floor. Locks the project's changes. */
  private async checkApplicable(
    tx: Tx,
    projectId: string,
    c: ChangeRow,
  ): Promise<AgreementRow> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${'agreements:' + projectId}))`,
    );
    const current = await this.currentAgreement(tx, projectId);
    if (!current || current.id !== c.baseAgreementId)
      throw new ConflictException({
        message:
          'The agreement changed since this was written: open it, check the packages and save it again',
        fieldErrors: [{ field: 'baseVersion', message: 'Out of date' }],
      });
    const floors = await this.floorsOf(tx, projectId, c.lines);
    c.lines.forEach((l, i) => {
      if (l.milestoneIndex == null) return;
      const after = current.milestones[l.milestoneIndex].amount + l.delta;
      if (after < floors[i])
        throw new ConflictException({
          message: `“${l.name}” cannot go below ${floors[i]}: that much is already claimed, spent or reserved`,
          fieldErrors: [
            { field: `lines.${i}.delta`, message: 'Below what is used' },
          ],
        });
    });
    return current;
  }

  private async addFiles(
    tx: Tx,
    project: ProjectRow,
    changeId: string,
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
        budgetChangeId: changeId,
        fileName: req.files[i].fileName || null,
        position: from + i,
        storageKey: m.key,
        contentType: m.contentType,
        sizeBytes: m.sizeBytes,
        createdBy: userId,
      })),
    );
    await recordEvent(
      tx,
      'change.files_added',
      { changeId, projectId: project.id },
      userId,
    );
  }

  private async decisionsOf(
    changeId: string,
  ): Promise<BudgetChangeView['decisions']> {
    const rows = await this.db
      .select({ d: budgetChangeDecisions, name: users.displayName })
      .from(budgetChangeDecisions)
      .leftJoin(users, eq(users.id, budgetChangeDecisions.actorId))
      .where(eq(budgetChangeDecisions.changeId, changeId))
      .orderBy(desc(budgetChangeDecisions.createdAt));
    return rows.map(({ d, name }) => ({
      kind: d.kind,
      netDelta: d.netDelta,
      note: d.note,
      byName: name,
      at: d.createdAt.toISOString(),
    }));
  }

  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [u] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    return u?.name ?? null;
  }

  private async find(
    db: Database | Tx,
    projectId: string,
    changeId: string,
    lock = false,
  ): Promise<ChangeRow> {
    const q = db
      .select()
      .from(budgetChanges)
      .where(
        and(
          eq(budgetChanges.id, changeId),
          eq(budgetChanges.projectId, projectId),
        ),
      );
    const [c] = lock ? await q.for('update') : await q;
    if (!c) throw new NotFoundException('Change not found');
    return c;
  }

  private recordAudit(
    tx: Tx,
    action:
      | 'change.created'
      | 'change.submitted'
      | 'change.applied'
      | 'change.rejected'
      | 'change.withdrawn',
    userId: string,
    project: ProjectRow,
    c: ChangeRow,
  ) {
    return this.audit.record(tx, {
      action,
      actor: { userId },
      organizationId: project.organizationId,
      projectId: project.id,
      target: { type: 'budget_change', id: c.id },
      metadata: { number: c.number, netDelta: c.netDelta },
    });
  }
}
