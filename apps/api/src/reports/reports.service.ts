import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GenerateReportRequest,
  type ProjectRole,
  type QuotePdfLink,
  type ReportDecision,
  type ReportPhoto,
  type WeeklyReportData,
  type WeeklyReportSummary,
  type WeeklyReportView,
  weekOf,
} from '@jengalink/contracts';
import { isLocale } from '@jengalink/i18n';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import type { Database } from '../db/client';
import { DB } from '../db/database.module';
import {
  budgetChanges,
  claims,
  media,
  organizations,
  payments,
  projects,
  siteUpdates,
  spendingRequests,
  stageReviews,
  stages,
  users,
  weeklyReports,
} from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { MoneyService } from '../money/money.service';
import { type ReportPdfData, renderWeeklyReportPdf } from '../pdf/report-pdf';
import { AccessService, seesMoney } from '../projects/access.service';
import { StorageService } from '../storage/storage.service';
import { SiteUpdatesService } from '../updates/site-updates.service';

/** Who writes the week's report: whoever reports from site. */
const REPORTERS: readonly ProjectRole[] = [
  'contractor',
  'supervisor',
  'manager',
];
const CLIENT: readonly ProjectRole[] = ['owner', 'delegate'];
/** The parties to the project share its reports; a site supervisor does not. */
export const SHARERS: readonly ProjectRole[] = [
  ...CLIENT,
  'contractor',
  'manager',
];
/** Who may see a report's money: the project rule (kept under this name for its callers). */
export const seesReportMoney = seesMoney;
const generatePipe = new ZodPipe(GenerateReportRequest);
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
type ReportRow = typeof weeklyReports.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

/**
 * The one-tap weekly report (spec §14, §15, A0). Generating freezes the week as a snapshot of
 * records: accepted progress, the tower, money, the week's work, decisions waiting, photos and
 * what comes next. The PDF draws it on one page in the reader's language.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly updates: SiteUpdatesService,
    private readonly money: MoneyService,
  ) {}

  async list(
    userId: string,
    projectId: string,
  ): Promise<WeeklyReportSummary[]> {
    await this.access.requireProject(userId, projectId);
    const rows = await this.rows(projectId);
    // The latest revision of each week, newest week first.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows)
      if (!latest.has(r.r.weekStart)) latest.set(r.r.weekStart, r);
    return [...latest.values()].map((r) => this.summary(r));
  }

  async generate(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<WeeklyReportView> {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => REPORTERS.includes(r)))
      throw new ForbiddenException(
        'Only the contractor, site supervisor or project manager can generate the weekly report',
      );
    const req = generatePipe.transform(body);
    const { start, end } = weekOf(req.weekOf ?? todayIn(project.timezone));
    const data = await this.snapshot(project, start, end);
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`reports:${projectId}:${start}`}))`,
      );
      const [{ n }] = await tx
        .select({
          n: sql<number>`coalesce(max(${weeklyReports.revisionNo}), 0)::int`,
        })
        .from(weeklyReports)
        .where(
          and(
            eq(weeklyReports.projectId, projectId),
            eq(weeklyReports.weekStart, start),
          ),
        );
      const [r] = await tx
        .insert(weeklyReports)
        .values({
          organizationId: project.organizationId,
          projectId,
          weekStart: start,
          weekEnd: end,
          revisionNo: n + 1,
          data,
          createdBy: userId,
        })
        .returning({ id: weeklyReports.id });
      await this.audit.record(tx, {
        action: 'report.generated',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'weekly_report', id: r.id },
        metadata: { weekStart: start, revision: n + 1 },
      });
      await recordEvent(
        tx,
        'report.published',
        { reportId: r.id, projectId, weekStart: start },
        userId,
      );
      return r.id;
    });
    return this.get(userId, projectId, id);
  }

  async get(
    userId: string,
    projectId: string,
    reportId: string,
  ): Promise<WeeklyReportView> {
    const { roles, financialVisibility } = await this.access.requireProject(
      userId,
      projectId,
    );
    const row = await this.row(projectId, reportId);
    const seesMoney = seesReportMoney(roles, financialVisibility);
    const data: WeeklyReportData = seesMoney
      ? row.r.data
      : {
          ...row.r.data,
          money: null,
          spending: null,
          // What waits for a decision stays listed, without its amounts.
          decisions: row.r.data.decisions.map((d) => ({ ...d, amount: null })),
        };
    return {
      ...this.summary(row),
      projectId,
      data,
      photos: await this.photos(row.r.data.photoIds),
      canAcknowledge:
        roles.some((r) => CLIENT.includes(r)) && !row.r.acknowledgedAt,
      canShare: roles.some((r) => SHARERS.includes(r)),
    };
  }

  /** The owner marks the report reviewed (once; repeating it changes nothing). */
  async acknowledge(
    userId: string,
    projectId: string,
    reportId: string,
  ): Promise<WeeklyReportView> {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => CLIENT.includes(r)))
      throw new ForbiddenException(
        'Only the owner (or their delegate) marks a report reviewed',
      );
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(weeklyReports)
        .where(
          and(
            eq(weeklyReports.id, reportId),
            eq(weeklyReports.projectId, projectId),
          ),
        )
        .for('update');
      if (!r) throw new NotFoundException('Report not found');
      if (r.acknowledgedAt) return;
      await tx
        .update(weeklyReports)
        .set({
          acknowledgedBy: userId,
          acknowledgedAt: new Date(),
          updatedAt: new Date(),
          revision: sql`${weeklyReports.revision} + 1`,
        })
        .where(eq(weeklyReports.id, r.id));
      await this.audit.record(tx, {
        action: 'report.acknowledged',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'weekly_report', id: r.id },
        metadata: { weekStart: r.weekStart },
      });
    });
    return this.get(userId, projectId, reportId);
  }

  /** The one-page PDF in the reader's language, as a 5-minute private link. */
  async pdf(
    userId: string,
    projectId: string,
    reportId: string,
  ): Promise<QuotePdfLink> {
    const view = await this.get(userId, projectId, reportId);
    const { project } = await this.access.requireProject(userId, projectId);
    const [me] = await this.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    const locale = isLocale(me?.locale) ? me.locale : 'en';
    // Money is only drawn for readers who may see it, so the file name says which version this is.
    return this.pdfLink(
      `orgs/${project.organizationId}/projects/${projectId}/reports/${reportId}-${locale}-${view.data.money ? 'm' : 'n'}.pdf`,
      {
        locale,
        weekStart: view.weekStart,
        weekEnd: view.weekEnd,
        revisionNo: view.revisionNo,
        generatedByName: view.generatedByName,
        generatedAt: view.generatedAt,
        data: view.data,
      },
    );
  }

  /** Draws the PDF, stores it under `key` and returns a 5-minute link. */
  async pdfLink(
    key: string,
    input: Omit<ReportPdfData, 'photos'>,
  ): Promise<QuotePdfLink> {
    const file = await renderWeeklyReportPdf({
      ...input,
      photos: await this.thumbs(input.data.photoIds),
    });
    await this.storage.putObject(key, file, 'application/pdf');
    const expiresInSeconds = 5 * 60;
    return {
      url: await this.storage.createDownloadUrl(key, {
        fileName: `weekly-report-${input.weekStart}.pdf`,
        inline: true,
        expiresInSeconds,
      }),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /** One report row with the generator's and acknowledger's names (404 when not in this project). */
  async row(projectId: string, reportId: string) {
    const [row] = await this.rows(projectId, reportId);
    if (!row) throw new NotFoundException('Report not found');
    return row;
  }

  /** Thumbnail links only (metadata stripped), for people outside the project. */
  async thumbPhotos(ids: string[]): Promise<ReportPhoto[]> {
    return (await this.photos(ids, true)).filter((p) => p.thumbUrl);
  }

  /* ---------- internals ---------- */

  /** Builds the week from records. */
  private async snapshot(
    project: ProjectRow,
    start: string,
    end: string,
  ): Promise<WeeklyReportData> {
    const projectId = project.id;
    const progress = await this.updates.progressOf(projectId);
    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId));
    const [previous] = await this.db
      .select({ data: weeklyReports.data })
      .from(weeklyReports)
      .where(
        and(
          eq(weeklyReports.projectId, projectId),
          sql`${weeklyReports.weekStart} < ${start}`,
        ),
      )
      .orderBy(desc(weeklyReports.weekStart), desc(weeklyReports.revisionNo))
      .limit(1);

    // The week's site updates.
    const author = alias(users, 'author');
    const week = await this.db
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
          gte(siteUpdates.eventDate, start),
          lte(siteUpdates.eventDate, end),
        ),
      )
      .orderBy(desc(siteUpdates.createdAt));
    const ids = week.map((w) => w.u.id);
    const photos = ids.length
      ? await this.db
          .select({ id: media.id, status: media.scanStatus })
          .from(media)
          .where(inArray(media.siteUpdateId, ids))
          .orderBy(desc(media.createdAt))
      : [];
    const blockers = new Map<string, string>();
    for (const w of week)
      if (w.u.blockers && !blockers.has(w.stageName))
        blockers.set(w.stageName, w.u.blockers);

    const money = await this.money.snapshot(projectId);
    const stageRows = await this.db
      .select()
      .from(stages)
      .where(eq(stages.projectId, projectId))
      .orderBy(asc(stages.position));
    // Not started = nothing reported on it yet (a stage with updates but no status change is underway).
    const planned = new Set(
      progress.stages
        .filter((s) => s.displayStatus === 'planned')
        .map((s) => s.id),
    );
    const next = stageRows
      .filter((s) => planned.has(s.id))
      .sort(
        (a, b) =>
          (a.plannedStart ?? '9999').localeCompare(b.plannedStart ?? '9999') ||
          a.position - b.position,
      )
      .slice(0, 3)
      .map((s) => ({ stage: s.name, plannedStart: s.plannedStart }));

    return {
      projectName: project.name,
      organizationName: org?.name ?? '',
      place:
        [project.location.sector, project.location.district]
          .filter(Boolean)
          .join(', ') || null,
      progress: {
        accepted: progress.acceptedPercent,
        reported: progress.reportedPercent,
        acceptedChange: previous
          ? progress.acceptedPercent - previous.data.progress.accepted
          : null,
      },
      stages: progress.stages.map((s) => ({
        name: s.name,
        weight: s.weight,
        status: s.displayStatus,
      })),
      work: {
        updates: week.length,
        photos: photos.length,
        authors: [
          ...new Set(
            week.map((w) => w.authorName).filter((n): n is string => !!n),
          ),
        ],
        stagesWorked: [...new Set(week.map((w) => w.stageName))],
        blockers: [...blockers].map(([stage, text]) => ({ stage, text })),
      },
      decisions: await this.decisionsOf(projectId),
      next,
      money: money.figures,
      spending: money.spending,
      photoIds: photos
        .filter((p) => p.status === 'clean')
        .slice(0, 4)
        .map((p) => p.id),
    };
  }

  /** Everything waiting for an answer, oldest first. */
  private async decisionsOf(projectId: string): Promise<ReportDecision[]> {
    const out: ReportDecision[] = [];
    const ready = await this.db
      .select({
        name: stages.name,
        since: sql<Date>`max(${stageReviews.createdAt})`,
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
          eq(stages.projectId, projectId),
          eq(stages.status, 'ready_for_review'),
        ),
      )
      .groupBy(stages.id, stages.name);
    for (const s of ready)
      out.push({
        kind: 'stage_review',
        title: s.name,
        amount: null,
        since: new Date(s.since ?? Date.now()).toISOString(),
      });
    for (const c of await this.db
      .select()
      .from(claims)
      .where(
        and(eq(claims.projectId, projectId), eq(claims.status, 'submitted')),
      ))
      out.push({
        kind: 'claim',
        title: `${c.number} · ${c.milestoneName}`,
        amount: c.amount,
        since: (c.submittedAt ?? c.updatedAt).toISOString(),
      });
    for (const r of await this.db
      .select()
      .from(spendingRequests)
      .where(
        and(
          eq(spendingRequests.projectId, projectId),
          eq(spendingRequests.status, 'submitted'),
        ),
      ))
      out.push({
        kind: 'spending',
        title: `${r.number} · ${r.purpose}`,
        amount: r.amount,
        since: (r.submittedAt ?? r.updatedAt).toISOString(),
      });
    for (const c of await this.db
      .select()
      .from(budgetChanges)
      .where(
        and(
          eq(budgetChanges.projectId, projectId),
          eq(budgetChanges.status, 'submitted'),
        ),
      ))
      out.push({
        kind: 'change',
        title: c.number,
        amount: c.netDelta,
        since: (c.submittedAt ?? c.updatedAt).toISOString(),
      });
    for (const p of await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.projectId, projectId),
          eq(payments.status, 'pending_verification'),
        ),
      ))
      out.push({
        kind: 'payment',
        title: p.number,
        amount: p.amount,
        since: p.createdAt.toISOString(),
      });
    return out.sort((a, b) => a.since.localeCompare(b.since));
  }

  private rows(projectId: string, reportId?: string) {
    const by = alias(users, 'generator');
    const ack = alias(users, 'acknowledger');
    return this.db
      .select({
        r: weeklyReports,
        generatedByName: by.displayName,
        acknowledgedByName: ack.displayName,
      })
      .from(weeklyReports)
      .leftJoin(by, eq(by.id, weeklyReports.createdBy))
      .leftJoin(ack, eq(ack.id, weeklyReports.acknowledgedBy))
      .where(
        and(
          eq(weeklyReports.projectId, projectId),
          reportId ? eq(weeklyReports.id, reportId) : undefined,
        ),
      )
      .orderBy(desc(weeklyReports.weekStart), desc(weeklyReports.revisionNo));
  }

  private summary({
    r,
    generatedByName,
    acknowledgedByName,
  }: {
    r: ReportRow;
    generatedByName: string | null;
    acknowledgedByName: string | null;
  }): WeeklyReportSummary {
    return {
      id: r.id,
      weekStart: r.weekStart,
      weekEnd: r.weekEnd,
      revisionNo: r.revisionNo,
      acceptedPercent: r.data.progress.accepted,
      decisionsWaiting: r.data.decisions.length,
      generatedByName,
      generatedAt: r.createdAt.toISOString(),
      acknowledgedByName,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    };
  }

  /** Links only for clean files (the snapshot keeps clean photos only). */
  private async photos(
    ids: string[],
    thumbsOnly = false,
  ): Promise<ReportPhoto[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select()
      .from(media)
      .where(and(inArray(media.id, ids), eq(media.scanStatus, 'clean')));
    return Promise.all(
      ids
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map(async (m) => ({
          id: m.id,
          url:
            thumbsOnly && m.thumbKey
              ? await this.storage.createDownloadUrl(m.thumbKey)
              : thumbsOnly
                ? null
                : await this.storage.createDownloadUrl(m.storageKey),
          thumbUrl: m.thumbKey
            ? await this.storage.createDownloadUrl(m.thumbKey)
            : null,
          takenAt: (m.capturedAt ?? m.createdAt).toISOString(),
        })),
    );
  }

  private async thumbs(
    ids: string[],
  ): Promise<{ image: Buffer; takenAt: string }[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select()
      .from(media)
      .where(
        and(
          inArray(media.id, ids),
          eq(media.scanStatus, 'clean'),
          isNotNull(media.thumbKey),
        ),
      );
    const out: { image: Buffer; takenAt: string }[] = [];
    for (const id of ids) {
      const m = rows.find((r) => r.id === id);
      if (m?.thumbKey)
        out.push({
          image: await this.storage.getObject(m.thumbKey),
          takenAt: (m.capturedAt ?? m.createdAt).toISOString(),
        });
    }
    return out;
  }
}
