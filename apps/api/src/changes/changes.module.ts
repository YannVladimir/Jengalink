import { Module } from '@nestjs/common';
import { AttachmentsService } from '../media/attachments';
import { ProjectsModule } from '../projects/projects.module';
import { ChangesController } from './changes.controller';
import { ChangesService } from './changes.service';

@Module({
  imports: [ProjectsModule],
  controllers: [ChangesController],
  providers: [ChangesService, AttachmentsService],
})
export class ChangesModule {}
