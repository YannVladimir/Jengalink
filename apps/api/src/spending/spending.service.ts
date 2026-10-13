import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  costBudgetOf,
  type BudgetLine,
  type ExpenseView,
  lineAmount,
  MAX_CLAIM_FILE_BYTES,
  MAX_SPENDING_FILES,
  PostExpenseRequest,
  type ProjectBudget,
  type ProjectRole,
  RequestClaimUploadRequest,
  SaveSpendingRequest,
  SpendingDecisionRequest,
  type SpendingStatus,
  type SpendingSummary,
  type SpendingView,
  type UploadGrantView,
} from '@jengalink/contracts';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
  budgetMovements,
  expenses,
  media,
  projects,
  spendingDecisions,
  spendingRequests,
  stages,
  users,
} from '../db/schema';
import type { QuoteMilestone } from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { AttachmentsService, type Promoted } from '../media/attachments';
import { AccessService } from '../projects/access.service';
import { StorageService } from '../storage/storage.service';
import { CAPTURERS, ReceiptsService } from './receipts.service';

/** Who asks to spend: the contractor's side. */
const REQUESTERS: readonly ProjectRole[] = ['contractor', 'manager'];
/** Who authorizes spending for the client (spec §6.3 default: one owner approval). */
const DECIDERS: readonly ProjectRole[] = ['owner', 'delegate'];
/** Who records direct expenses against an approved request. */
const POSTERS: readonly ProjectRole[] = ['contractor', 'manager', 'finance'];
const EDITABLE: readonly SpendingStatus[] = [
  'draft',
  'submitted',
  'changes_requested',
];
const savePipe = new ZodPipe(SaveSpendingRequest);
const uploadPipe = new ZodPipe(RequestClaimUploadRequest);
const decisionPipe = new ZodPipe(SpendingDecisionRequest);
const expensePipe = new ZodPipe(PostExpenseRequest);
const decisionKind = {
  approve: 'approved',
  reject: 'rejected',
  request_changes: 'changes_requested',
} as const;
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

type RequestRow = typeof spendingRequests.$inferSelect;
type AgreementRow = typeof agreements.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SaveReq = ReturnType<typeof savePipe.transform>;
/** Ledger totals: remaining commitment = reserve − convert − release; posted = convert. */
type Ledger = { reserved: number; posted: number; released: number };
const committedOf = (l: Ledger) => l.reserved - l.posted - l.released;

/**
 * Spending requests on cost + fee packages (spec §6.2–6.5, A0). Approval reserves budget, a
 * posted direct expense turns part of the reservation into cost, closing releases the rest.
 * Every movement is an append-only ledger row; balances are always computed from it.
 * No money moves through JengaLink.
 */
@Injectable()
export class SpendingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly files: AttachmentsService,
    private readonly receipts: ReceiptsService,
  ) {}

  async requestUpload(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<UploadGrantView> {
    await this.requireRequester(userId, projectId);
    const req = uploadPipe.transform(body);
    return this.storage.createUploadGrant(
      req.contentType,
      MAX_CLAIM_FILE_BYTES,
      this.uploadPrefix(projectId),
    );
  }

  /** The cost + fee lines of the current agreement with pending, committed, posted and headroom. */
  async budget(userId: string, projectId: string): Promise<ProjectBudget> {
    await this.requireReader(userId, projectId);
    const agreement = await this.currentAgreement(this.db, projectId);
    if (!agreement)
      return { agreementVersion: null, currency: 'RWF', lines: [] };
    const lines: BudgetLine[] = [];
    for (const [index, m] of agreement.milestones.entries())
      if (m.basis === 'reimbursable')
        lines.push(await this.lineOf(this.db, projectId, index, m));
    return {
      agreementVersion: agreement.version,
      currency: agreement.currency,
      lines,
    };
  }

  async list(userId: string, projectId: string): Promise<SpendingSummary[]> {
    const { requester } = await this.requireReader(userId, projectId);
    const rows = await this.db
      .select()
      .from(spendingRequests)
      .where(eq(spendingRequests.projectId, projectId))
      .orderBy(desc(spendingRequests.updatedAt));
    const visible = rows.filter((r) => requester || r.status !== 'draft');
    const ledgers = await this.ledgersOf(
      this.db,
      visible.map((r) => r.id),
    );
    return visible.map((r) => {
      const l = ledgers.get(r.id) ?? { reserved: 0, posted: 0, released: 0 };
      return {
        id: r.id,
        number: r.number,
        status: r.status,
        milestoneName: r.milestoneName,
        purpose: r.purpose,
        amount: r.amount,
        committed: committedOf(l),
        posted: l.posted,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async create(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<SpendingView> {
    const { project } = await this.requireRequester(userId, projectId);
    const req = savePipe.transform(body);
    const agreement = await this.currentAgreement(this.db, projectId);
    if (!agreement)
      throw new ConflictException(
        'There is no agreement yet: the owner must accept a quote first',
      );
    const m = this.packageOf(agreement, req.milestoneIndex);
    await this.checkStage(projectId, req.stageId);
    const promoted = await this.files.promote(
      project,
      req.files,
      this.uploadPrefix(projectId),
    );
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const number = await this.nextNumber(tx, project, 'SR', 'requests');
        const [r] = await tx
          .insert(spendingRequests)
          .values({
            organizationId: project.organizationId,
            projectId,
            number,
            agreementId: agreement.id,
            milestoneIndex: req.milestoneIndex,
            milestoneName: m.name,
            stageId: req.stageId ?? null,
            purpose: req.purpose,
            requiredDate: req.requiredDate ?? null,
            ...this.priced(req),
            createdBy: userId,
          })
          .returning();
        await this.addFiles(tx, project, r.id, promoted, req, 0, userId);
        await this.recordAudit(tx, 'spending.created', userId, project, r);
        return r.id;
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
    requestId: string,
  ): Promise<SpendingView> {
    const { project, requester, roles } = await this.requireReader(
      userId,
      projectId,
    );
    const r = await this.find(this.db, projectId, requestId);
    if (r.status === 'draft' && !requester)
      throw new NotFoundException('Spending request not found');
    const [a] = await this.db
      .select()
      .from(agreements)
      .where(eq(agreements.id, r.agreementId));
    const [stage] = r.stageId
      ? await this.db
          .select({ name: stages.name })
          .from(stages)
          .where(eq(stages.id, r.stageId))
      : [];
    const l = (await this.ledgersOf(this.db, [r.id])).get(r.id) ?? {
      reserved: 0,
      posted: 0,
      released: 0,
    };
    const fileRows = await this.db
      .select()
      .from(media)
      .where(and(eq(media.spendingRequestId, r.id), isNull(media.removedAt)))
      .orderBy(asc(media.position));
    const decider = roles.some((x) => DECIDERS.includes(x)) && !requester;
    return {
      id: r.id,
      projectId,
      projectName: project.name,
      number: r.number,
      status: r.status,
      milestoneIndex: r.milestoneIndex,
      milestoneName: r.milestoneName,
      agreementVersion: a.version,
      stageId: r.stageId,
      stageName: stage?.name ?? null,
      purpose: r.purpose,
      requiredDate: r.requiredDate,
      lines: r.lines,
      amount: r.amount,
      currency: a.currency,
      files: await this.files.views(fileRows),
      ...l,
      committed: committedOf(l),
      ...(await this.expensesOf(r.id, userId, roles)),
      decisions: await this.decisionsOf(r.id),
      createdByName: await this.nameOf(r.createdBy),
      submittedAt: r.submittedAt?.toISOString() ?? null,
      canEdit: requester && EDITABLE.includes(r.status),
      canDecide: decider && r.status === 'submitted',
      canPostExpense:
        r.status === 'approved' &&
        committedOf(l) > 0 &&
        roles.some((x) => POSTERS.includes(x)),
      canWithdraw: requester && EDITABLE.includes(r.status),
      canClose:
        r.status === 'approved' &&
        roles.some((x) => [...REQUESTERS, ...DECIDERS].includes(x)),
      version: r.revision,
    };
  }

  /** Saves a request not yet approved. If-Match = the request's version. */
  async save(
    userId: string,
    projectId: string,
    requestId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<SpendingView> {
    const { project } = await this.requireRequester(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = savePipe.transform(body);
    await this.checkStage(projectId, req.stageId);
    const promoted = await this.files.promote(
      project,
      req.files,
      this.uploadPrefix(projectId),
    );
    let removed: string[];
    try {
      removed = await this.db.transaction(async (tx) => {
        const r = await this.find(tx, projectId, requestId, true);
        if (r.revision !== expected)
          throw new VersionConflictException(r.revision);
        if (!EDITABLE.includes(r.status))
          throw new ConflictException(`This request is ${r.status}`);
        const agreement = await this.currentAgreement(tx, projectId);
        if (!agreement) throw new ConflictException('There is no agreement');
        const m = this.packageOf(agreement, req.milestoneIndex);
        await tx
          .update(spendingRequests)
          .set({
            agreementId: agreement.id,
            milestoneIndex: req.milestoneIndex,
            milestoneName: m.name,
            stageId: req.stageId ?? null,
            purpose: req.purpose,
            requiredDate: req.requiredDate ?? null,
            ...this.priced(req),
            updatedAt: new Date(),
            revision: sql`${spendingRequests.revision} + 1`,
          })
          .where(eq(spendingRequests.id, r.id));
        const gone = req.removeFileIds.length
          ? await tx
              .delete(media)
              .where(
                and(
                  eq(media.spendingRequestId, r.id),
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
          .where(eq(media.spendingRequestId, r.id));
        if (kept + promoted.length > MAX_SPENDING_FILES)
          throw new BadRequestException({
            message: `A request takes at most ${MAX_SPENDING_FILES} files`,
            fieldErrors: [{ field: 'files', message: 'Too many files' }],
          });
        await this.addFiles(tx, project, r.id, promoted, req, last + 1, userId);
        return gone.flatMap((g) => (g.thumb ? [g.key, g.thumb] : [g.key]));
      });
    } catch (err) {
      await this.files.dropKeys(promoted.map((p) => p.key));
      throw err;
    }
    await this.files.dropKeys(removed);
    return this.get(userId, projectId, requestId);
  }

  /** Sends the request to the owner; it must fit the package's headroom (spec §6.3). */
  async submit(
    userId: string,
    projectId: string,
    requestId: string,
    ifMatch: string | undefined,
  ): Promise<SpendingView> {
    const { project } = await this.requireRequester(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const r = await this.find(tx, projectId, requestId, true);
      if (r.revision !== expected)
        throw new VersionConflictException(r.revision);
      if (r.status !== 'draft' && r.status !== 'changes_requested')
        throw new ConflictException(`This request is ${r.status}`);
      await this.checkHeadroom(tx, r);
      await tx
        .update(spendingRequests)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          submittedBy: userId,
          updatedAt: new Date(),
          revision: sql`${spendingRequests.revision} + 1`,
        })
        .where(eq(spendingRequests.id, r.id));
      await this.recordAudit(tx, 'spending.submitted', userId, project, r);
      await recordEvent(
        tx,
        'spending.submitted',
        { requestId: r.id, projectId, amount: r.amount },
        userId,
      );
    });
    return this.get(userId, projectId, requestId);
  }

  /**
   * The owner answers the exact version and total they read. Approval locks the budget line,
   * rechecks the headroom in the same transaction and reserves the amount (spec §6.3, §19.3).
   */
  async decide(
    userId: string,
    projectId: string,
    requestId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<SpendingView> {
    const { project, roles, requester } = await this.requireReader(
      userId,
      projectId,
    );
    if (!roles.some((r) => DECIDERS.includes(r)) || requester)
      throw new ForbiddenException(
        'Only the owner (or their delegate) can answer a spending request',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = decisionPipe.transform(body);
    await this.db.transaction(async (tx) => {
      const r = await this.find(tx, projectId, requestId, true);
      if (r.status === 'draft')
        throw new NotFoundException('Spending request not found');
      if (r.revision !== expected)
        throw new VersionConflictException(r.revision);
      if (r.status !== 'submitted')
        throw new ConflictException(`This request is ${r.status}`);
      if (req.amount !== r.amount)
        throw new ConflictException({
          message: 'The total changed since you opened this request',
          fieldErrors: [{ field: 'amount', message: 'Does not match' }],
        });
      const kind = decisionKind[req.decision];
      if (kind === 'approved') {
        await this.checkHeadroom(tx, r);
        await tx.insert(budgetMovements).values({
          organizationId: project.organizationId,
          projectId,
          requestId: r.id,
          budgetLine: r.milestoneName.toLowerCase(),
          kind: 'reserve',
          amount: r.amount,
          createdBy: userId,
        });
      }
      await tx.insert(spendingDecisions).values({
        organizationId: project.organizationId,
        projectId,
        requestId: r.id,
        kind,
        amount: r.amount,
        requestRevision: r.revision,
        note: req.note || null,
        actorId: userId,
      });
      await tx
        .update(spendingRequests)
        .set({
          status: kind,
          updatedAt: new Date(),
          revision: sql`${spendingRequests.revision} + 1`,
        })
        .where(eq(spendingRequests.id, r.id));
      await this.recordAudit(tx, `spending.${kind}`, userId, project, r);
      await recordEvent(
        tx,
        'spending.decided',
        { requestId: r.id, projectId, decision: kind, amount: r.amount },
        userId,
      );
    });
    return this.get(userId, projectId, requestId);
  }

  /**
   * A direct expense against an approved request: posts cost and converts that much of the
   * reservation. It cannot exceed what is still reserved (over-spending needs a new request).
   */
  async postExpense(
    userId: string,
    projectId: string,
    requestId: string,
    body: unknown,
  ): Promise<SpendingView> {
    const { project, roles } = await this.requireReader(userId, projectId);
    if (!roles.some((r) => POSTERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor, project manager or finance can record expenses',
      );
    const req = expensePipe.transform(body);
    if (req.expenseDate > todayIn(project.timezone))
      throw new BadRequestException({
        message: 'The expense date cannot be in the future',
        fieldErrors: [{ field: 'expenseDate', message: 'In the future' }],
      });
    await this.db.transaction(async (tx) => {
      const r = await this.find(tx, projectId, requestId, true);
      if (r.status === 'draft')
        throw new NotFoundException('Spending request not found');
      if (r.status !== 'approved')
        throw new ConflictException(
          'Expenses are recorded against an approved request',
        );
      await this.lockLine(tx, projectId, r.milestoneName);
      const l = (await this.ledgersOf(tx, [r.id])).get(r.id)!;
      const left = committedOf(l);
      if (req.amount > left)
        throw new ConflictException({
          message: `Only ${left} is still reserved on this request. Spending more needs a new request.`,
          fieldErrors: [{ field: 'amount', message: 'More than reserved' }],
        });
      const number = await this.nextNumber(tx, project, 'E', 'expenses');
      const [e] = await tx
        .insert(expenses)
        .values({
          organizationId: project.organizationId,
          projectId,
          number,
          requestId: r.id,
          description: req.description,
          supplierName: req.supplierName || null,
          expenseDate: req.expenseDate,
          amount: req.amount,
          createdBy: userId,
        })
        .returning({ id: expenses.id });
      await tx.insert(budgetMovements).values({
        organizationId: project.organizationId,
        projectId,
        requestId: r.id,
        expenseId: e.id,
        budgetLine: r.milestoneName.toLowerCase(),
        kind: 'convert',
        amount: req.amount,
        createdBy: userId,
      });
      await tx
        .update(spendingRequests)
        .set({
          updatedAt: new Date(),
          revision: sql`${spendingRequests.revision} + 1`,
        })
        .where(eq(spendingRequests.id, r.id));
      await this.audit.record(tx, {
        action: 'expense.posted',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'expense', id: e.id },
        metadata: { number, amount: req.amount, request: r.number },
      });
      await recordEvent(
        tx,
        'expense.posted',
        { expenseId: e.id, requestId: r.id, projectId, amount: req.amount },
        userId,
      );
    });
    return this.get(userId, projectId, requestId);
  }

  /** Closes an approved request: whatever is still reserved goes back to the package's headroom. */
  async close(
    userId: string,
    projectId: string,
    requestId: string,
    ifMatch: string | undefined,
  ): Promise<SpendingView> {
    const { project, roles } = await this.requireReader(userId, projectId);
    if (!roles.some((r) => [...REQUESTERS, ...DECIDERS].includes(r)))
      throw new ForbiddenException('You cannot close this request');
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const r = await this.find(tx, projectId, requestId, true);
      if (r.status === 'draft')
        throw new NotFoundException('Spending request not found');
      if (r.revision !== expected)
        throw new VersionConflictException(r.revision);
      if (r.status !== 'approved')
        throw new ConflictException(`This request is ${r.status}`);
      await this.lockLine(tx, projectId, r.milestoneName);
      const left = committedOf((await this.ledgersOf(tx, [r.id])).get(r.id)!);
      await tx.insert(budgetMovements).values({
        organizationId: project.organizationId,
        projectId,
        requestId: r.id,
        budgetLine: r.milestoneName.toLowerCase(),
        kind: 'release',
        amount: left,
        createdBy: userId,
      });
      await tx
        .update(spendingRequests)
        .set({
          status: 'closed',
          updatedAt: new Date(),
          revision: sql`${spendingRequests.revision} + 1`,
        })
        .where(eq(spendingRequests.id, r.id));
      await this.recordAudit(tx, 'spending.closed', userId, project, r);
    });
    return this.get(userId, projectId, requestId);
  }

  /** Withdraws a request not yet approved (nothing was reserved). */
  async withdraw(
    userId: string,
    projectId: string,
    requestId: string,
    ifMatch: string | undefined,
  ): Promise<SpendingView> {
    const { project } = await this.requireRequester(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const r = await this.find(tx, projectId, requestId, true);
      if (r.revision !== expected)
        throw new VersionConflictException(r.revision);
      if (!EDITABLE.includes(r.status))
        throw new ConflictException(`This request is ${r.status}`);
      await tx
        .update(spendingRequests)
        .set({
          status: 'withdrawn',
          updatedAt: new Date(),
          revision: sql`${spendingRequests.revision} + 1`,
        })
        .where(eq(spendingRequests.id, r.id));
      await this.recordAudit(tx, 'spending.withdrawn', userId, project, r);
    });
    return this.get(userId, projectId, requestId);
  }

  /* ---------- internals ---------- */

  private uploadPrefix(projectId: string) {
    return `tmp/${projectId}/spending/`;
  }

  /** Money readers: the contractor's side, finance, the owner and members given financial visibility. */
  private async requireReader(userId: string, projectId: string) {
    const access = await this.access.requireProject(userId, projectId);
    const requester = access.roles.some((r) => REQUESTERS.includes(r));
    if (
      !requester &&
      !access.financialVisibility &&
      !access.roles.includes('finance')
    )
      throw new ForbiddenException('You cannot see this project’s money');
    return { ...access, requester };
  }

  private async requireRequester(userId: string, projectId: string) {
    const access = await this.access.requireProject(userId, projectId);
    if (!access.roles.some((r) => REQUESTERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor or project manager can write spending requests',
      );
    if (access.project.status !== 'active')
      throw new ConflictException('Spending requests are for active projects');
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

  /** Only a cost + fee package takes spending requests: on fixed price the contractor carries the cost. */
  private packageOf(agreement: AgreementRow, index: number): QuoteMilestone {
    const m = agreement.milestones[index] as QuoteMilestone | undefined;
    if (!m || m.basis !== 'reimbursable')
      throw new BadRequestException({
        message: 'Spending requests are for cost + fee packages',
        fieldErrors: [
          {
            field: 'milestoneIndex',
            message: 'Not a cost + fee package of the current agreement',
          },
        ],
      });
    return m;
  }

  private async checkStage(projectId: string, stageId?: string | null) {
    if (!stageId) return;
    const [s] = await this.db
      .select({ id: stages.id })
      .from(stages)
      .where(and(eq(stages.id, stageId), eq(stages.projectId, projectId)));
    if (!s)
      throw new BadRequestException({
        message: 'Unknown stage',
        fieldErrors: [
          { field: 'stageId', message: 'Not a stage of this project' },
        ],
      });
  }

  /** Lines rounded one by one, the total recalculated here (never trusted from the client). */
  private priced(req: SaveReq) {
    const lines = req.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitRate: l.unitRate,
      amount: lineAmount(l.quantity, l.unitRate),
    }));
    return { lines, amount: lines.reduce((t, l) => t + l.amount, 0) };
  }

  /** Budget rows are locked per package (spec §6.3) so two approvals cannot share the last room. */
  private lockLine(tx: Tx, projectId: string, line: string) {
    return tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`budget:${projectId}:${line.toLowerCase()}`}))`,
    );
  }

  /** Over-budget requests do not pass silently (spec §6.3): 409 with the line's balances. */
  private async checkHeadroom(tx: Tx, r: RequestRow) {
    await this.lockLine(tx, r.projectId, r.milestoneName);
    const [a] = await tx
      .select()
      .from(agreements)
      .where(eq(agreements.id, r.agreementId));
    const m = a.milestones[r.milestoneIndex] as QuoteMilestone | undefined;
    if (!m) throw new ConflictException('The package is no longer agreed');
    const line = await this.lineOf(tx, r.projectId, r.milestoneIndex, m);
    if (r.amount > line.headroom)
      throw new ConflictException({
        message: `Only ${Math.max(0, line.headroom)} of the ${line.costBudget} cost budget for “${line.name}” is free (${line.posted} spent, ${line.committed} reserved)`,
        fieldErrors: [{ field: 'amount', message: 'Over the budget' }],
      });
  }

  private async lineOf(
    db: Database | Tx,
    projectId: string,
    index: number,
    m: QuoteMilestone,
  ): Promise<BudgetLine> {
    const feePercent = m.feeBasisPoints != null ? m.feeBasisPoints / 100 : null;
    const key = m.name.toLowerCase();
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
    const [{ pending }] = await db
      .select({
        pending: sql<string>`coalesce(sum(${spendingRequests.amount}), 0)`,
      })
      .from(spendingRequests)
      .where(
        and(
          eq(spendingRequests.projectId, projectId),
          eq(spendingRequests.status, 'submitted'),
          sql`lower(${spendingRequests.milestoneName}) = ${key}`,
        ),
      );
    const costBudget = costBudgetOf(m.amount, feePercent);
    const posted = of('convert');
    const committed = of('reserve') - posted - of('release');
    return {
      index,
      name: m.name,
      feePercent,
      estimate: m.amount,
      costBudget,
      pending: Number(pending),
      committed,
      posted,
      headroom: costBudget - posted - committed,
    };
  }

  private async ledgersOf(
    db: Database | Tx,
    ids: string[],
  ): Promise<Map<string, Ledger>> {
    const out = new Map<string, Ledger>();
    if (!ids.length) return out;
    const rows = await db
      .select({
        id: budgetMovements.requestId,
        kind: budgetMovements.kind,
        total: sql<string>`sum(${budgetMovements.amount})`,
      })
      .from(budgetMovements)
      .where(inArray(budgetMovements.requestId, ids))
      .groupBy(budgetMovements.requestId, budgetMovements.kind);
    for (const id of ids) out.set(id, { reserved: 0, posted: 0, released: 0 });
    for (const r of rows) {
      const l = out.get(r.id)!;
      const n = Number(r.total);
      if (r.kind === 'reserve') l.reserved = n;
      else if (r.kind === 'convert') l.posted = n;
      else l.released = n;
    }
    return out;
  }

  private async nextNumber(
    tx: Tx,
    project: ProjectRow,
    prefix: 'SR' | 'E',
    what: 'requests' | 'expenses',
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${what}:${project.organizationId}`}))`,
    );
    const year = todayIn(project.timezone).slice(0, 4);
    const table = what === 'requests' ? spendingRequests : expenses;
    const [{ n }] = await tx
      .select({ n: count() })
      .from(table)
      .where(
        and(
          eq(table.organizationId, project.organizationId),
          sql`${table.number} like ${`${prefix}-${year}-%`}`,
        ),
      );
    return `${prefix}-${year}-${String(n + 1).padStart(4, '0')}`;
  }

  private async addFiles(
    tx: Tx,
    project: ProjectRow,
    requestId: string,
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
        spendingRequestId: requestId,
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
      'spending.files_added',
      { requestId, projectId: project.id },
      userId,
    );
  }

  /** Expenses with their receipts; an expense without one is "not supplied" (spec §26.1). */
  private async expensesOf(
    requestId: string,
    userId: string,
    roles: readonly ProjectRole[],
  ): Promise<{ expenses: ExpenseView[]; missingReceipts: number }> {
    const rows = await this.db
      .select({ e: expenses, name: users.displayName })
      .from(expenses)
      .leftJoin(users, eq(users.id, expenses.createdBy))
      .where(eq(expenses.requestId, requestId))
      .orderBy(desc(expenses.createdAt));
    const receiptViews = await this.receipts.viewsFor(
      rows.map((r) => r.e),
      userId,
      roles,
    );
    const capturer = roles.some((r) => CAPTURERS.includes(r));
    const list = rows.map(({ e, name }) => {
      const receipt = receiptViews.get(e.id) ?? null;
      return {
        id: e.id,
        number: e.number,
        description: e.description,
        supplierName: e.supplierName,
        expenseDate: e.expenseDate,
        amount: e.amount,
        byName: name,
        at: e.createdAt.toISOString(),
        receiptStatus: receipt?.status ?? ('not_supplied' as const),
        receipt,
        canAddReceipt: capturer && !receipt,
      };
    });
    return {
      expenses: list,
      missingReceipts: list.filter((e) => !e.receipt).length,
    };
  }

  private async decisionsOf(
    requestId: string,
  ): Promise<SpendingView['decisions']> {
    const rows = await this.db
      .select({ d: spendingDecisions, name: users.displayName })
      .from(spendingDecisions)
      .leftJoin(users, eq(users.id, spendingDecisions.actorId))
      .where(eq(spendingDecisions.requestId, requestId))
      .orderBy(desc(spendingDecisions.createdAt));
    return rows.map(({ d, name }) => ({
      kind: d.kind,
      amount: d.amount,
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
    requestId: string,
    lock = false,
  ): Promise<RequestRow> {
    const q = db
      .select()
      .from(spendingRequests)
      .where(
        and(
          eq(spendingRequests.id, requestId),
          eq(spendingRequests.projectId, projectId),
        ),
      );
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new NotFoundException('Spending request not found');
    return r;
  }

  private recordAudit(
    tx: Tx,
    action:
      | 'spending.created'
      | 'spending.submitted'
      | 'spending.approved'
      | 'spending.rejected'
      | 'spending.changes_requested'
      | 'spending.closed'
      | 'spending.withdrawn',
    userId: string,
    project: ProjectRow,
    r: RequestRow,
  ) {
    return this.audit.record(tx, {
      action,
      actor: { userId },
      organizationId: project.organizationId,
      projectId: project.id,
      target: { type: 'spending_request', id: r.id },
      metadata: { number: r.number, amount: r.amount },
    });
  }
}
