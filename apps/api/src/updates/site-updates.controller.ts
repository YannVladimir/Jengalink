import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Headers,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateSiteUpdateRequest,
  RequestUploadRequest,
  SiteUpdate,
  StageTimeline,
  ProjectProgress,
  ProjectOverview,
  StageReviewRequest,
  SubmitStageRequest,
  UpdatesQuery,
  UploadGrantView,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { SiteUpdatesService } from './site-updates.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id')
export class SiteUpdatesController {
  constructor(private readonly updates: SiteUpdatesService) {}

  @Post('uploads')
  @Contract({
    tag: 'Site updates',
    summary: 'A short-lived signed PUT for one site photo (reporters only)',
    body: RequestUploadRequest,
    response: UploadGrantView,
    status: 201,
  })
  upload(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UploadGrantView> {
    return this.updates.requestUpload(auth.userId, id, body);
  }

  @Post('updates')
  @Idempotent({ required: true })
  @Contract({
    tag: 'Site updates',
    summary:
      'Post a site update: stage, note, blockers, photos (active projects; reporters only)',
    body: CreateSiteUpdateRequest,
    response: SiteUpdate,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<SiteUpdate> {
    return this.updates.create(auth.userId, id, body);
  }

  @Get('updates')
  @Contract({
    tag: 'Site updates',
    summary:
      'Activity feed: site updates newest first (filter by stage; page with before)',
    query: UpdatesQuery,
    response: SiteUpdate,
    list: true,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Query() query: unknown,
  ): Promise<SiteUpdate[]> {
    return this.updates.list(auth.userId, id, query);
  }

  @Get('progress')
  @Contract({
    tag: 'Site updates',
    summary:
      'Progress: accepted and reported percentages, and each stage for the Jenga tower',
    response: ProjectProgress,
  })
  progress(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ProjectProgress> {
    return this.updates.progress(auth.userId, id);
  }

  @Post('stages/:stageId/submit')
  @HttpCode(200)
  @Contract({
    tag: 'Site updates',
    summary:
      'Say a stage is done: it becomes ready for the owner to review (contractor, manager)',
    body: SubmitStageRequest,
    response: StageTimeline,
  })
  submit(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('stageId', uuid) stageId: string,
    @Body() body: unknown,
  ): Promise<StageTimeline> {
    return this.updates.submitStage(auth.userId, id, stageId, body);
  }

  @Post('stages/:stageId/review')
  @HttpCode(200)
  @Contract({
    tag: 'Site updates',
    summary:
      'Owner accepts the stage (exact revision, If-Match) or asks for changes',
    body: StageReviewRequest,
    response: StageTimeline,
    ifMatch: true,
  })
  review(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('stageId', uuid) stageId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<StageTimeline> {
    return this.updates.reviewStage(auth.userId, id, stageId, ifMatch, body);
  }

  @Get('stages/:stageId/timeline')
  @Contract({
    tag: 'Site updates',
    summary:
      "One stage's photo timeline with its first and latest photo (before/after)",
    response: StageTimeline,
  })
  timeline(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('stageId', uuid) stageId: string,
  ): Promise<StageTimeline> {
    return this.updates.timeline(auth.userId, id, stageId);
  }
}

@Controller('overview')
export class OverviewController {
  constructor(private readonly updates: SiteUpdatesService) {}

  @Get()
  @Contract({
    tag: 'Projects',
    summary:
      'All your projects with progress, blockers and the next action for your role',
    response: ProjectOverview,
    list: true,
  })
  overview(@CurrentUser() auth: AuthUser): Promise<ProjectOverview[]> {
    return this.updates.overview(auth.userId);
  }
}
