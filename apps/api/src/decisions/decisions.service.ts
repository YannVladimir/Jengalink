import { Inject, Injectable } from '@nestjs/common';
import type {
  DecisionInbox,
  DecisionItem,
  ProjectRole,
} from '@jengalink/contracts';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { DB } from '../db/database.module';
import {
  budgetChanges,
  claims,
  expenses,
  payments,
  projectMemberships,
  projects,
  quoteRevisions,
  quotes,
  receipts,
  spendingRequests,
  stageReviews,
  stages,
} from '../db/schema';

const CLIENT: readonly ProjectRole[] = ['owner', 'delegate'];
const CONTRACTOR: readonly ProjectRole[] = ['contractor', 'manager'];
const RECEIPT_REVIEWERS: readonly ProjectRole[] = [
  'owner',
  'delegate',
  'finance',
];
const OPEN = ['draft', 'active', 'handover'] as const;
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
const iso = (d: Date | string | null | undefined, fallback: Date) =>
  new Date(d ?? fallback).toISOString();

/**
 * The decision inbox (spec §4.2, §5): everything waiting on this person, across their projects,
 * oldest first. Each kind follows the rule of the screen where it is decided, so nothing appears
 * here that the person could not act on.
 */
@Injectable()
export class DecisionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async inbox(userId: string): Promise<DecisionInbox> {
    const rows = await this.db
      .select({ p: projects, role: projectMemberships.role })
      .from(projectMemberships)
      .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
      .where(
        and(
          eq(projectMemberships.userId, userId),
          eq(projectMemberships.status, 'active'),
          inArray(projects.status, [...OPEN]),
        ),
      );
    const byProject = new Map<
      string,
      { p: typeof projects.$inferSelect; roles: ProjectRole[] }
    >();
    for (const r of rows) {
      const e = byProject.get(r.p.id) ?? { p: r.p, roles: [] };
      e.roles.push(r.role);
      byProject.set(r.p.id, e);
    }
    const items: DecisionItem[] = [];
    for (const { p, roles } of byProject.values())
      items.push(...(await this.forProject(p, userId, roles)));
    items.sort((a, b) => a.since.localeCompare(b.since));
    return { count: items.length, oldestSince: items[0]?.since ?? null, items };
  }

  private async forProject(
    p: typeof projects.$inferSelect,
    userId: string,
    roles: readonly ProjectRole[],
  ): Promise<DecisionItem[]> {
    const out: DecisionItem[] = [];
    const base = `/project/${p.id}`;
    const add = (i: Omit<DecisionItem, 'projectId' | 'projectName'>) =>
      out.push({ ...i, projectId: p.id, projectName: p.name });
    const client = roles.some((r) => CLIENT.includes(r));
    const contractorSide = roles.some((r) => CONTRACTOR.includes(r));
    // Money decisions are the client's, and never one's own side's.
    const decider = client && !contractorSide;

    // The owner accepts the baseline (contract value + stage plan).
    if (
      p.status === 'draft' &&
      roles.includes('owner') &&
      p.contractValue !== null
    ) {
      const [{ n }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(stages)
        .where(eq(stages.projectId, p.id));
      if (n > 0)
        add({
          kind: 'accept_project',
          title: p.name,
          amount: p.contractValue,
          since: iso(p.updatedAt, p.createdAt),
          path: `${base}/accept`,
        });
    }

    if (client) {
      // Quotes sent and still valid.
      const today = todayIn(p.timezone);
      const sent = await this.db
        .select({ q: quotes, r: quoteRevisions })
        .from(quotes)
        .innerJoin(quoteRevisions, eq(quoteRevisions.quoteId, quotes.id))
        .where(
          and(
            eq(quotes.projectId, p.id),
            eq(quotes.status, 'sent'),
            isNotNull(quoteRevisions.sentAt),
          ),
        )
        .orderBy(desc(quoteRevisions.revisionNo));
      const seen = new Set<string>();
      for (const { q, r } of sent) {
        if (seen.has(q.id)) continue;
        seen.add(q.id);
        if (r.validUntil >= today)
          add({
            kind: 'quote',
            title: `${q.number} · ${r.title}`,
            amount: r.total,
            since: iso(r.sentAt, q.createdAt),
            path: `${base}/quotes/${q.id}`,
          });
      }

      // Stages sent for review.
      const ready = await this.db
        .select({
          id: stages.id,
          name: stages.name,
          since: sql<Date | null>`max(${stageReviews.createdAt})`,
        })
        .from(stages)
        .leftJoin(
          stageReviews,
          and(
            eq(stageReviews.stageId, stages.id),
            eq(stageReviews.kind, 'submitted'),
          ),
        )
        .where(
          and(
            eq(stages.projectId, p.id),
            eq(stages.status, 'ready_for_review'),
          ),
        )
        .groupBy(stages.id, stages.name);
      for (const s of ready)
        add({
          kind: 'stage_review',
          title: s.name,
          amount: null,
          since: iso(s.since, p.updatedAt),
          path: `${base}/stages/${s.id}`,
        });
    }

    if (decider) {
      for (const c of await this.db
        .select()
        .from(claims)
        .where(and(eq(claims.projectId, p.id), eq(claims.status, 'submitted'))))
        add({
          kind: 'claim',
          title: `${c.number} · ${c.milestoneName}`,
          amount: c.amount,
          since: iso(c.submittedAt, c.updatedAt),
          path: `${base}/claims/${c.id}`,
        });
      for (const r of await this.db
        .select()
        .from(spendingRequests)
        .where(
          and(
            eq(spendingRequests.projectId, p.id),
            eq(spendingRequests.status, 'submitted'),
          ),
        ))
        add({
          kind: 'spending',
          title: `${r.number} · ${r.purpose}`,
          amount: r.amount,
          since: iso(r.submittedAt, r.updatedAt),
          path: `${base}/spending/${r.id}`,
        });
      for (const c of await this.db
        .select()
        .from(budgetChanges)
        .where(
          and(
            eq(budgetChanges.projectId, p.id),
            eq(budgetChanges.status, 'submitted'),
          ),
        ))
        add({
          kind: 'change',
          title: c.number,
          amount: c.netDelta,
          since: iso(c.submittedAt, c.updatedAt),
          path: `${base}/changes/${c.id}`,
        });
    }

    // Payments to confirm: finance, or the other side from the one that recorded it, never the recorder.
    const side = client
      ? 'client'
      : contractorSide
        ? 'contractor'
        : roles.includes('finance')
          ? 'finance'
          : null;
    if (side)
      for (const pay of await this.db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.projectId, p.id),
            eq(payments.status, 'pending_verification'),
          ),
        )) {
        const mine =
          pay.createdBy !== userId &&
          (roles.includes('finance') ||
            (side !== 'finance' && side !== pay.recordedSide));
        if (mine)
          add({
            kind: 'payment',
            title: pay.number,
            amount: pay.amount,
            since: pay.createdAt.toISOString(),
            path: `${base}/payments`,
          });
      }

    // Receipts to review: owner, delegate or finance, never the person who captured it.
    if (roles.some((r) => RECEIPT_REVIEWERS.includes(r)))
      for (const { r, requestId } of await this.db
        .select({ r: receipts, requestId: expenses.requestId })
        .from(receipts)
        .innerJoin(expenses, eq(expenses.id, receipts.expenseId))
        .where(
          and(eq(expenses.projectId, p.id), eq(receipts.status, 'captured')),
        ))
        if (r.createdBy !== userId)
          add({
            kind: 'receipt',
            title: `${r.supplierName} · ${r.invoiceNumber}`,
            amount: r.total,
            since: r.createdAt.toISOString(),
            path: `${base}/spending/${requestId}`,
          });

    return out;
  }
}
