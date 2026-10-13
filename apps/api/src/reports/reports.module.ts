import { Module } from '@nestjs/common';
import { MoneyModule } from '../money/money.module';
import { ProjectsModule } from '../projects/projects.module';
import { SiteUpdatesModule } from '../updates/site-updates.module';
import {
  ReportSharesController,
  SharedReportsController,
} from './report-shares.controller';
import { ReportSharesService } from './report-shares.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ProjectsModule, SiteUpdatesModule, MoneyModule],
  controllers: [
    ReportsController,
    ReportSharesController,
    SharedReportsController,
  ],
  providers: [ReportsService, ReportSharesService],
})
export class ReportsModule {}
