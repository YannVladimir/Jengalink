import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type ContractFigures,
  costBudgetOf,
  type MoneyAcross,
  type MoneyActions,
  type MoneyClaim,
  type MoneySide,
  type ProjectMoney,
  type ProjectMoneyRow,
  type ProjectRole,
  stillToCome,
} from '@jengalink/contracts';
import { and, desc, eq, inArray, isNull, ne, or, gt, sql } from 'drizzle-orm';
import type { Database, Tx } from '../db/client';
import { DB } from '../db/database.module';
import {
  agreements,
  budgetMovements,
  claimDecisions,
  claims,
  expenses,
  organizations,
  payments,
  projectMemberships,
  projects,
  receipts,
  spendingRequests,
} from '../db/schema';
import type { QuoteMilestone } from '../db/schema';
import { AccessService } from '../projects/access.service';

const CLIENT: readonly ProjectRole[] = ['owner', 'delegate'];
const CONTRACTOR: readonly ProjectRole[] = ['contractor', 'manager'];
const CAPTURERS: readonly ProjectRole[] = ['contractor', 'manager', 'finance'];
type ProjectRow = typeof projects.$inferSelect;
type Who = { userId: string; roles: readonly ProjectRole[] };

const sideOf = (roles: readonly ProjectRole[]): MoneySide | null =>
  roles.some((r) => CLIENT.includes(r))
    ? 'client'
    : roles.some((r) => CONTRACTOR.includes(r))
      ? 'contractor'
      : roles.includes('finance')
        ? 'finance'
        : null;

/**
 * The Money screen (spec §4.4, §36.1): contract money from claims, the owner's answers and
 * confirmed payments; what waits on the caller. Everything is computed from records; contractor
 * internal costs never appear (spec §37.3).
 */
@Injectable()
export class MoneyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
  ) {}

  async project(userId: string, projectId: string): Promise<ProjectMoney> {
    const { project, roles, financialVisibility } =
      await this.access.requireProject(userId, projectId);
    const side = sideOf(roles) ?? (financialVisibility ? 'finance' : null);
    if (!side)
      throw new ForbiddenException('You cannot see this project’s money');
    const who = { userId, roles };
    const claimRows = await this.claimsOf(projectId);
    const paymentRows = await this.db
      .select({ p: payments, claimNumber: claims.number })
      .from(payments)
      .leftJoin(claims, eq(claims.id, payments.claimId))
      .where(eq(payments.projectId, projectId))
      .orderBy(desc(payments.createdAt));
    return {
      projectId,
      projectName: project.name,
      currency: 'RWF',
      side,
      figures: this.figures(
        project,
        claimRows,
        paymentRows.map((r) => r.p),
      ),
      spending: await this.spendingOf(projectId),
      claims: await this.claimViews(
        claimRows,
        paymentRows.map((r) => r.p),
      ),
      payments: paymentRows.slice(0, 5).map(({ p, claimNumber }) => ({
        id: p.id,
        number: p.number,
        amount: p.amount,
        method: p.method,
        status: p.status,
        claimNumber,
        paymentDate: p.paymentDate,
      })),
      actions: await this.actionsOf(
        project,
        who,
        paymentRows.map((r) => r.p),
      ),
    };
  }

  /** Every project the caller can see money on, with what is owed and what waits on them. */
  async across(userId: string): Promise<MoneyAcross> {
    const rows = await this.db
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
          or(
            isNull(projectMemberships.expiresAt),
            gt(projectMemberships.expiresAt, new Date()),
          ),
        ),
      )
      .orderBy(desc(projects.updatedAt));
    const grouped = new Map<
      string,
      { p: ProjectRow; orgName: string; roles: ProjectRole[]; finance: boolean }
    >();
    for (const r of rows) {
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
    const list: ProjectMoneyRow[] = [];
    for (const { p, orgName, roles, finance } of grouped.values()) {
      const side = sideOf(roles) ?? (finance ? 'finance' : null);
      if (!side) continue;
      const claimRows = await this.claimsOf(p.id);
      const paymentRows = await this.db
        .select()
        .from(payments)
        .where(eq(payments.projectId, p.id));
      list.push({
        projectId: p.id,
        projectName: p.name,
        organizationName: orgName,
        side,
        figures: this.figures(p, claimRows, paymentRows),
        actions: await this.actionsOf(p, { userId, roles }, paymentRows),
      });
    }
    const sum = (f: (r: ProjectMoneyRow) => number) =>
      list.reduce((t, r) => t + f(r), 0);
    return {
      currency: 'RWF',
      owedToMe: sum((r) =>
        r.side === 'contractor' ? r.figures.approvedUnpaid : 0,
      ),
      owedByMe: sum((r) =>
        r.side === 'client' ? r.figures.approvedUnpaid : 0,
      ),
      awaitingDecision: sum((r) => r.figures.awaitingDecision),
      pendingVerification: sum((r) => r.figures.pendingVerification),
      actions: {
        claimsToDecide: sum((r) => r.actions.claimsToDecide),
        paymentsToConfirm: sum((r) => r.actions.paymentsToConfirm),
        spendingToDecide: sum((r) => r.actions.spendingToDecide),
        receiptsMissing: sum((r) => r.actions.receiptsMissing),
      },
      // Projects with something owed or waiting first.
      projects: list.sort(
        (a, b) =>
          b.figures.approvedUnpaid +
          b.figures.awaitingDecision -
          (a.figures.approvedUnpaid + a.figures.awaitingDecision),
      ),
    };
  }

  /** Contract figures and the cost + fee line, without an access check (callers check first). */
  async snapshot(
    projectId: string,
    /** Read inside the caller's transaction (an export's consistent snapshot). */
    db: Database | Tx = this.db,
  ): Promise<{
    figures: ContractFigures | null;
    spending: ProjectMoney['spending'];
  }> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    const claimRows = await this.claimsOf(projectId, db);
    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.projectId, projectId));
    const figures = this.figures(project, claimRows, paymentRows);
    return {
      figures: figures.contract > 0 ? figures : null,
      spending: await this.spendingOf(projectId, db),
    };
  }

  /* ---------- internals ---------- */

  /** Claims that are money: sent at least once, not withdrawn. Drafts stay private. */
  private claimsOf(projectId: string, db: Database | Tx = this.db) {
    return db
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.projectId, projectId),
          ne(claims.status, 'draft'),
          ne(claims.status, 'cancelled'),
        ),
      )
      .orderBy(desc(claims.createdAt));
  }

  private figures(
    project: ProjectRow,
    claimRows: (typeof claims.$inferSelect)[],
    paymentRows: (typeof payments.$inferSelect)[],
  ): ContractFigures {
    const settledOn = (claimId: string) =>
      paymentRows
        .filter((p) => p.claimId === claimId && p.status === 'settled')
        .reduce((t, p) => t + p.amount, 0);
    const counted = claimRows.filter(
      (c) => c.status === 'approved' || c.status === 'paid',
    );
    const paid = counted.reduce((t, c) => t + settledOn(c.id), 0);
    const approvedUnpaid = counted
      .filter((c) => c.status === 'approved')
      .reduce((t, c) => t + Math.max(0, c.amount - settledOn(c.id)), 0);
    const awaitingDecision = claimRows
      .filter((c) => c.status === 'submitted')
      .reduce((t, c) => t + c.amount, 0);
    const contract = project.contractValue ?? 0;
    return {
      contract,
      paid,
      approvedUnpaid,
      awaitingDecision,
      stillToCome: stillToCome({ contract, paid, approvedUnpaid }),
      pendingVerification: paymentRows
        .filter((p) => p.status === 'pending_verification')
        .reduce((t, p) => t + p.amount, 0),
      advances: paymentRows
        .filter((p) => !p.claimId && p.status === 'settled')
        .reduce((t, p) => t + p.amount, 0),
    };
  }

  /** Dates for the step tracker: sent, approved (this revision), paid in full. */
  private async claimViews(
    claimRows: (typeof claims.$inferSelect)[],
    paymentRows: (typeof payments.$inferSelect)[],
  ): Promise<MoneyClaim[]> {
    if (!claimRows.length) return [];
    const approvals = await this.db
      .select({
        claimId: claimDecisions.claimId,
        revisionNo: claimDecisions.revisionNo,
        at: claimDecisions.createdAt,
      })
      .from(claimDecisions)
      .where(
        and(
          inArray(
            claimDecisions.claimId,
            claimRows.map((c) => c.id),
          ),
          eq(claimDecisions.kind, 'approved'),
        ),
      )
      .orderBy(desc(claimDecisions.createdAt));
    return claimRows.map((c) => {
      const mine = paymentRows.filter((p) => p.claimId === c.id);
      const settled = mine.filter((p) => p.status === 'settled');
      const approved = approvals.find(
        (a) => a.claimId === c.id && a.revisionNo === c.revisionNo,
      );
      const lastSettled = settled
        .map((p) => p.verifiedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        id: c.id,
        number: c.number,
        milestoneName: c.milestoneName,
        amount: c.amount,
        status: c.status,
        paid: settled.reduce((t, p) => t + p.amount, 0),
        requestedAt: (c.submittedAt ?? c.createdAt).toISOString(),
        approvedAt:
          (c.status === 'approved' || c.status === 'paid') && approved
            ? approved.at.toISOString()
            : null,
        paidAt:
          c.status === 'paid' && lastSettled ? lastSettled.toISOString() : null,
        disputedStep:
          c.status === 'changes_requested' || c.status === 'rejected'
            ? 'approved'
            : c.status === 'approved' &&
                mine.some((p) => p.status === 'disputed')
              ? 'paid'
              : null,
      };
    });
  }

  private async spendingOf(
    projectId: string,
    db: Database | Tx = this.db,
  ): Promise<ProjectMoney['spending']> {
    const [a] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.projectId, projectId))
      .orderBy(desc(agreements.version))
      .limit(1);
    const packages = (a?.milestones ?? []).filter(
      (m: QuoteMilestone) => m.basis === 'reimbursable',
    );
    if (!packages.length) return null;
    const costBudget = packages.reduce(
      (t, m) =>
        t +
        costBudgetOf(
          m.amount,
          m.feeBasisPoints != null ? m.feeBasisPoints / 100 : null,
        ),
      0,
    );
    const sums = await db
      .select({
        kind: budgetMovements.kind,
        total: sql<string>`coalesce(sum(${budgetMovements.amount}), 0)`,
      })
      .from(budgetMovements)
      .where(eq(budgetMovements.projectId, projectId))
      .groupBy(budgetMovements.kind);
    const of = (k: string) =>
      Number(sums.find((s) => s.kind === k)?.total ?? 0);
    return {
      costBudget,
      posted: of('convert'),
      committed: of('reserve') - of('convert') - of('release'),
    };
  }

  /** What waits on this person here; each mirrors the rule of the screen where it is done. */
  private async actionsOf(
    project: ProjectRow,
    { userId, roles }: Who,
    paymentRows: (typeof payments.$inferSelect)[],
  ): Promise<MoneyActions> {
    const mySide = sideOf(roles);
    const contractorSide = roles.some((r) => CONTRACTOR.includes(r));
    const decider = roles.some((r) => CLIENT.includes(r)) && !contractorSide;
    const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const claimsToDecide = decider
      ? await count(
          this.db
            .select({ n: sql<number>`count(*)::int` })
            .from(claims)
            .where(
              and(
                eq(claims.projectId, project.id),
                eq(claims.status, 'submitted'),
              ),
            ),
        )
      : 0;
    const spendingToDecide = decider
      ? await count(
          this.db
            .select({ n: sql<number>`count(*)::int` })
            .from(spendingRequests)
            .where(
              and(
                eq(spendingRequests.projectId, project.id),
                eq(spendingRequests.status, 'submitted'),
              ),
            ),
        )
      : 0;
    const paymentsToConfirm = paymentRows.filter(
      (p) =>
        p.status === 'pending_verification' &&
        p.createdBy !== userId &&
        (roles.includes('finance') ||
          (mySide !== null &&
            mySide !== 'finance' &&
            mySide !== p.recordedSide)),
    ).length;
    const receiptsMissing = roles.some((r) => CAPTURERS.includes(r))
      ? await count(
          this.db
            .select({ n: sql<number>`count(*)::int` })
            .from(expenses)
            .leftJoin(receipts, eq(receipts.expenseId, expenses.id))
            .where(
              and(eq(expenses.projectId, project.id), isNull(receipts.id)),
            ),
        )
      : 0;
    return {
      claimsToDecide,
      paymentsToConfirm,
      spendingToDecide,
      receiptsMissing,
    };
  }
}
