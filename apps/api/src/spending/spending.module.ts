import { Module } from '@nestjs/common';
import { AttachmentsService } from '../media/attachments';
import { ProjectsModule } from '../projects/projects.module';
import { SpendingController } from './spending.controller';
import { ReceiptsService } from './receipts.service';
import { SpendingService } from './spending.service';

@Module({
  imports: [ProjectsModule],
  controllers: [SpendingController],
  providers: [SpendingService, ReceiptsService, AttachmentsService],
})
export class SpendingModule {}
