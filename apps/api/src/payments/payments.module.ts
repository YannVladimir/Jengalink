import { Module } from '@nestjs/common';
import { AttachmentsService } from '../media/attachments';
import { ProjectsModule } from '../projects/projects.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ProjectsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, AttachmentsService],
})
export class PaymentsModule {}
