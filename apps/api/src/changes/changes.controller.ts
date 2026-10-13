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
  BudgetChangeDecisionRequest,
  BudgetChangesOverview,
  BudgetChangeView,
  RequestClaimUploadRequest,
  SaveBudgetChangeRequest,
  UploadGrantView,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { WithETag } from '../common/versioning';
import { ChangesService } from './changes.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id/changes')
export class ChangesController {
  constructor(private readonly changes: ChangesService) {}

  @Get()
  @Contract({
    tag: 'Changes',
    summary:
      'The budget per package (original, approved changes, current) and every budget change',
    response: BudgetChangesOverview,
  })
  overview(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<BudgetChangesOverview> {
    return this.changes.overview(auth.userId, id);
  }

  @Post('uploads')
  @Contract({
    tag: 'Changes',
    summary:
      'A short-lived signed PUT for one piece of evidence (quotation, drawing, photo)',
    body: RequestClaimUploadRequest,
    response: UploadGrantView,
    status: 201,
  })
  upload(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UploadGrantView> {
    return this.changes.requestUpload(auth.userId, id, body);
  }

  @Post()
  @Idempotent({ required: true })
  @WithETag()
  @Contract({
    tag: 'Changes',
    summary:
      'Propose a budget change: deltas to named packages, with a reason (draft)',
    body: SaveBudgetChangeRequest,
    response: BudgetChangeView,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<BudgetChangeView> {
    return this.changes.create(auth.userId, id, body);
  }

  @Get(':changeId')
  @WithETag()
  @Contract({
    tag: 'Changes',
    summary:
      'One budget change: lines before → after, floors, evidence and answers',
    response: BudgetChangeView,
  })
  get(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('changeId', uuid) changeId: string,
  ): Promise<BudgetChangeView> {
    return this.changes.get(auth.userId, id, changeId);
  }

  @Put(':changeId')
  @WithETag()
  @Contract({
    tag: 'Changes',
    summary: 'Save a change not yet answered (If-Match: version)',
    body: SaveBudgetChangeRequest,
    response: BudgetChangeView,
    ifMatch: true,
  })
  save(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('changeId', uuid) changeId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<BudgetChangeView> {
    return this.changes.save(auth.userId, id, changeId, ifMatch, body);
  }

  @Post(':changeId/submit')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Changes',
    summary:
      'Send to the owner (based on the current agreement, no package below what is used)',
    response: BudgetChangeView,
    ifMatch: true,
  })
  submit(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('changeId', uuid) changeId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<BudgetChangeView> {
    return this.changes.submit(auth.userId, id, changeId, ifMatch);
  }

  @Post(':changeId/decision')
  @HttpCode(200)
  @Idempotent()
  @WithETag()
  @Contract({
    tag: 'Changes',
    summary:
      'Owner approves (applies it as the next agreement version in one transaction) or rejects the exact net change (If-Match)',
    body: BudgetChangeDecisionRequest,
    response: BudgetChangeView,
    ifMatch: true,
  })
  decide(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('changeId', uuid) changeId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<BudgetChangeView> {
    return this.changes.decide(auth.userId, id, changeId, ifMatch, body);
  }

  @Post(':changeId/withdraw')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Changes',
    summary: 'Withdraw a change not yet answered (If-Match)',
    response: BudgetChangeView,
    ifMatch: true,
  })
  withdraw(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('changeId', uuid) changeId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<BudgetChangeView> {
    return this.changes.withdraw(auth.userId, id, changeId, ifMatch);
  }
}
