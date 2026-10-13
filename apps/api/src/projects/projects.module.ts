import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { InvitationNotifier } from './invitation-notifier';
import { InvitationsService } from './invitations.service';
import {
  InvitationsController,
  OrganizationsController,
  ProjectsController,
} from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [
    OrganizationsController,
    ProjectsController,
    InvitationsController,
  ],
  providers: [
    AccessService,
    ProjectsService,
    InvitationsService,
    InvitationNotifier,
  ],
  exports: [AccessService],
})
export class ProjectsModule {}
