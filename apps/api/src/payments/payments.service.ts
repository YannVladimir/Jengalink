import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_CLAIM_FILE_BYTES,
  type PayableClaim,
  type PaymentsOverview,
  type PaymentView,
  type ProjectRole,
  RecordPaymentRequest,
  RequestClaimUploadRequest,
  type UploadGrantView,
  VerifyPaymentRequest,
} from '@jengalink/contracts';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
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
import { claims, media, payments, projects, users } from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { AttachmentsService } from '../media/attachments';
import { AccessService } from '../projects/access.service';
import { StorageService } from '../storage/storage.service';

type Side = 'client' | 'contractor' | 'finance';
type PaymentRow = typeof payments.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
const CLIENT: readonly ProjectRole[] = ['owner', 'delegate'];
const CONTRACTOR: readonly ProjectRole[] = ['contractor', 'manager'];
/** Payments that count against a claim: everything not disputed or cancelled. */
const STANDING = ['pending_verification', 'settled'] as const;
const recordPipe = new ZodPipe(RecordPaymentRequest);
const verifyPipe = new ZodPipe(VerifyPaymentRequest);
const uploadPipe = new ZodPipe(RequestClaimUploadRequest);
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

/** The side a person acts for on this project; the client side wins for someone on both. */
const sideOf = (roles: readonly ProjectRole[]): Side | null =>
  roles.some((r) => CLIENT.includes(r))
    ? 'client'
    : roles.some((r) => CONTRACTOR.includes(r))
      ? 'contractor'
      : roles.includes('finance')
        ? 'finance'
        : null;

/**
 * External payment records (spec §6.6, A0). JengaLink moves no money: whoever paid (or was paid)
 * records it with proof; it becomes cash paid only when someone independent confirms it, either
 * the other side or finance. A claim is Paid once its settled payments cover it.
 */
@Injectable()
export class PaymentsService {
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
    await this.requireMoney(userId, projectId);
    const req = uploadPipe.transform(body);
    return this.storage.createUploadGrant(
      req.contentType,
      MAX_CLAIM_FILE_BYTES,
      this.prefix(projectId),
    );
  }

  /** Cash paid, waiting for verification, owed on approved claims, and every payment. */
  async overview(userId: string, projectId: string): Promise<PaymentsOverview> {
    const { roles } = await this.requireMoney(userId, projectId);
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.projectId, projectId))
      .orderBy(desc(payments.createdAt));
    const payable = await this.payableClaims(projectId);
    return {
      currency: 'RWF',
      cashPaid: rows
        .filter((p) => p.status === 'settled')
        .reduce((t, p) => t + p.amount, 0),
      pendingVerification: rows
        .filter((p) => p.status === 'pending_verification')
        .reduce((t, p) => t + p.amount, 0),
      owedOnClaims: payable.reduce((t, c) => t + c.amount - c.paid, 0),
      payable,
      payments: await this.views(rows, userId, roles),
      canRecord: sideOf(roles) !== null,
    };
  }

  /** Records a payment made outside JengaLink, pending verification. */
  async record(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<PaymentsOverview> {
    const { project, roles } = await this.requireMoney(userId, projectId);
    const side = sideOf(roles);
    if (!side)
      throw new ForbiddenException('Your role cannot record payments here');
    const req = recordPipe.transform(body);
    if (req.paymentDate > todayIn(project.timezone))
      throw new BadRequestException({
        message: 'The payment date cannot be in the future',
        fieldErrors: [{ field: 'paymentDate', message: 'In the future' }],
      });
    const promoted = await this.files.promote(
      project,
      req.files,
      this.prefix(projectId),
    );
    try {
      await this.db.transaction(async (tx) => {
        if (req.claimId)
          await this.checkClaim(tx, projectId, req.claimId, req.amount);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${'payments:' + project.organizationId}))`,
        );
        const year = todayIn(project.timezone).slice(0, 4);
        const [{ n }] = await tx
          .select({ n: count() })
          .from(payments)
          .where(
            and(
              eq(payments.organizationId, project.organizationId),
              sql`${payments.number} like ${`P-${year}-%`}`,
            ),
          );
        const [p] = await tx
          .insert(payments)
          .values({
            organizationId: project.organizationId,
            projectId,
            number: `P-${year}-${String(n + 1).padStart(4, '0')}`,
            claimId: req.claimId ?? null,
            payer: req.payer,
            beneficiary: req.beneficiary,
            amount: req.amount,
            method: req.method,
            reference: req.reference || null,
            paymentDate: req.paymentDate,
            note: req.note || null,
            recordedSide: side,
            createdBy: userId,
          })
          .returning();
        if (promoted.length) {
          await tx.insert(media).values(
            promoted.map((m, i) => ({
              organizationId: project.organizationId,
              projectId,
              paymentId: p.id,
              fileName: req.files[i].fileName || null,
              position: i,
              storageKey: m.key,
              contentType: m.contentType,
              sizeBytes: m.sizeBytes,
              createdBy: userId,
            })),
          );
          await recordEvent(
            tx,
            'payment.files_added',
            { paymentId: p.id, projectId },
            userId,
          );
        }
        await this.recordAudit(tx, 'payment.recorded', userId, project, p);
        await recordEvent(
          tx,
          'payment.recorded',
          { paymentId: p.id, projectId, amount: p.amount, claimId: p.claimId },
          userId,
        );
      });
    } catch (err) {
      await this.files.dropKeys(promoted.map((p) => p.key));
      throw err;
    }
    return this.overview(userId, projectId);
  }

  /**
   * The other side, or finance, confirms the money arrived (settled: cash paid) or disputes it.
   * A claim covered in full by settled payments becomes Paid.
   */
  async verify(
    userId: string,
    projectId: string,
    paymentId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<PaymentsOverview> {
    const { project, roles } = await this.requireMoney(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = verifyPipe.transform(body);
    await this.db.transaction(async (tx) => {
      const p = await this.find(tx, projectId, paymentId);
      if (p.revision !== expected)
        throw new VersionConflictException(p.revision);
      if (!this.mayVerify(p, userId, roles))
        throw new ForbiddenException(
          'The other side of the payment, or finance, must confirm it',
        );
      if (p.status !== 'pending_verification')
        throw new ConflictException(`This payment is ${p.status}`);
      const settled = req.decision === 'settle';
      await tx
        .update(payments)
        .set({
          status: settled ? 'settled' : 'disputed',
          verifiedBy: userId,
          verifiedAt: new Date(),
          verificationNote: req.note || null,
          updatedAt: new Date(),
          revision: sql`${payments.revision} + 1`,
        })
        .where(eq(payments.id, p.id));
      if (settled && p.claimId) {
        const [c] = await tx
          .select()
          .from(claims)
          .where(eq(claims.id, p.claimId))
          .for('update');
        const paid = await this.sumOn(tx, c.id, ['settled']);
        if (c.status === 'approved' && paid >= c.amount)
          await tx
            .update(claims)
            .set({
              status: 'paid',
              updatedAt: new Date(),
              revision: sql`${claims.revision} + 1`,
            })
            .where(eq(claims.id, c.id));
      }
      await this.recordAudit(
        tx,
        settled ? 'payment.settled' : 'payment.disputed',
        userId,
        project,
        p,
      );
      await recordEvent(
        tx,
        'payment.verified',
        {
          paymentId: p.id,
          projectId,
          decision: settled ? 'settled' : 'disputed',
        },
        userId,
      );
    });
    return this.overview(userId, projectId);
  }

  /** Whoever recorded it withdraws it before verification. */
  async cancel(
    userId: string,
    projectId: string,
    paymentId: string,
    ifMatch: string | undefined,
  ): Promise<PaymentsOverview> {
    const { project } = await this.requireMoney(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    await this.db.transaction(async (tx) => {
      const p = await this.find(tx, projectId, paymentId);
      if (p.revision !== expected)
        throw new VersionConflictException(p.revision);
      if (p.createdBy !== userId)
        throw new ForbiddenException(
          'Only whoever recorded it can withdraw it',
        );
      if (p.status !== 'pending_verification')
        throw new ConflictException(`This payment is ${p.status}`);
      await tx
        .update(payments)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
          revision: sql`${payments.revision} + 1`,
        })
        .where(eq(payments.id, p.id));
      await this.recordAudit(tx, 'payment.cancelled', userId, project, p);
    });
    return this.overview(userId, projectId);
  }

  /** Settled and pending totals for claims (used by the claim views). */
  async claimTotals(
    claimIds: string[],
  ): Promise<Map<string, { paid: number; pending: number }>> {
    const out = new Map<string, { paid: number; pending: number }>();
    if (!claimIds.length) return out;
    const rows = await this.db
      .select({
        claimId: payments.claimId,
        status: payments.status,
        total: sql<string>`sum(${payments.amount})`,
      })
      .from(payments)
      .where(
        and(
          inArray(payments.claimId, claimIds),
          inArray(payments.status, [...STANDING]),
        ),
      )
      .groupBy(payments.claimId, payments.status);
    for (const id of claimIds) out.set(id, { paid: 0, pending: 0 });
    for (const r of rows) {
      const t = out.get(r.claimId!)!;
      if (r.status === 'settled') t.paid = Number(r.total);
      else t.pending = Number(r.total);
    }
    return out;
  }

  /* ---------- internals ---------- */

  private prefix(projectId: string) {
    return `tmp/${projectId}/payments/`;
  }

  /** Money readers: owner side, contractor side, finance and members given financial visibility. */
  private async requireMoney(userId: string, projectId: string) {
    const access = await this.access.requireProject(userId, projectId);
    if (!sideOf(access.roles) && !access.financialVisibility)
      throw new ForbiddenException('You cannot see this project’s money');
    return access;
  }

  /** Independent: not whoever recorded it; finance, or the other side. */
  private mayVerify(
    p: PaymentRow,
    userId: string,
    roles: readonly ProjectRole[],
  ) {
    if (p.createdBy === userId || p.status !== 'pending_verification')
      return false;
    if (roles.includes('finance')) return true;
    const mine = sideOf(roles);
    return mine !== null && mine !== 'finance' && mine !== p.recordedSide;
  }

  /** A payment pays an approved claim and never more than is still open on it. */
  private async checkClaim(
    tx: Tx,
    projectId: string,
    claimId: string,
    amount: number,
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${'claim-pay:' + claimId}))`,
    );
    const [c] = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.projectId, projectId)));
    if (!c || c.status === 'draft')
      throw new BadRequestException({
        message: 'Unknown claim',
        fieldErrors: [
          { field: 'claimId', message: 'Not a claim of this project' },
        ],
      });
    if (c.status !== 'approved')
      throw new ConflictException(
        `Only approved claims are paid; this one is ${c.status}`,
      );
    const open = c.amount - (await this.sumOn(tx, c.id, [...STANDING]));
    if (amount > open)
      throw new ConflictException({
        message: `Only ${Math.max(0, open)} is still open on claim ${c.number}`,
        fieldErrors: [{ field: 'amount', message: 'More than is owed' }],
      });
  }

  private async sumOn(
    db: Database | Tx,
    claimId: string,
    statuses: PaymentRow['status'][],
  ): Promise<number> {
    const [{ total }] = await db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(
        and(eq(payments.claimId, claimId), inArray(payments.status, statuses)),
      );
    return Number(total);
  }

  private async payableClaims(projectId: string): Promise<PayableClaim[]> {
    const rows = await this.db
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.projectId, projectId),
          inArray(claims.status, ['approved', 'paid']),
        ),
      )
      .orderBy(asc(claims.createdAt));
    const totals = await this.claimTotals(rows.map((c) => c.id));
    return rows
      .map((c) => {
        const t = totals.get(c.id)!;
        return {
          claimId: c.id,
          number: c.number,
          milestoneName: c.milestoneName,
          amount: c.amount,
          paid: t.paid,
          pending: t.pending,
          open: Math.max(0, c.amount - t.paid - t.pending),
        };
      })
      .filter((c) => c.paid < c.amount);
  }

  private async views(
    rows: PaymentRow[],
    userId: string,
    roles: readonly ProjectRole[],
  ): Promise<PaymentView[]> {
    if (!rows.length) return [];
    const recorder = alias(users, 'recorder');
    const verifier = alias(users, 'verifier');
    const names = await this.db
      .select({
        id: payments.id,
        recordedBy: recorder.displayName,
        verifiedBy: verifier.displayName,
        claimNumber: claims.number,
      })
      .from(payments)
      .leftJoin(recorder, eq(recorder.id, payments.createdBy))
      .leftJoin(verifier, eq(verifier.id, payments.verifiedBy))
      .leftJoin(claims, eq(claims.id, payments.claimId))
      .where(
        inArray(
          payments.id,
          rows.map((r) => r.id),
        ),
      );
    const fileRows = await this.db
      .select()
      .from(media)
      .where(
        inArray(
          media.paymentId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(media.position));
    const fileViews = await this.files.views(fileRows);
    const out: PaymentView[] = [];
    for (const p of rows) {
      const n = names.find((x) => x.id === p.id)!;
      const same = p.reference
        ? await this.db
            .select({ number: payments.number })
            .from(payments)
            .where(
              and(
                eq(payments.organizationId, p.organizationId),
                eq(payments.method, p.method),
                sql`lower(${payments.reference}) = lower(${p.reference})`,
                ne(payments.id, p.id),
                ne(payments.status, 'cancelled'),
              ),
            )
        : [];
      out.push({
        id: p.id,
        number: p.number,
        status: p.status,
        claimId: p.claimId,
        claimNumber: n.claimNumber,
        payer: p.payer,
        beneficiary: p.beneficiary,
        amount: p.amount,
        currency: p.currency,
        method: p.method,
        reference: p.reference,
        paymentDate: p.paymentDate,
        note: p.note,
        files: fileViews.filter(
          (f) => fileRows.find((r) => r.id === f.id)?.paymentId === p.id,
        ),
        sameReference: same.map((s) => s.number),
        recordedByName: n.recordedBy,
        recordedAt: p.createdAt.toISOString(),
        verifiedByName: n.verifiedBy,
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
        verificationNote: p.verificationNote,
        canVerify: this.mayVerify(p, userId, roles),
        canCancel:
          p.createdBy === userId && p.status === 'pending_verification',
        version: p.revision,
      });
    }
    return out;
  }

  private async find(
    tx: Tx,
    projectId: string,
    paymentId: string,
  ): Promise<PaymentRow> {
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.projectId, projectId)))
      .for('update');
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }

  private recordAudit(
    tx: Tx,
    action:
      | 'payment.recorded'
      | 'payment.settled'
      | 'payment.disputed'
      | 'payment.cancelled',
    userId: string,
    project: ProjectRow,
    p: PaymentRow,
  ) {
    return this.audit.record(tx, {
      action,
      actor: { userId },
      organizationId: project.organizationId,
      projectId: project.id,
      target: { type: 'payment', id: p.id },
      metadata: { number: p.number, amount: p.amount, method: p.method },
    });
  }
}
