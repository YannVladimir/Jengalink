import { Module } from '@nestjs/common';
import { MoneyModule } from '../money/money.module';
import { ProjectsModule } from '../projects/projects.module';
import { SiteUpdatesModule } from '../updates/site-updates.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [ProjectsModule, SiteUpdatesModule, MoneyModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
