import { Module } from '@nestjs/common';
import { AttachmentsService } from '../media/attachments';
import { ProjectsModule } from '../projects/projects.module';
import { SiteUpdatesModule } from '../updates/site-updates.module';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

@Module({
  imports: [ProjectsModule, SiteUpdatesModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, AttachmentsService],
})
export class ClaimsModule {}
