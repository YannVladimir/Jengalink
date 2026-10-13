import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isExpired,
  type ProjectRole,
  type QuotePdfLink,
  type QuoteStatus,
  type QuoteSummary,
  type QuoteView,
  type AgreementView,
  marginOf,
  quoteBasisOf,
  QuoteDecisionRequest,
  SaveQuoteRequest,
} from '@jengalink/contracts';
import { isLocale } from '@jengalink/i18n';
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
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
  budgetChanges,
  organizationMemberships,
  organizations,
  projectMemberships,
  quoteInternalCosts,
  projects,
  quoteRevisions,
  quotes,
  users,
} from '../db/schema';
import type { QuoteMilestone } from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { renderQuotePdf } from '../pdf/quote-pdf';
import { AccessService, seesMoney } from '../projects/access.service';
import { StorageService } from '../storage/storage.service';

/** Who writes and sends quotes; everyone else on the project reads sent revisions only. */
const EDITORS: readonly ProjectRole[] = ['contractor', 'manager'];
const savePipe = new ZodPipe(SaveQuoteRequest);
const decisionPipe = new ZodPipe(QuoteDecisionRequest);
/** Who accepts or declines a quote for the client. */
const DECIDERS: readonly ProjectRole[] = ['owner', 'delegate'];
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

type QuoteRow = typeof quotes.$inferSelect;
/** What anyone on the project sees of a work package (never the contractor's own cost). */
const milestoneView = (m: QuoteMilestone) => ({
  name: m.name,
  description: m.description,
  amount: m.amount,
  stageId: m.stageId,
  basis: m.basis ?? ('fixed' as const),
  feePercent: m.feeBasisPoints != null ? m.feeBasisPoints / 100 : null,
});
type RevisionRow = typeof quoteRevisions.$inferSelect;

@Injectable()
export class QuotesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, projectId: string): Promise<QuoteSummary[]> {
    const access = await this.access.requireProject(userId, projectId);
    requireMoneyReader(access);
    const { project, roles } = access;
    const editor = roles.some((r) => EDITORS.includes(r));
    const rows = await this.db
      .select()
      .from(quotes)
      .where(eq(quotes.projectId, projectId))
      .orderBy(desc(quotes.updatedAt));
    const today = todayIn(project.timezone);
    const out: QuoteSummary[] = [];
    for (const q of rows) {
      const rev = await this.visibleRevision(q, editor);
      if (!rev) continue;
      out.push({
        id: q.id,
        number: q.number,
        status: this.statusOf(q, rev, today),
        currentRevision: q.currentRevision,
        title: rev.title,
        currency: rev.currency,
        total: rev.total,
        validUntil: rev.validUntil,
        sentAt: rev.sentAt?.toISOString() ?? null,
        updatedAt: q.updatedAt.toISOString(),
      });
    }
    return out;
  }

  async create(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<QuoteView> {
    const { project } = await this.requireEditor(userId, projectId);
    const req = savePipe.transform(body);
    this.assertFuture(req.validUntil, project.timezone);
    const id = await this.db.transaction(async (tx) => {
      // Per-organization numbering: one writer at a time for this organization.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${project.organizationId}))`,
      );
      const year = todayIn(project.timezone).slice(0, 4);
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quotes)
        .where(
          and(
            eq(quotes.organizationId, project.organizationId),
            sql`${quotes.number} like ${`Q-${year}-%`}`,
          ),
        );
      const [q] = await tx
        .insert(quotes)
        .values({
          organizationId: project.organizationId,
          projectId,
          number: `Q-${year}-${String(n + 1).padStart(4, '0')}`,
          createdBy: userId,
        })
        .returning();
      const [r1] = await tx
        .insert(quoteRevisions)
        .values({
          quoteId: q.id,
          revisionNo: 1,
          ...this.content(req),
          createdBy: userId,
        })
        .returning({ id: quoteRevisions.id });
      await this.saveCosts(tx, project.organizationId, r1.id, req, userId);
      await this.recordAudit(tx, 'quote.created', userId, project, q, 1);
      return q.id;
    });
    return this.get(userId, projectId, id);
  }

  async get(
    userId: string,
    projectId: string,
    quoteId: string,
    revision?: number,
  ): Promise<QuoteView> {
    const access = await this.access.requireProject(userId, projectId);
    requireMoneyReader(access);
    const { project, roles } = access;
    const editor = roles.some((r) => EDITORS.includes(r));
    const decider = roles.some((r) => DECIDERS.includes(r));
    const q = await this.find(projectId, quoteId);
    const all = await this.db
      .select()
      .from(quoteRevisions)
      .where(eq(quoteRevisions.quoteId, q.id))
      .orderBy(desc(quoteRevisions.revisionNo));
    const visible = editor ? all : all.filter((r) => r.sentAt);
    const rev = revision
      ? visible.find((r) => r.revisionNo === revision)
      : visible[0];
    if (!rev) throw new NotFoundException('Quote not found');
    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId));
    return {
      id: q.id,
      projectId,
      projectName: project.name,
      organizationName: org?.name ?? '',
      clientName: await this.ownerName(projectId),
      number: q.number,
      status: this.statusOf(q, rev, todayIn(project.timezone)),
      revision: rev.revisionNo,
      revisions: visible.map((r) => ({
        revision: r.revisionNo,
        sentAt: r.sentAt?.toISOString() ?? null,
        total: r.total,
      })),
      title: rev.title,
      scope: rev.scope,
      exclusions: rev.exclusions,
      milestones: rev.milestones.map(milestoneView),
      commercialBasis: quoteBasisOf(rev.milestones),
      internal:
        editor &&
        (await this.inContractorCompany(userId, project.organizationId))
          ? await this.internalOf(rev)
          : null,
      terms: rev.terms,
      currency: rev.currency,
      total: rev.total,
      validUntil: rev.validUntil,
      sentAt: rev.sentAt?.toISOString() ?? null,
      version: q.revision,
      canEdit: editor && q.status !== 'accepted' && q.status !== 'withdrawn',
      canDecide:
        decider &&
        !!rev.sentAt &&
        this.statusOf(q, rev, todayIn(project.timezone)) === 'sent',
      decision: await this.decisionOf(q),
    };
  }

  /**
   * The owner accepts or declines the exact revision they read. Accepting creates the next
   * agreement version (a copy of what was accepted) and sets the project's contract value.
   */
  async decide(
    userId: string,
    projectId: string,
    quoteId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<QuoteView> {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => DECIDERS.includes(r)))
      throw new ForbiddenException(
        'Only the owner can accept or decline a quote',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = decisionPipe.transform(body);
    await this.db.transaction(async (tx) => {
      const [q] = await tx
        .select()
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.projectId, projectId)))
        .for('update');
      if (!q) throw new NotFoundException('Quote not found');
      if (q.revision !== expected)
        throw new VersionConflictException(q.revision);
      const [rev] = await tx
        .select()
        .from(quoteRevisions)
        .where(
          and(
            eq(quoteRevisions.quoteId, q.id),
            eq(quoteRevisions.revisionNo, req.revision),
          ),
        );
      if (!rev?.sentAt)
        throw new NotFoundException('That revision was not sent');
      const status = this.statusOf(q, rev, todayIn(project.timezone));
      if (status === 'expired')
        throw new ConflictException(
          'This quote has expired. Ask the contractor for a new revision.',
        );
      if (status !== 'sent')
        throw new ConflictException(`This quote is already ${status}`);
      // Only the newest sent revision can be decided on: an older one was replaced.
      const [newerSent] = await tx
        .select({ n: quoteRevisions.revisionNo })
        .from(quoteRevisions)
        .where(
          and(
            eq(quoteRevisions.quoteId, q.id),
            gt(quoteRevisions.revisionNo, rev.revisionNo),
            isNotNull(quoteRevisions.sentAt),
          ),
        );
      if (newerSent)
        throw new ConflictException(
          `Revision ${newerSent.n} replaced this one`,
        );

      const accepted = req.decision === 'accept';
      if (accepted) {
        // A newer unsent draft is dropped: what was accepted is now the agreement.
        await tx
          .delete(quoteRevisions)
          .where(
            and(
              eq(quoteRevisions.quoteId, q.id),
              gt(quoteRevisions.revisionNo, rev.revisionNo),
              isNull(quoteRevisions.sentAt),
            ),
          );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${'agreements:' + projectId}))`,
        );
        const [{ n }] = await tx
          .select({
            n: sql<number>`coalesce(max(${agreements.version}), 0)::int`,
          })
          .from(agreements)
          .where(eq(agreements.projectId, projectId));
        await tx.insert(agreements).values({
          organizationId: project.organizationId,
          projectId,
          version: n + 1,
          quoteId: q.id,
          quoteNumber: q.number,
          quoteRevisionNo: rev.revisionNo,
          title: rev.title,
          scope: rev.scope,
          exclusions: rev.exclusions,
          milestones: rev.milestones,
          terms: rev.terms,
          currency: rev.currency,
          contractValue: rev.total,
          acceptedBy: userId,
        });
        await tx
          .update(projects)
          .set({
            contractValue: rev.total,
            updatedAt: new Date(),
            revision: sql`${projects.revision} + 1`,
          })
          .where(eq(projects.id, projectId));
      }
      await tx
        .update(quotes)
        .set({
          status: accepted ? 'accepted' : 'declined',
          currentRevision: accepted ? rev.revisionNo : q.currentRevision,
          decidedRevisionNo: rev.revisionNo,
          decidedBy: userId,
          decidedAt: new Date(),
          decisionNote: req.note || null,
          updatedAt: new Date(),
          revision: sql`${quotes.revision} + 1`,
        })
        .where(eq(quotes.id, q.id));
      await this.recordAudit(
        tx,
        accepted ? 'quote.accepted' : 'quote.declined',
        userId,
        project,
        q,
        rev.revisionNo,
      );
      await recordEvent(
        tx,
        'quote.decided',
        {
          quoteId: q.id,
          projectId,
          revision: rev.revisionNo,
          decision: accepted ? 'accepted' : 'declined',
        },
        userId,
      );
    });
    return this.get(userId, projectId, quoteId);
  }

  /** Every agreement version, newest first. Any member may read. */
  async agreements(
    userId: string,
    projectId: string,
  ): Promise<AgreementView[]> {
    requireMoneyReader(await this.access.requireProject(userId, projectId));
    const by = alias(users, 'accepter');
    const rows = await this.db
      .select({
        a: agreements,
        name: by.displayName,
        changeNumber: budgetChanges.number,
      })
      .from(agreements)
      .leftJoin(by, eq(by.id, agreements.acceptedBy))
      .leftJoin(budgetChanges, eq(budgetChanges.id, agreements.changeId))
      .where(eq(agreements.projectId, projectId))
      .orderBy(desc(agreements.version));
    return rows.map(({ a, name, changeNumber }) => ({
      id: a.id,
      version: a.version,
      quoteId: a.quoteId,
      quoteNumber: a.quoteNumber,
      quoteRevision: a.quoteRevisionNo,
      title: a.title,
      contractValue: a.contractValue,
      currency: a.currency,
      milestones: a.milestones.map(milestoneView),
      commercialBasis: quoteBasisOf(a.milestones),
      acceptedByName: name,
      acceptedAt: a.createdAt.toISOString(),
      changeNumber,
    }));
  }

  private async decisionOf(q: QuoteRow): Promise<QuoteView['decision']> {
    if (
      !q.decidedAt ||
      !q.decidedRevisionNo ||
      (q.status !== 'accepted' && q.status !== 'declined')
    )
      return null;
    const [who] = q.decidedBy
      ? await this.db
          .select({ name: users.displayName })
          .from(users)
          .where(eq(users.id, q.decidedBy))
      : [];
    const [agreement] =
      q.status === 'accepted'
        ? await this.db
            .select({ version: agreements.version })
            .from(agreements)
            .where(
              and(
                eq(agreements.quoteId, q.id),
                eq(agreements.quoteRevisionNo, q.decidedRevisionNo),
              ),
            )
        : [];
    return {
      kind: q.status,
      revision: q.decidedRevisionNo,
      byName: who?.name ?? null,
      at: q.decidedAt.toISOString(),
      note: q.decisionNote,
      agreementVersion: agreement?.version ?? null,
    };
  }

  /**
   * Saves the draft. If the latest revision was already sent, this starts a new draft
   * revision instead: what the owner saw never changes. If-Match = the quote's version.
   */
  async save(
    userId: string,
    projectId: string,
    quoteId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<QuoteView> {
    const { project } = await this.requireEditor(userId, projectId);
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    const req = savePipe.transform(body);
    this.assertFuture(req.validUntil, project.timezone);
    await this.db.transaction(async (tx) => {
      const [q] = await tx
        .select()
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.projectId, projectId)))
        .for('update');
      if (!q) throw new NotFoundException('Quote not found');
      if (q.revision !== expected)
        throw new VersionConflictException(q.revision);
      if (q.status === 'accepted' || q.status === 'withdrawn')
        throw new ConflictException(`This quote is ${q.status}`);
      const [latest] = await tx
        .select()
        .from(quoteRevisions)
        .where(
          and(
            eq(quoteRevisions.quoteId, q.id),
            eq(quoteRevisions.revisionNo, q.currentRevision),
          ),
        );
      let revision = q.currentRevision;
      if (latest.sentAt) {
        revision += 1;
        const [next] = await tx
          .insert(quoteRevisions)
          .values({
            quoteId: q.id,
            revisionNo: revision,
            ...this.content(req),
            createdBy: userId,
          })
          .returning({ id: quoteRevisions.id });
        await this.saveCosts(tx, project.organizationId, next.id, req, userId);
      } else {
        await tx
          .update(quoteRevisions)
          .set({
            ...this.content(req),
            updatedAt: new Date(),
            revision: sql`${quoteRevisions.revision} + 1`,
          })
          .where(eq(quoteRevisions.id, latest.id));
        await this.saveCosts(
          tx,
          project.organizationId,
          latest.id,
          req,
          userId,
        );
      }
      await tx
        .update(quotes)
        .set({
          currentRevision: revision,
          updatedAt: new Date(),
          revision: sql`${quotes.revision} + 1`,
        })
        .where(eq(quotes.id, q.id));
    });
    return this.get(userId, projectId, quoteId);
  }

  /** Sends the latest draft revision to the owner; it is frozen from now on. */
  async send(
    userId: string,
    projectId: string,
    quoteId: string,
  ): Promise<QuoteView> {
    const { project } = await this.requireEditor(userId, projectId);
    await this.db.transaction(async (tx) => {
      const [q] = await tx
        .select()
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.projectId, projectId)))
        .for('update');
      if (!q) throw new NotFoundException('Quote not found');
      if (q.status === 'accepted' || q.status === 'withdrawn')
        throw new ConflictException(`This quote is ${q.status}`);
      const [latest] = await tx
        .select()
        .from(quoteRevisions)
        .where(
          and(
            eq(quoteRevisions.quoteId, q.id),
            eq(quoteRevisions.revisionNo, q.currentRevision),
          ),
        );
      if (latest.sentAt)
        throw new ConflictException('This revision was already sent');
      this.assertFuture(latest.validUntil, project.timezone);
      await tx
        .update(quoteRevisions)
        .set({ sentAt: new Date(), sentBy: userId, updatedAt: new Date() })
        .where(eq(quoteRevisions.id, latest.id));
      await tx
        .update(quotes)
        .set({
          status: 'sent',
          updatedAt: new Date(),
          revision: sql`${quotes.revision} + 1`,
        })
        .where(eq(quotes.id, q.id));
      await this.recordAudit(
        tx,
        'quote.sent',
        userId,
        project,
        q,
        latest.revisionNo,
      );
      await recordEvent(
        tx,
        'quote.sent',
        { quoteId: q.id, projectId, revision: latest.revisionNo },
        userId,
      );
    });
    return this.get(userId, projectId, quoteId);
  }

  /** Renders the branded PDF in the reader's language and returns a 5-minute private link. */
  async pdf(
    userId: string,
    projectId: string,
    quoteId: string,
    revision?: number,
  ): Promise<QuotePdfLink> {
    const view = await this.get(userId, projectId, quoteId, revision);
    const { project } = await this.access.requireProject(userId, projectId);
    const [me] = await this.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    const locale = isLocale(me?.locale) ? me.locale : 'en';
    const place =
      [project.location.sector, project.location.district]
        .filter(Boolean)
        .join(', ') || null;
    const file = await renderQuotePdf({
      locale,
      number: view.number,
      revision: view.revision,
      sent: !!view.sentAt,
      date: view.sentAt ?? new Date().toISOString(),
      validUntil: view.validUntil,
      organizationName: view.organizationName,
      clientName: view.clientName,
      projectName: view.projectName,
      projectPlace: place,
      title: view.title,
      scope: view.scope,
      milestones: view.milestones,
      commercialBasis: view.commercialBasis,
      total: view.total,
      currency: view.currency,
      exclusions: view.exclusions,
      terms: view.terms,
      accepted:
        view.decision?.kind === 'accepted' &&
        view.decision.revision === view.revision
          ? {
              byName: view.decision.byName,
              at: view.decision.at,
              agreementVersion: view.decision.agreementVersion,
            }
          : null,
    });
    const key = `orgs/${project.organizationId}/projects/${projectId}/quotes/${quoteId}/r${view.revision}-${locale}.pdf`;
    await this.storage.putObject(key, file, 'application/pdf');
    const expiresInSeconds = 5 * 60;
    return {
      url: await this.storage.createDownloadUrl(key, {
        fileName: `${view.number}-r${view.revision}.pdf`,
        inline: true,
        expiresInSeconds,
      }),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /* ---------- internals ---------- */

  private async requireEditor(userId: string, projectId: string) {
    const access = await this.access.requireProject(userId, projectId);
    if (!access.roles.some((r) => EDITORS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor or project manager can write quotes',
      );
    if (
      access.project.status === 'archived' ||
      access.project.status === 'cancelled'
    )
      throw new ConflictException(`The project is ${access.project.status}`);
    return access;
  }

  private assertFuture(validUntil: string, timezone: string) {
    if (validUntil < todayIn(timezone))
      throw new ConflictException({
        message: 'The validity date must be today or later',
        fieldErrors: [{ field: 'validUntil', message: 'In the past' }],
      });
  }

  private content(req: ReturnType<typeof savePipe.transform>) {
    const milestones = req.milestones.map((m) => ({
      name: m.name,
      description: m.description || null,
      amount: m.amount,
      stageId: m.stageId ?? null,
      basis: m.basis,
      feeBasisPoints:
        m.basis === 'reimbursable' && m.feePercent != null
          ? Math.round(m.feePercent * 100)
          : null,
    }));
    return {
      title: req.title,
      scope: req.scope,
      exclusions: req.exclusions,
      milestones,
      terms: req.terms || null,
      total: milestones.reduce((t, m) => t + m.amount, 0),
      validUntil: req.validUntil,
    };
  }

  /** Private costs, aligned with the milestones; written only by the contractor's side. */
  private async saveCosts(
    tx: Tx,
    organizationId: string,
    quoteRevisionId: string,
    req: ReturnType<typeof savePipe.transform>,
    userId: string,
  ) {
    const costs = req.milestones.map((m) => m.internalCost ?? null);
    await tx
      .insert(quoteInternalCosts)
      .values({ organizationId, quoteRevisionId, costs, createdBy: userId })
      .onConflictDoUpdate({
        target: quoteInternalCosts.quoteRevisionId,
        set: {
          costs,
          updatedAt: new Date(),
          revision: sql`${quoteInternalCosts.revision} + 1`,
        },
      });
  }

  private async internalOf(rev: RevisionRow): Promise<QuoteView['internal']> {
    const [row] = await this.db
      .select({ costs: quoteInternalCosts.costs })
      .from(quoteInternalCosts)
      .where(eq(quoteInternalCosts.quoteRevisionId, rev.id));
    const costs = rev.milestones.map((_, i) => row?.costs[i] ?? null);
    return { costs, ...marginOf(rev.milestones, costs) };
  }

  /** Internal costs belong to the contractor's company: a project role alone is not enough. */
  private async inContractorCompany(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const [m] = await this.db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active'),
        ),
      );
    return !!m;
  }

  private async find(projectId: string, quoteId: string): Promise<QuoteRow> {
    const [q] = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.projectId, projectId)));
    if (!q) throw new NotFoundException('Quote not found');
    return q;
  }

  /** Editors see the latest revision; everyone else the latest sent one (or nothing). */
  private async visibleRevision(
    q: QuoteRow,
    editor: boolean,
  ): Promise<RevisionRow | undefined> {
    const [rev] = await this.db
      .select()
      .from(quoteRevisions)
      .where(
        and(
          eq(quoteRevisions.quoteId, q.id),
          editor ? undefined : isNotNull(quoteRevisions.sentAt),
        ),
      )
      .orderBy(desc(quoteRevisions.revisionNo))
      .limit(1);
    return rev;
  }

  private statusOf(q: QuoteRow, rev: RevisionRow, today: string): QuoteStatus {
    if (
      q.status === 'accepted' ||
      q.status === 'declined' ||
      q.status === 'withdrawn'
    )
      return q.status;
    if (!rev.sentAt) return 'draft';
    return isExpired(rev.validUntil, today) ? 'expired' : 'sent';
  }

  private async ownerName(projectId: string): Promise<string | null> {
    const [o] = await this.db
      .select({ name: users.displayName })
      .from(projectMemberships)
      .innerJoin(users, eq(users.id, projectMemberships.userId))
      .where(
        and(
          eq(projectMemberships.projectId, projectId),
          eq(projectMemberships.role, 'owner'),
          eq(projectMemberships.status, 'active'),
        ),
      );
    return o?.name ?? null;
  }

  private recordAudit(
    tx: Tx,
    action:
      'quote.created' | 'quote.sent' | 'quote.accepted' | 'quote.declined',
    userId: string,
    project: typeof projects.$inferSelect,
    q: QuoteRow,
    revision: number,
  ) {
    return this.audit.record(tx, {
      action,
      actor: { userId },
      organizationId: project.organizationId,
      projectId: project.id,
      target: { type: 'quote', id: q.id },
      metadata: { number: q.number, revision },
    });
  }
}

/** Quotes, agreements and their PDFs hold the prices: only people who see the money read them. */
export function requireMoneyReader(a: {
  roles: readonly ProjectRole[];
  financialVisibility: boolean;
}) {
  if (!seesMoney(a.roles, a.financialVisibility))
    throw new ForbiddenException(
      'Quotes and agreements are for people who can see this project’s money',
    );
}
