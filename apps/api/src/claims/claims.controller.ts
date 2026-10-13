import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ClaimDecisionRequest,
  ClaimMilestones,
  ClaimSummary,
  ClaimView,
  RequestClaimUploadRequest,
  SaveClaimRequest,
  UploadGrantView,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { WithETag } from '../common/versioning';
import { ClaimsService } from './claims.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id/claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @Contract({
    tag: 'Claims',
    summary:
      'Payment claims, newest first (drafts for the contractor side only; money readers only)',
    response: ClaimSummary,
    list: true,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ClaimSummary[]> {
    return this.claims.list(auth.userId, id);
  }

  @Get('milestones')
  @Contract({
    tag: 'Claims',
    summary:
      'Milestones of the current agreement and what is already claimed on each',
    response: ClaimMilestones,
  })
  milestones(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ClaimMilestones> {
    return this.claims.milestones(auth.userId, id);
  }

  @Post('uploads')
  @Contract({
    tag: 'Claims',
    summary:
      'A short-lived signed PUT for one claim file: a photo or a PDF (contractor side only)',
    body: RequestClaimUploadRequest,
    response: UploadGrantView,
    status: 201,
  })
  upload(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UploadGrantView> {
    return this.claims.requestUpload(auth.userId, id, body);
  }

  @Post()
  @Idempotent({ required: true })
  @WithETag()
  @Contract({
    tag: 'Claims',
    summary:
      'Start a draft claim on a milestone of the current agreement, with evidence',
    body: SaveClaimRequest,
    response: ClaimView,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ClaimView> {
    return this.claims.create(auth.userId, id, body);
  }

  @Get(':claimId')
  @WithETag()
  @Contract({
    tag: 'Claims',
    summary: 'One claim with its evidence',
    response: ClaimView,
  })
  get(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('claimId', uuid) claimId: string,
  ): Promise<ClaimView> {
    return this.claims.get(auth.userId, id, claimId);
  }

  @Put(':claimId')
  @WithETag()
  @Contract({
    tag: 'Claims',
    summary:
      'Save a draft or a claim sent back for changes (If-Match: version)',
    body: SaveClaimRequest,
    response: ClaimView,
    ifMatch: true,
  })
  save(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('claimId', uuid) claimId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<ClaimView> {
    return this.claims.save(auth.userId, id, claimId, ifMatch, body);
  }

  @Post(':claimId/submit')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Claims',
    summary:
      'Send the claim to the owner: needs evidence, and fixed prices cannot be exceeded (If-Match: version)',
    response: ClaimView,
    ifMatch: true,
  })
  submit(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('claimId', uuid) claimId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<ClaimView> {
    return this.claims.submit(auth.userId, id, claimId, ifMatch);
  }

  @Post(':claimId/cancel')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Claims',
    summary: 'Withdraw a claim not yet approved (If-Match: version)',
    response: ClaimView,
    ifMatch: true,
  })
  cancel(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('claimId', uuid) claimId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<ClaimView> {
    return this.claims.cancel(auth.userId, id, claimId, ifMatch);
  }

  @Post(':claimId/decision')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Claims',
    summary:
      'Owner approves, rejects or asks for changes on the version and amount they read (If-Match: version); approving does not pay',
    body: ClaimDecisionRequest,
    response: ClaimView,
    ifMatch: true,
  })
  decide(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('claimId', uuid) claimId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<ClaimView> {
    return this.claims.decide(auth.userId, id, claimId, ifMatch, body);
  }
}
