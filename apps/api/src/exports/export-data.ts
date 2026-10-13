import type {
  ContractFigures,
  ProjectMoney,
  ProjectRole,
  StageDisplayStatus,
} from '@jengalink/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '../db/client';
import {
  agreements,
  budgetChangeDecisions,
  budgetChanges,
  claimDecisions,
  claimRevisions,
  claims,
  expenses,
  organizations,
  payments,
  projectMemberships,
  projects,
  spendingDecisions,
  spendingRequests,
  stages,
  users,
} from '../db/schema';
import type { MoneyService } from '../money/money.service';
import type { SiteUpdatesService } from '../updates/site-updates.service';

export interface SummaryData {
  name: string;
  organizationName: string;
  place: string | null;
  status: string;
  progress: { accepted: number; reported: number };
  stages: {
    name: string;
    weight: number;
    status: StageDisplayStatus;
    plannedStart: string | null;
    plannedEnd: string | null;
  }[];
  team: { name: string; role: ProjectRole }[];
  /** Null when money is left out (the requester may not see it) or there is no agreement yet. */
  money: ContractFigures | null;
  spending: ProjectMoney['spending'];
  agreements:
    { version: number; date: Date; value: number; ref: string }[] | null;
}

/** One line of the money history: what happened to money, when, by whom. */
export interface HistoryRow {
  at: Date;
  type:
    | 'agreement'
    | 'claim_sent'
    | 'claim_approved'
    | 'claim_rejected'
    | 'claim_changes_requested'
    | 'spending_approved'
    | 'spending_rejected'
    | 'spending_changes_requested'
    | 'expense'
    | 'payment_recorded'
    | 'payment_settled'
    | 'payment_disputed'
    | 'change_applied'
    | 'change_rejected';
  ref: string;
  details: string;
  amount: number | null;
  by: string | null;
}

const nameOf = async (tx: Tx, ids: (string | null)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length
    ? await tx
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, list))
    : [];
  const map = new Map(rows.map((r) => [r.id, r.name]));
  return (id: string | null) => (id ? (map.get(id) ?? null) : null);
};

export async function summaryOf(
  tx: Tx,
  projectId: string,
  withMoney: boolean,
  deps: { money: MoneyService; updates: SiteUpdatesService },
): Promise<SummaryData> {
  const [p] = await tx
    .select({ p: projects, org: organizations.name })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(eq(projects.id, projectId));
  const progress = await deps.updates.progressOf(projectId, tx);
  const stageRows = await tx
    .select()
    .from(stages)
    .where(eq(stages.projectId, projectId))
    .orderBy(asc(stages.position));
  const team = await tx
    .select({ name: users.displayName, role: projectMemberships.role })
    .from(projectMemberships)
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.status, 'active'),
      ),
    );
  const money = withMoney ? await deps.money.snapshot(projectId, tx) : null;
  const versions = withMoney
    ? await tx
        .select({ a: agreements, change: budgetChanges.number })
        .from(agreements)
        .leftJoin(budgetChanges, eq(budgetChanges.id, agreements.changeId))
        .where(eq(agreements.projectId, projectId))
        .orderBy(asc(agreements.version))
    : null;
  const loc = p.p.location;
  return {
    name: p.p.name,
    organizationName: p.org,
    place:
      [loc.sector, loc.district, loc.province].filter(Boolean).join(', ') ||
      null,
    status: p.p.status,
    progress: {
      accepted: progress.acceptedPercent,
      reported: progress.reportedPercent,
    },
    stages: stageRows.map((s) => ({
      name: s.name,
      weight: s.weight,
      status:
        progress.stages.find((x) => x.id === s.id)?.displayStatus ?? 'planned',
      plannedStart: s.plannedStart,
      plannedEnd: s.plannedEnd,
    })),
    team: team.map((m) => ({ name: m.name ?? '—', role: m.role })),
    money: money?.figures ?? null,
    spending: money?.spending ?? null,
    agreements:
      versions?.map(({ a, change }) => ({
        version: a.version,
        date: a.createdAt,
        value: a.contractValue,
        ref: change ?? `${a.quoteNumber} r${a.quoteRevisionNo}`,
      })) ?? null,
  };
}

/** Every money event of the project, oldest first. Drafts never appear. */
export async function historyOf(
  tx: Tx,
  projectId: string,
): Promise<HistoryRow[]> {
  const out: HistoryRow[] = [];
  const claimRows = await tx
    .select()
    .from(claims)
    .where(eq(claims.projectId, projectId));
  const claimNo = new Map(claimRows.map((c) => [c.id, c.number]));
  const claimIds = claimRows.map((c) => c.id);
  const sent = claimIds.length
    ? await tx
        .select()
        .from(claimRevisions)
        .where(inArray(claimRevisions.claimId, claimIds))
    : [];
  const answers = claimIds.length
    ? await tx
        .select()
        .from(claimDecisions)
        .where(inArray(claimDecisions.claimId, claimIds))
    : [];
  const requests = await tx
    .select()
    .from(spendingRequests)
    .where(eq(spendingRequests.projectId, projectId));
  const reqNo = new Map(requests.map((r) => [r.id, r]));
  const spendAnswers = requests.length
    ? await tx
        .select()
        .from(spendingDecisions)
        .where(
          inArray(
            spendingDecisions.requestId,
            requests.map((r) => r.id),
          ),
        )
    : [];
  const expenseRows = await tx
    .select()
    .from(expenses)
    .where(eq(expenses.projectId, projectId));
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(eq(payments.projectId, projectId));
  const changeRows = await tx
    .select()
    .from(budgetChanges)
    .where(eq(budgetChanges.projectId, projectId));
  const changeNo = new Map(changeRows.map((c) => [c.id, c.number]));
  const changeAnswers = changeRows.length
    ? await tx
        .select()
        .from(budgetChangeDecisions)
        .where(
          inArray(
            budgetChangeDecisions.changeId,
            changeRows.map((c) => c.id),
          ),
        )
    : [];
  const accepter = alias(users, 'accepter');
  const versions = await tx
    .select({
      a: agreements,
      by: accepter.displayName,
      change: budgetChanges.number,
    })
    .from(agreements)
    .leftJoin(accepter, eq(accepter.id, agreements.acceptedBy))
    .leftJoin(budgetChanges, eq(budgetChanges.id, agreements.changeId))
    .where(eq(agreements.projectId, projectId));
  const who = await nameOf(tx, [
    ...sent.map((r) => r.createdBy),
    ...answers.map((r) => r.actorId),
    ...spendAnswers.map((r) => r.actorId),
    ...expenseRows.map((r) => r.createdBy),
    ...paymentRows.flatMap((r) => [r.createdBy, r.verifiedBy]),
    ...changeAnswers.map((r) => r.actorId),
  ]);

  for (const { a, by, change } of versions)
    out.push({
      at: a.createdAt,
      type: 'agreement',
      ref: `v${a.version} · ${change ?? a.quoteNumber}`,
      details: a.title,
      amount: a.contractValue,
      by,
    });
  for (const r of sent)
    out.push({
      at: r.createdAt,
      type: 'claim_sent',
      ref: `${claimNo.get(r.claimId) ?? ''}${r.revisionNo > 1 ? ` r${r.revisionNo}` : ''}`,
      details: r.changeNote
        ? `${r.milestoneName} — ${r.changeNote}`
        : r.milestoneName,
      amount: r.amount,
      by: who(r.createdBy),
    });
  for (const d of answers)
    out.push({
      at: d.createdAt,
      type: `claim_${d.kind}`,
      ref: claimNo.get(d.claimId) ?? '',
      details: d.note ?? '',
      amount: d.amount,
      by: who(d.actorId),
    });
  for (const d of spendAnswers) {
    const r = reqNo.get(d.requestId);
    out.push({
      at: d.createdAt,
      type: `spending_${d.kind}`,
      ref: r?.number ?? '',
      details: d.note ?? r?.purpose ?? '',
      amount: d.amount,
      by: who(d.actorId),
    });
  }
  for (const e of expenseRows)
    out.push({
      at: e.createdAt,
      type: 'expense',
      ref: `${e.number} · ${reqNo.get(e.requestId)?.number ?? ''}`,
      details: [e.description, e.supplierName].filter(Boolean).join(' · '),
      amount: e.amount,
      by: who(e.createdBy),
    });
  for (const p of paymentRows) {
    out.push({
      at: p.createdAt,
      type: 'payment_recorded',
      ref: `${p.number}${p.claimId ? ` · ${claimNo.get(p.claimId) ?? ''}` : ''}`,
      details: [
        p.method.replace(/_/g, ' '),
        p.reference,
        `${p.payer} → ${p.beneficiary}`,
      ]
        .filter(Boolean)
        .join(' · '),
      amount: p.amount,
      by: who(p.createdBy),
    });
    if (p.verifiedAt && (p.status === 'settled' || p.status === 'disputed'))
      out.push({
        at: p.verifiedAt,
        type: p.status === 'settled' ? 'payment_settled' : 'payment_disputed',
        ref: p.number,
        details: p.verificationNote ?? '',
        amount: p.amount,
        by: who(p.verifiedBy),
      });
  }
  for (const d of changeAnswers)
    out.push({
      at: d.createdAt,
      type: d.kind === 'approved' ? 'change_applied' : 'change_rejected',
      ref: changeNo.get(d.changeId) ?? '',
      details: d.note ?? '',
      amount: d.netDelta,
      by: who(d.actorId),
    });
  return out.sort((x, y) => x.at.getTime() - y.at.getTime());
}
