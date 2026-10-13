import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_CLAIM_FILE_BYTES,
  type ProjectRole,
  type ReceiptDuplicate,
  type ReceiptView,
  RequestClaimUploadRequest,
  ReviewReceiptRequest,
  SaveReceiptRequest,
  type UploadGrantView,
} from '@jengalink/contracts';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
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
import { expenses, media, projects, receipts, users } from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { AttachmentsService } from '../media/attachments';
import { AccessService } from '../projects/access.service';
import { StorageService } from '../storage/storage.service';

/** Who captures receipts: whoever records expenses. */
export const CAPTURERS: readonly ProjectRole[] = [
  'contractor',
  'manager',
  'finance',
];
/** Who checks them (spec §26.1 "reviewer"): the client side or finance, never the person who captured it. */
const REVIEWERS: readonly ProjectRole[] = ['owner', 'delegate', 'finance'];
const EDITABLE = ['captured', 'discrepancy_found'] as const;
const savePipe = new ZodPipe(SaveReceiptRequest);
const reviewPipe = new ZodPipe(ReviewReceiptRequest);
const uploadPipe = new ZodPipe(RequestClaimUploadRequest);
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

type ReceiptRow = typeof receipts.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

/**
 * Supplier receipts with EBM fields (spec §26.1). JengaLink collects the supplier's evidence and
 * records manual checks; it issues no EBM invoice and offers no "verified" badge without a
 * supported RRA channel. Duplicates are flagged, not blocked: a reviewer decides.
 */
@Injectable()
export class ReceiptsService {
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
    await this.requireCapturer(userId, projectId);
    const req = uploadPipe.transform(body);
    return this.storage.createUploadGrant(
      req.contentType,
      MAX_CLAIM_FILE_BYTES,
      this.prefix(projectId),
    );
  }

  /** Captures the receipt of an expense, or corrects one not yet accepted by a reviewer. */
  async save(
    userId: string,
    projectId: string,
    expenseId: string,
    ifMatch: string | undefined,
    body: unknown,
  ) {
    const project = await this.requireCapturer(userId, projectId);
    const req = savePipe.transform(body);
    if (req.invoiceDate > todayIn(project.timezone))
      throw new ConflictException({
        message: 'The invoice date cannot be in the future',
        fieldErrors: [{ field: 'invoiceDate', message: 'In the future' }],
      });
    const expense = await this.findExpense(this.db, projectId, expenseId);
    const promoted = req.file
      ? await this.files.promote(project, [req.file], this.prefix(projectId))
      : [];
    let replaced: string[] = [];
    try {
      replaced = await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(receipts)
          .where(eq(receipts.expenseId, expense.id))
          .for('update');
        const fields = {
          supplierName: req.supplierName,
          supplierTin: req.supplierTin || null,
          buyerTin: req.buyerTin || null,
          invoiceNumber: req.invoiceNumber,
          invoiceDate: req.invoiceDate,
          total: req.total,
          vatAmount: req.vatAmount ?? null,
          ebmReference: req.ebmReference || null,
          qrPayload: req.qrPayload || null,
        };
        let receiptId: string;
        if (current) {
          const expected = parseIfMatch(ifMatch);
          if (expected === null) throw new PreconditionRequiredException();
          if (current.revision !== expected)
            throw new VersionConflictException(current.revision);
          if (!(EDITABLE as readonly string[]).includes(current.status))
            throw new ConflictException(
              'This receipt was accepted by a reviewer and can no longer change',
            );
          // A correction goes back to "captured": the reviewer checks it again.
          await tx
            .update(receipts)
            .set({
              ...fields,
              status: 'captured',
              reviewedBy: null,
              reviewedAt: null,
              reviewNote: null,
              updatedAt: new Date(),
              revision: sql`${receipts.revision} + 1`,
            })
            .where(eq(receipts.id, current.id));
          receiptId = current.id;
        } else {
          const [created] = await tx
            .insert(receipts)
            .values({
              organizationId: project.organizationId,
              projectId,
              expenseId: expense.id,
              ...fields,
              createdBy: userId,
            })
            .returning({ id: receipts.id });
          receiptId = created.id;
        }
        let gone: string[] = [];
        if (promoted.length) {
          const old = await tx
            .delete(media)
            .where(eq(media.receiptId, receiptId))
            .returning({ key: media.storageKey, thumb: media.thumbKey });
          gone = old.flatMap((o) => (o.thumb ? [o.key, o.thumb] : [o.key]));
          await tx.insert(media).values({
            organizationId: project.organizationId,
            projectId,
            receiptId,
            fileName: req.file?.fileName || null,
            storageKey: promoted[0].key,
            contentType: promoted[0].contentType,
            sizeBytes: promoted[0].sizeBytes,
            createdBy: userId,
          });
          await recordEvent(
            tx,
            'receipt.files_added',
            { receiptId, projectId },
            userId,
          );
        }
        await this.audit.record(tx, {
          action: current ? 'receipt.updated' : 'receipt.captured',
          actor: { userId },
          organizationId: project.organizationId,
          projectId,
          target: { type: 'receipt', id: receiptId },
          metadata: {
            expense: expense.number,
            invoiceNumber: req.invoiceNumber,
            total: req.total,
          },
        });
        return gone;
      });
    } catch (err) {
      await this.files.dropKeys(promoted.map((p) => p.key));
      throw err;
    }
    await this.files.dropKeys(replaced);
    return expense.requestId;
  }

  /** An independent reviewer records a manual check: reviewed, or a discrepancy with a note. */
  async review(
    userId: string,
    projectId: string,
    expenseId: string,
    ifMatch: string | undefined,
    body: unknown,
  ) {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => REVIEWERS.includes(r)))
      throw new ForbiddenException(
        'Only the owner, their delegate or finance can review receipts',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = reviewPipe.transform(body);
    const expense = await this.findExpense(this.db, projectId, expenseId);
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(receipts)
        .where(eq(receipts.expenseId, expense.id))
        .for('update');
      if (!r) throw new NotFoundException('No receipt yet');
      if (r.revision !== expected)
        throw new VersionConflictException(r.revision);
      if (r.createdBy === userId)
        throw new ForbiddenException(
          'Someone else must review a receipt you captured',
        );
      // A discrepancy goes back to the contractor; their correction makes it "captured" again.
      if (r.status !== 'captured')
        throw new ConflictException(`This receipt is ${r.status}`);
      await tx
        .update(receipts)
        .set({
          status: req.status,
          reviewedBy: userId,
          reviewedAt: new Date(),
          reviewNote: req.note || null,
          updatedAt: new Date(),
          revision: sql`${receipts.revision} + 1`,
        })
        .where(eq(receipts.id, r.id));
      await this.audit.record(tx, {
        action: 'receipt.reviewed',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'receipt', id: r.id },
        metadata: { expense: expense.number, status: req.status },
      });
    });
    return expense.requestId;
  }

  /** Receipt views for expenses, keyed by expense id, as seen by this caller. */
  async viewsFor(
    expenseRows: ExpenseRow[],
    userId: string,
    roles: readonly ProjectRole[],
  ): Promise<Map<string, ReceiptView>> {
    const out = new Map<string, ReceiptView>();
    if (!expenseRows.length) return out;
    const reviewer = alias(users, 'reviewer');
    const capturer = alias(users, 'capturer');
    const rows = await this.db
      .select({
        r: receipts,
        capturedByName: capturer.displayName,
        reviewedByName: reviewer.displayName,
      })
      .from(receipts)
      .leftJoin(capturer, eq(capturer.id, receipts.createdBy))
      .leftJoin(reviewer, eq(reviewer.id, receipts.reviewedBy))
      .where(
        inArray(
          receipts.expenseId,
          expenseRows.map((e) => e.id),
        ),
      );
    if (!rows.length) return out;
    const fileRows = await this.db
      .select()
      .from(media)
      .where(
        inArray(
          media.receiptId,
          rows.map((x) => x.r.id),
        ),
      );
    const fileViews = await this.files.views(fileRows);
    const capturer_ = roles.some((r) => CAPTURERS.includes(r));
    const reviewer_ = roles.some((r) => REVIEWERS.includes(r));
    for (const { r, capturedByName, reviewedByName } of rows) {
      const expense = expenseRows.find((e) => e.id === r.expenseId)!;
      const fileRow = fileRows.find((f) => f.receiptId === r.id);
      const open = (EDITABLE as readonly string[]).includes(r.status);
      out.set(r.expenseId, {
        id: r.id,
        status: r.status,
        supplierName: r.supplierName,
        supplierTin: r.supplierTin,
        buyerTin: r.buyerTin,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate,
        total: r.total,
        vatAmount: r.vatAmount,
        ebmReference: r.ebmReference,
        qrPayload: r.qrPayload,
        file: fileViews.find((f) => f.id === fileRow?.id) ?? null,
        totalMatches: r.total === expense.amount,
        duplicates: await this.duplicatesOf(r, fileRow?.sha256 ?? null),
        capturedByName,
        capturedAt: r.createdAt.toISOString(),
        reviewedByName,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewNote: r.reviewNote,
        canEdit: capturer_ && open,
        canReview:
          reviewer_ && r.status === 'captured' && r.createdBy !== userId,
        version: r.revision,
      });
    }
    return out;
  }

  /** Same supplier TIN + invoice number, or the exact same file, anywhere in the organization. */
  private async duplicatesOf(
    r: ReceiptRow,
    sha256: string | null,
  ): Promise<ReceiptDuplicate[]> {
    const out: ReceiptDuplicate[] = [];
    if (r.supplierTin) {
      const same = await this.db
        .select({ number: expenses.number, projectName: projects.name })
        .from(receipts)
        .innerJoin(expenses, eq(expenses.id, receipts.expenseId))
        .innerJoin(projects, eq(projects.id, receipts.projectId))
        .where(
          and(
            eq(receipts.organizationId, r.organizationId),
            eq(receipts.supplierTin, r.supplierTin),
            sql`lower(${receipts.invoiceNumber}) = lower(${r.invoiceNumber})`,
            ne(receipts.id, r.id),
          ),
        );
      out.push(
        ...same.map((s) => ({
          kind: 'invoice' as const,
          expenseNumber: s.number,
          projectName: s.projectName,
        })),
      );
    }
    if (sha256) {
      const same = await this.db
        .select({ number: expenses.number, projectName: projects.name })
        .from(media)
        .innerJoin(receipts, eq(receipts.id, media.receiptId))
        .innerJoin(expenses, eq(expenses.id, receipts.expenseId))
        .innerJoin(projects, eq(projects.id, receipts.projectId))
        .where(
          and(
            eq(media.organizationId, r.organizationId),
            eq(media.sha256, sha256),
            isNotNull(media.receiptId),
            ne(receipts.id, r.id),
          ),
        );
      out.push(
        ...same.map((s) => ({
          kind: 'file' as const,
          expenseNumber: s.number,
          projectName: s.projectName,
        })),
      );
    }
    return out;
  }

  private prefix(projectId: string) {
    return `tmp/${projectId}/receipts/`;
  }

  private async requireCapturer(
    userId: string,
    projectId: string,
  ): Promise<ProjectRow> {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => CAPTURERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor, project manager or finance can capture receipts',
      );
    return project;
  }

  private async findExpense(
    db: Database | Tx,
    projectId: string,
    expenseId: string,
  ): Promise<ExpenseRow> {
    const [e] = await db
      .select()
      .from(expenses)
      .where(
        and(eq(expenses.id, expenseId), eq(expenses.projectId, projectId)),
      );
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }
}
