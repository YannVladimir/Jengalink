import { createHash, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CreatedReportShare,
  type ProjectRole,
  type QuotePdfLink,
  ReportShareRequest,
  type ReportShareView,
  SHARE_SECTIONS,
  type ShareSection,
  type SharedReportView,
  sharedReportData,
} from '@jengalink/contracts';
import { isLocale } from '@jengalink/i18n';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import type { Database } from '../db/client';
import { DB } from '../db/database.module';
import { reportShares, users } from '../db/schema';
import { AccessService } from '../projects/access.service';
import { ReportsService, SHARERS, seesReportMoney } from './reports.service';

const CLIENT: readonly ProjectRole[] = ['owner', 'delegate'];
const requestPipe = new ZodPipe(ReportShareRequest);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
type ShareRow = typeof reportShares.$inferSelect;

/**
 * Report links for people outside the project (spec §26.5, §12): the sharer picks the sections and
 * the expiry and sees exactly what the recipient will see first. A link never shows anyone's name,
 * the exact place or original photos; it is checked on every open and can be revoked.
 */
@Injectable()
export class ReportSharesService {
  private readonly appUrl: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173';
  }

  async list(
    userId: string,
    projectId: string,
    reportId: string,
  ): Promise<ReportShareView[]> {
    const { roles } = await this.sharer(userId, projectId);
    await this.reports.row(projectId, reportId);
    const by = alias(users, 'sharer');
    const rows = await this.db
      .select({ s: reportShares, name: by.displayName })
      .from(reportShares)
      .leftJoin(by, eq(by.id, reportShares.createdBy))
      .where(
        and(
          eq(reportShares.projectId, projectId),
          eq(reportShares.reportId, reportId),
        ),
      )
      .orderBy(desc(reportShares.createdAt));
    return rows.map((r) => this.view(r.s, r.name, userId, roles));
  }

  /** The privacy preview: exactly what the link will show, before it exists. */
  async preview(
    userId: string,
    projectId: string,
    reportId: string,
    body: unknown,
  ): Promise<SharedReportView> {
    const { req } = await this.checked(userId, projectId, body);
    const row = await this.reports.row(projectId, reportId);
    const [me] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    return this.shared(row.r, {
      sections: req.sections,
      allowDownload: req.allowDownload,
      expiresAt: new Date(Date.now() + req.expiresInDays * 86_400_000),
      sharedByName: me?.name ?? null,
    });
  }

  async create(
    userId: string,
    projectId: string,
    reportId: string,
    body: unknown,
  ): Promise<CreatedReportShare> {
    const { project, roles, req } = await this.checked(userId, projectId, body);
    await this.reports.row(projectId, reportId);
    const token = randomBytes(32).toString('base64url');
    const row = await this.db.transaction(async (tx) => {
      const [s] = await tx
        .insert(reportShares)
        .values({
          organizationId: project.organizationId,
          projectId,
          reportId,
          tokenHash: sha256(token),
          sections: req.sections,
          allowDownload: req.allowDownload,
          expiresAt: new Date(Date.now() + req.expiresInDays * 86_400_000),
          createdBy: userId,
        })
        .returning();
      await this.audit.record(tx, {
        action: 'report.shared',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'report_share', id: s.id },
        metadata: {
          reportId,
          sections: req.sections,
          days: req.expiresInDays,
          download: req.allowDownload,
        },
      });
      return s;
    });
    const [me] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    return {
      ...this.view(row, me?.name ?? null, userId, roles),
      url: `${this.appUrl}/s/${token}`,
    };
  }

  /** The sharer, or the owner (it is their project), stops a link at once. */
  async revoke(
    userId: string,
    projectId: string,
    reportId: string,
    shareId: string,
  ): Promise<ReportShareView> {
    const { project, roles } = await this.sharer(userId, projectId);
    const row = await this.db.transaction(async (tx) => {
      const [s] = await tx
        .select()
        .from(reportShares)
        .where(
          and(
            eq(reportShares.id, shareId),
            eq(reportShares.projectId, projectId),
            eq(reportShares.reportId, reportId),
          ),
        )
        .for('update');
      if (!s) throw new NotFoundException('Link not found');
      if (!this.canRevoke(s, userId, roles))
        throw new ForbiddenException(
          'Only the person who shared it or the owner can stop this link',
        );
      if (s.revokedAt) return s;
      const [u] = await tx
        .update(reportShares)
        .set({
          revokedAt: new Date(),
          revokedBy: userId,
          updatedAt: new Date(),
          revision: sql`${reportShares.revision} + 1`,
        })
        .where(eq(reportShares.id, s.id))
        .returning();
      await this.audit.record(tx, {
        action: 'report.share_revoked',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'report_share', id: s.id },
        metadata: { reportId },
      });
      return u;
    });
    const [by] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, row.createdBy ?? userId));
    return this.view(row, by?.name ?? null, userId, roles);
  }

  /* ---------- the recipient (no account) ---------- */

  async open(token: string): Promise<SharedReportView> {
    const s = await this.byToken(token);
    await this.db
      .update(reportShares)
      .set({
        viewCount: sql`${reportShares.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(reportShares.id, s.id));
    const row = await this.reports.row(s.projectId, s.reportId);
    const [by] = s.createdBy
      ? await this.db
          .select({ name: users.displayName })
          .from(users)
          .where(eq(users.id, s.createdBy))
      : [];
    return this.shared(row.r, {
      sections: s.sections,
      allowDownload: s.allowDownload,
      expiresAt: s.expiresAt,
      sharedByName: by?.name ?? null,
    });
  }

  async pdf(token: string, lang: unknown): Promise<QuotePdfLink> {
    const s = await this.byToken(token);
    if (!s.allowDownload)
      throw new ForbiddenException('This link does not allow downloads');
    const { r } = await this.reports.row(s.projectId, s.reportId);
    const locale = typeof lang === 'string' && isLocale(lang) ? lang : 'en';
    return this.reports.pdfLink(
      `orgs/${s.organizationId}/projects/${s.projectId}/reports/${r.id}-share-${s.id}-${locale}.pdf`,
      {
        locale,
        weekStart: r.weekStart,
        weekEnd: r.weekEnd,
        revisionNo: r.revisionNo,
        // No one's name on a shared copy: the organization stands behind it.
        generatedByName: r.data.organizationName,
        generatedAt: r.createdAt.toISOString(),
        data: sharedReportData(r.data, s.sections),
        sections: s.sections,
      },
    );
  }

  /* ---------- internals ---------- */

  private async sharer(userId: string, projectId: string) {
    const ctx = await this.access.requireProject(userId, projectId);
    if (!ctx.roles.some((r) => SHARERS.includes(r)))
      throw new ForbiddenException(
        'Only the owner, their delegate, the contractor or the project manager can share a report',
      );
    return ctx;
  }

  /** Access first, then the body; money only for people who may see it themselves. */
  private async checked(userId: string, projectId: string, body: unknown) {
    const ctx = await this.sharer(userId, projectId);
    const parsed = requestPipe.transform(body);
    const sections = SHARE_SECTIONS.filter((x) => parsed.sections.includes(x));
    if (
      sections.includes('money') &&
      !seesReportMoney(ctx.roles, ctx.financialVisibility)
    )
      throw new ForbiddenException('You cannot share money you cannot see');
    return { ...ctx, req: { ...parsed, sections } };
  }

  /** Unknown tokens are 404; expired or stopped links say so (410). */
  private async byToken(token: string): Promise<ShareRow> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token))
      throw new NotFoundException('Link not found');
    const [s] = await this.db
      .select()
      .from(reportShares)
      .where(eq(reportShares.tokenHash, sha256(token)));
    if (!s) throw new NotFoundException('Link not found');
    if (s.revokedAt) throw new GoneException('This link was stopped');
    if (s.expiresAt.getTime() <= Date.now())
      throw new GoneException('This link has expired');
    return s;
  }

  private async shared(
    r: {
      weekStart: string;
      weekEnd: string;
      revisionNo: number;
      createdAt: Date;
      data: SharedReportView['data'];
    },
    o: {
      sections: ShareSection[];
      allowDownload: boolean;
      expiresAt: Date;
      sharedByName: string | null;
    },
  ): Promise<SharedReportView> {
    const data = sharedReportData(r.data, o.sections);
    return {
      weekStart: r.weekStart,
      weekEnd: r.weekEnd,
      revisionNo: r.revisionNo,
      generatedAt: r.createdAt.toISOString(),
      sharedByName: o.sharedByName,
      sections: o.sections,
      data,
      photos: await this.reports.thumbPhotos(data.photoIds),
      expiresAt: o.expiresAt.toISOString(),
      allowDownload: o.allowDownload,
    };
  }

  private canRevoke(
    s: ShareRow,
    userId: string,
    roles: readonly ProjectRole[],
  ) {
    return s.createdBy === userId || roles.some((r) => CLIENT.includes(r));
  }

  private view(
    s: ShareRow,
    createdByName: string | null,
    userId: string,
    roles: readonly ProjectRole[],
  ): ReportShareView {
    const status = s.revokedAt
      ? 'revoked'
      : s.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'active';
    return {
      id: s.id,
      reportId: s.reportId,
      sections: s.sections,
      allowDownload: s.allowDownload,
      expiresAt: s.expiresAt.toISOString(),
      status,
      createdByName,
      createdAt: s.createdAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
      viewCount: s.viewCount,
      lastViewedAt: s.lastViewedAt?.toISOString() ?? null,
      canRevoke: status === 'active' && this.canRevoke(s, userId, roles),
    };
  }
}
