import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  AuditEventView,
  CreatedInvitation,
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateProjectRequest,
  InvitationView,
  MemberView,
  OrganizationView,
  ProjectStage,
  AcceptanceDecisionRequest,
  ProjectAcceptanceView,
  ProjectSummary,
  SaveStagePlanRequest,
  StagePlan,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { WithETag } from '../common/versioning';
import { ZodPipe } from '../common/zod.pipe';
import { AccessService } from './access.service';
import { InvitationsService } from './invitations.service';
import { ProjectsService } from './projects.service';

const uuid = new ParseUUIDPipe({ version: '7' });

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Post()
  @Idempotent()
  @Contract({
    tag: 'Organizations',
    summary: 'Create a company or household workspace (you become admin)',
    body: CreateOrganizationRequest,
    response: OrganizationView,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Body(new ZodPipe(CreateOrganizationRequest))
    body: CreateOrganizationRequest,
  ): Promise<OrganizationView> {
    return this.projects.createOrganization(auth.userId, body);
  }

  @Get()
  @Contract({
    tag: 'Organizations',
    summary: 'Organizations you belong to',
    response: OrganizationView,
    list: true,
  })
  list(@CurrentUser() auth: AuthUser): Promise<OrganizationView[]> {
    return this.projects.listOrganizations(auth.userId);
  }

  @Post(':id/invitations')
  @Idempotent({ required: true })
  @Contract({
    tag: 'Organizations',
    summary: 'Invite someone to the organization (admins only)',
    body: CreateInvitationRequest,
    response: CreatedInvitation,
    status: 201,
  })
  invite(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateInvitationRequest)) body: CreateInvitationRequest,
  ): Promise<CreatedInvitation> {
    return this.invitations.inviteToOrganization(auth.userId, id, body);
  }
}

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly invitations: InvitationsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** The project's audit trail, newest first. Owners only. */
  @Get(':id/audit')
  @Contract({
    tag: 'Projects',
    summary: 'Audit trail, newest first (owners only)',
    response: AuditEventView,
    list: true,
  })
  async auditTrail(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<AuditEventView[]> {
    await this.access.requireProject(auth.userId, id, ['owner']);
    return this.audit.forProject(id);
  }

  @Post()
  @Idempotent()
  @WithETag()
  @Contract({
    tag: 'Projects',
    summary: 'Create a project in one of your organizations',
    body: CreateProjectRequest,
    response: ProjectSummary,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Body(new ZodPipe(CreateProjectRequest)) body: CreateProjectRequest,
  ): Promise<ProjectSummary> {
    return this.projects.createProject(auth.userId, body);
  }

  @Get()
  @Contract({
    tag: 'Projects',
    summary: 'Projects you are a member of',
    response: ProjectSummary,
    list: true,
  })
  list(@CurrentUser() auth: AuthUser): Promise<ProjectSummary[]> {
    return this.projects.listProjects(auth.userId);
  }

  @Get(':id')
  @WithETag()
  @Contract({
    tag: 'Projects',
    summary: 'One project (ETag = revision)',
    response: ProjectSummary,
  })
  get(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ProjectSummary> {
    return this.projects.getProject(auth.userId, id);
  }

  @Get(':id/acceptance')
  @WithETag()
  @Contract({
    tag: 'Projects',
    summary:
      'What the owner reviews before accepting: value, stages, readiness, past decisions',
    response: ProjectAcceptanceView,
  })
  acceptance(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ProjectAcceptanceView> {
    return this.projects.getAcceptance(auth.userId, id);
  }

  /** Owner accepts the reviewed revision (Draft → Active) or asks for changes. Requires If-Match. */
  @Post(':id/acceptance')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Projects',
    summary:
      'Owner accepts the contract value and stage plan (starts the project) or asks for changes',
    body: AcceptanceDecisionRequest,
    response: ProjectAcceptanceView,
    ifMatch: true,
  })
  decide(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<ProjectAcceptanceView> {
    // Access first, then If-Match and the body, so strangers always get 404.
    return this.projects.decide(auth.userId, id, ifMatch, body);
  }

  @Get(':id/stages')
  @Contract({
    tag: 'Projects',
    summary: 'Stages in order, with their weights (total 100)',
    response: ProjectStage,
    list: true,
  })
  stages(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ProjectStage[]> {
    return this.projects.listStages(auth.userId, id);
  }

  @Get(':id/plan')
  @WithETag()
  @Contract({
    tag: 'Projects',
    summary:
      'The stage plan: weights, planned dates and acceptance criteria (ETag = project revision)',
    response: StagePlan,
  })
  plan(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<StagePlan> {
    return this.projects.getPlan(auth.userId, id);
  }

  /** Whole-plan save; draft projects only. Requires If-Match with the project revision. */
  @Put(':id/plan')
  @WithETag()
  @Contract({
    tag: 'Projects',
    summary:
      'Save the stage plan (owner, manager, contractor; draft projects only)',
    body: SaveStagePlanRequest,
    response: StagePlan,
    ifMatch: true,
  })
  savePlan(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<StagePlan> {
    // The service checks access before If-Match and the body, so strangers always get 404.
    return this.projects.savePlan(auth.userId, id, ifMatch, body);
  }

  @Get(':id/members')
  @Contract({
    tag: 'Projects',
    summary: 'Members and their roles',
    response: MemberView,
    list: true,
  })
  members(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<MemberView[]> {
    return this.projects.listMembers(auth.userId, id);
  }

  @Delete(':id/members/:membershipId')
  @HttpCode(204)
  @Contract({
    tag: 'Projects',
    summary: 'Remove a member; takes effect on their next request',
  })
  async remove(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('membershipId', uuid) membershipId: string,
  ): Promise<void> {
    await this.projects.removeMember(auth.userId, id, membershipId);
  }

  @Get(':id/invitations')
  @Contract({
    tag: 'Projects',
    summary:
      'Invitations sent for this project, newest first (owner, manager, contractor)',
    response: InvitationView,
    list: true,
  })
  projectInvitations(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<InvitationView[]> {
    return this.invitations.listForProject(auth.userId, id);
  }

  @Post(':id/invitations')
  @Idempotent({ required: true })
  @Contract({
    tag: 'Projects',
    summary: 'Invite someone to the project in a role',
    body: CreateInvitationRequest,
    response: CreatedInvitation,
    status: 201,
  })
  invite(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateInvitationRequest)) body: CreateInvitationRequest,
  ): Promise<CreatedInvitation> {
    return this.invitations.inviteToProject(auth.userId, id, body);
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /** Pending invitations for the caller's verified phone or email. */
  @Get()
  @Contract({
    tag: 'Invitations',
    summary: 'Pending invitations sent to your phone or email',
    response: InvitationView,
    list: true,
  })
  mine(@CurrentUser() auth: AuthUser): Promise<InvitationView[]> {
    return this.invitations.listMine(auth.userId);
  }

  @Get('token/:token')
  @Contract({
    tag: 'Invitations',
    summary: 'Open a shared invitation link (only its recipient)',
    response: InvitationView,
  })
  byToken(
    @CurrentUser() auth: AuthUser,
    @Param('token') token: string,
  ): Promise<InvitationView> {
    return this.invitations.getByToken(auth.userId, token);
  }

  @Get(':id')
  @Contract({
    tag: 'Invitations',
    summary: 'One invitation sent to you, with what the role will see',
    response: InvitationView,
  })
  one(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<InvitationView> {
    return this.invitations.getMine(auth.userId, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Contract({
    tag: 'Invitations',
    summary: 'Accept an invitation sent to you',
    response: InvitationView,
  })
  accept(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<InvitationView> {
    return this.invitations.accept(auth.userId, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @Contract({
    tag: 'Invitations',
    summary: 'Decline an invitation sent to you',
    response: InvitationView,
  })
  decline(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<InvitationView> {
    return this.invitations.decline(auth.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Contract({ tag: 'Invitations', summary: 'Withdraw a pending invitation' })
  async revoke(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.invitations.revoke(auth.userId, id);
  }
}
