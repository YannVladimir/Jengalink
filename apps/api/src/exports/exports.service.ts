import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  EXPORTS_PER_HOUR,
  type ExportList,
  type ExportView,
  type QuotePdfLink,
  localClock,
  RequestExport,
  toCsv,
} from '@jengalink/contracts';
import { createTranslator, isLocale, type Locale } from '@jengalink/i18n';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import type { Database } from '../db/client';
import { DB } from '../db/database.module';
import { projectExports, projects, users } from '../db/schema';
import { JobsService } from '../jobs/jobs.service';
import { recordEvent } from '../jobs/outbox';
import { MoneyService } from '../money/money.service';
import { renderHistoryPdf, renderSummaryPdf } from '../pdf/export-pdf';
import { AccessService } from '../projects/access.service';
import { seesReportMoney } from '../reports/reports.service';
import { StorageService } from '../storage/storage.service';
import { SiteUpdatesService } from '../updates/site-updates.service';
import {
  type HistoryRow,
  historyOf,
  type SummaryData,
  summaryOf,
} from './export-data';

const requestPipe = new ZodPipe(RequestExport);
type Row = typeof projectExports.$inferSelect;
const fileNameOf = (r: Pick<Row, 'kind' | 'format' | 'createdAt'>) =>
  `${r.kind.replace('_', '-')}-${r.createdAt.toISOString().slice(0, 10)}.${r.format}`;

/**
 * Exports (spec §12, §21): a project summary and the money history, as PDF or CSV. Asking queues
 * a job that reads one consistent snapshot; the file stays private and only the person who asked
 * can download it, with money access checked again at download time.
 */
@Injectable()
export class ExportsService implements OnModuleInit {
  static readonly consumer = 'build-export';
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly money: MoneyService,
    private readonly updates: SiteUpdatesService,
  ) {}

  onModuleInit() {
    this.jobs.on(
      'export.requested',
      ExportsService.consumer,
      async ({ exportId }) => this.build(exportId),
    );
  }

  async list(userId: string, projectId: string): Promise<ExportList> {
    const { roles, financialVisibility } = await this.access.requireProject(
      userId,
      projectId,
    );
    const rows = await this.db
      .select()
      .from(projectExports)
      .where(
        and(
          eq(projectExports.projectId, projectId),
          eq(projectExports.createdBy, userId),
        ),
      )
      .orderBy(desc(projectExports.createdAt))
      .limit(20);
    return {
      canExportMoney: seesReportMoney(roles, financialVisibility),
      items: rows.map((r) => this.view(r)),
    };
  }

  async request(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<ExportView> {
    const { project, roles, financialVisibility } =
      await this.access.requireProject(userId, projectId);
    const req = requestPipe.transform(body);
    const seesMoney = seesReportMoney(roles, financialVisibility);
    if (req.kind === 'money_history' && !seesMoney)
      throw new ForbiddenException(
        'The money history is for people who can see this project’s money',
      );
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectExports)
      .where(
        and(
          eq(projectExports.createdBy, userId),
          gte(projectExports.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );
    if (n >= EXPORTS_PER_HOUR)
      throw new HttpException(
        'Too many exports in the last hour. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const [me] = await this.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    const row = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(projectExports)
        .values({
          organizationId: project.organizationId,
          projectId,
          kind: req.kind,
          format: req.format,
          locale: isLocale(me?.locale) ? me.locale : 'en',
          includesMoney: seesMoney,
          createdBy: userId,
        })
        .returning();
      await this.audit.record(tx, {
        action: 'export.requested',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'project_export', id: r.id },
        metadata: {
          kind: req.kind,
          format: req.format,
          includesMoney: seesMoney,
        },
      });
      await recordEvent(
        tx,
        'export.requested',
        { exportId: r.id, projectId },
        userId,
      );
      return r;
    });
    return this.view(row);
  }

  /** A 5-minute link; money access is checked again now (it may have been removed since). */
  async download(
    userId: string,
    projectId: string,
    exportId: string,
  ): Promise<QuotePdfLink> {
    const { project, roles, financialVisibility } =
      await this.access.requireProject(userId, projectId);
    const [r] = await this.db
      .select()
      .from(projectExports)
      .where(
        and(
          eq(projectExports.id, exportId),
          eq(projectExports.projectId, projectId),
          eq(projectExports.createdBy, userId),
        ),
      );
    if (!r) throw new NotFoundException('Export not found');
    if (r.includesMoney && !seesReportMoney(roles, financialVisibility))
      throw new ForbiddenException(
        'You no longer have access to this project’s money',
      );
    if (r.status !== 'ready' || !r.storageKey)
      throw new HttpException('This export is not ready', HttpStatus.CONFLICT);
    await this.audit.record(this.db, {
      action: 'export.downloaded',
      actor: { userId },
      organizationId: project.organizationId,
      projectId,
      target: { type: 'project_export', id: r.id },
      metadata: { kind: r.kind, format: r.format },
    });
    const expiresInSeconds = 5 * 60;
    return {
      url: await this.storage.createDownloadUrl(r.storageKey, {
        fileName: fileNameOf(r),
        inline: r.format === 'pdf',
        expiresInSeconds,
      }),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /* ---------- the job ---------- */

  /** Builds the file from one repeatable-read snapshot; a failure is recorded, never retried in a loop. */
  async build(exportId: string) {
    const [r] = await this.db
      .select()
      .from(projectExports)
      .where(eq(projectExports.id, exportId));
    if (!r || r.status !== 'queued') return;
    try {
      const locale: Locale = isLocale(r.locale) ? r.locale : 'en';
      const snap = await this.db.transaction(
        async (tx) => {
          const [p] = await tx
            .select({ name: projects.name, timeZone: projects.timezone })
            .from(projects)
            .where(eq(projects.id, r.projectId));
          const [me] = r.createdBy
            ? await tx
                .select({ name: users.displayName })
                .from(users)
                .where(eq(users.id, r.createdBy))
            : [];
          const summary = await summaryOf(tx, r.projectId, r.includesMoney, {
            money: this.money,
            updates: this.updates,
          });
          const history =
            r.kind === 'money_history' ? await historyOf(tx, r.projectId) : [];
          return {
            projectName: p.name,
            timeZone: p.timeZone,
            requesterName: me?.name ?? '—',
            summary,
            history,
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      const meta = {
        locale,
        projectName: snap.projectName,
        organizationName: snap.summary.organizationName,
        requesterName: snap.requesterName,
        generatedAt: new Date(),
        timeZone: snap.timeZone,
      };
      const file =
        r.format === 'pdf'
          ? r.kind === 'money_history'
            ? await renderHistoryPdf(snap.history, meta)
            : await renderSummaryPdf(snap.summary, meta)
          : Buffer.from(
              r.kind === 'money_history'
                ? historyCsv(snap.history, locale, snap.timeZone)
                : summaryCsv(snap.summary, locale),
              'utf8',
            );
      const key = `orgs/${r.organizationId}/projects/${r.projectId}/exports/${r.id}.${r.format}`;
      await this.storage.putObject(
        key,
        file,
        r.format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
      );
      await this.db
        .update(projectExports)
        .set({
          status: 'ready',
          storageKey: key,
          readyAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectExports.id, r.id));
    } catch (err) {
      this.logger.error(`Export ${r.id} failed`, err as Error);
      await this.db
        .update(projectExports)
        .set({
          status: 'failed',
          error: (err as Error).message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(projectExports.id, r.id));
    }
  }

  private view(r: Row): ExportView {
    return {
      id: r.id,
      kind: r.kind,
      format: r.format,
      status: r.status,
      includesMoney: r.includesMoney,
      fileName: fileNameOf(r),
      createdAt: r.createdAt.toISOString(),
      readyAt: r.readyAt?.toISOString() ?? null,
    };
  }
}

/** The money history as one table: date (ISO, sorts in a spreadsheet), what, reference, details, amount, by. */
export function historyCsv(
  rows: HistoryRow[],
  locale: Locale,
  timeZone: string,
): string {
  const t = createTranslator(locale);
  return toCsv([
    [
      t('exports.col_date'),
      t('exports.col_type'),
      t('exports.col_ref'),
      t('exports.col_details'),
      t('exports.col_amount'),
      t('exports.col_by'),
    ],
    ...rows.map((r) => [
      `${localClock(r.at, timeZone).date} ${localClock(r.at, timeZone).time}`,
      t(`exports.type_${r.type}`),
      r.ref,
      r.details,
      r.amount,
      r.by,
    ]),
  ]);
}

/** The summary: key figures first, then the stage table (a blank line between). */
export function summaryCsv(d: SummaryData, locale: Locale): string {
  const t = createTranslator(locale);
  const money: (string | number)[][] = d.money
    ? [
        [t('exports.field_contract'), d.money.contract],
        [t('exports.field_paid'), d.money.paid],
        [t('exports.field_approved'), d.money.approvedUnpaid],
        [t('exports.field_waiting'), d.money.awaitingDecision],
        [t('exports.field_toCome'), d.money.stillToCome],
      ]
    : [];
  return toCsv([
    [t('exports.section_project'), d.name],
    [t('exports.field_contractor'), d.organizationName],
    [t('exports.field_place'), d.place ?? ''],
    [t('exports.field_accepted'), d.progress.accepted],
    [t('exports.field_reported'), d.progress.reported],
    ...money,
    [],
    [
      t('exports.col_stage'),
      t('exports.col_weight'),
      t('exports.col_status'),
      t('exports.col_start'),
      t('exports.col_end'),
    ],
    ...d.stages.map((s) => [
      s.name,
      s.weight,
      t(`stage.${s.status}`),
      s.plannedStart ?? '',
      s.plannedEnd ?? '',
    ]),
    [],
    [t('exports.col_name'), t('exports.col_role')],
    ...d.team.map((m) => [m.name, t(`server.role_${m.role}`)]),
  ]);
}
