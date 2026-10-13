import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  GenerateReportRequest,
  QuotePdfLink,
  WeeklyReportSummary,
  WeeklyReportView,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { ReportsService } from './reports.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Contract({
    tag: 'Reports',
    summary: 'Weekly reports, newest week first (latest revision of each week)',
    response: WeeklyReportSummary,
    list: true,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<WeeklyReportSummary[]> {
    return this.reports.list(auth.userId, id);
  }

  @Post()
  @Idempotent()
  @Contract({
    tag: 'Reports',
    summary:
      'One tap: freeze this week (or the week of weekOf) as a report from records',
    body: GenerateReportRequest,
    response: WeeklyReportView,
    status: 201,
  })
  generate(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<WeeklyReportView> {
    return this.reports.generate(auth.userId, id, body);
  }

  @Get(':reportId')
  @Contract({
    tag: 'Reports',
    summary:
      'One weekly report with photo links (money only for money readers)',
    response: WeeklyReportView,
  })
  get(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
  ): Promise<WeeklyReportView> {
    return this.reports.get(auth.userId, id, reportId);
  }

  @Post(':reportId/acknowledge')
  @HttpCode(200)
  @Contract({
    tag: 'Reports',
    summary: 'The owner marks the report reviewed (once)',
    response: WeeklyReportView,
  })
  acknowledge(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
  ): Promise<WeeklyReportView> {
    return this.reports.acknowledge(auth.userId, id, reportId);
  }

  @Post(':reportId/pdf')
  @HttpCode(200)
  @Contract({
    tag: 'Reports',
    summary: 'A 5-minute private link to the one-page PDF, in your language',
    response: QuotePdfLink,
  })
  pdf(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('reportId', uuid) reportId: string,
  ): Promise<QuotePdfLink> {
    return this.reports.pdf(auth.userId, id, reportId);
  }
}
