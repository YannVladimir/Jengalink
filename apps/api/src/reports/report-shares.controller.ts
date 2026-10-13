import { LIMITS, RateLimit } from '../common/rate-limit';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreatedReportShare,
  QuotePdfLink,
  ReportShareRequest,
  ReportShareView,
  SharedPdfQuery,
  SharedReportView,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser, Public } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { ZodPipe } from '../common/zod.pipe';
import { ReportSharesService } from './report-shares.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id/reports/:reportId/shares')
export class ReportSharesController {
  constructor(private readonly shares: ReportSharesService) {}

  @Get()
  @Contract({
    tag: 'Reports',
    summary: 'Links made for this report (active, expired and stopped)',
    response: ReportShareView,
    list: true,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
  ): Promise<ReportShareView[]> {
    return this.shares.list(auth.userId, id, reportId);
  }

  @Post('preview')
  @HttpCode(200)
  @Contract({
    tag: 'Reports',
    summary: 'Privacy preview: exactly what the link would show',
    body: ReportShareRequest,
    response: SharedReportView,
  })
  preview(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
    @Body() body: unknown,
  ): Promise<SharedReportView> {
    return this.shares.preview(auth.userId, id, reportId, body);
  }

  @Post()
  @Idempotent()
  @Contract({
    tag: 'Reports',
    summary:
      'Make an expiring link with the chosen sections (the link is only returned here)',
    body: ReportShareRequest,
    response: CreatedReportShare,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
    @Body() body: unknown,
  ): Promise<CreatedReportShare> {
    return this.shares.create(auth.userId, id, reportId, body);
  }

  @Post(':shareId/revoke')
  @HttpCode(200)
  @Contract({
    tag: 'Reports',
    summary: 'Stop a link at once (the sharer or the owner)',
    response: ReportShareView,
  })
  revoke(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
    @Param('shareId', uuid) shareId: string,
  ): Promise<ReportShareView> {
    return this.shares.revoke(auth.userId, id, reportId, shareId);
  }
}

/** What a link's recipient opens, without an account. The token is checked on every request. */
@Public()
@Controller('shared/reports')
export class SharedReportsController {
  constructor(private readonly shares: ReportSharesService) {}

  @RateLimit(LIMITS.shareLinks)
  @Get(':token')
  @Contract({
    tag: 'Reports',
    summary: 'Open a shared report link (404 unknown, 410 expired or stopped)',
    response: SharedReportView,
  })
  open(@Param('token') token: string): Promise<SharedReportView> {
    return this.shares.open(token);
  }

  @RateLimit(LIMITS.shareLinks)
  @Post(':token/pdf')
  @HttpCode(200)
  @Contract({
    tag: 'Reports',
    summary:
      'A 5-minute link to the shared PDF, when the link allows downloads',
    query: SharedPdfQuery,
    response: QuotePdfLink,
  })
  pdf(
    @Param('token') token: string,
    @Query(new ZodPipe(SharedPdfQuery)) query: SharedPdfQuery,
  ): Promise<QuotePdfLink> {
    return this.shares.pdf(token, query.lang);
  }
}
