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
  PostExpenseRequest,
  ReviewReceiptRequest,
  SaveReceiptRequest,
  ProjectBudget,
  RequestClaimUploadRequest,
  SaveSpendingRequest,
  SpendingDecisionRequest,
  SpendingSummary,
  SpendingView,
  UploadGrantView,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { WithETag } from '../common/versioning';
import { ReceiptsService } from './receipts.service';
import { SpendingService } from './spending.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id')
export class SpendingController {
  constructor(
    private readonly spending: SpendingService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get('budget')
  @Contract({
    tag: 'Spending',
    summary:
      'Cost + fee packages as budget lines: cost budget, pending, committed, posted, headroom',
    response: ProjectBudget,
  })
  budget(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ProjectBudget> {
    return this.spending.budget(auth.userId, id);
  }

  @Get('spending')
  @Contract({
    tag: 'Spending',
    summary:
      'Spending requests, newest first (drafts for the contractor side only)',
    response: SpendingSummary,
    list: true,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<SpendingSummary[]> {
    return this.spending.list(auth.userId, id);
  }

  @Post('spending/uploads')
  @Contract({
    tag: 'Spending',
    summary: 'A short-lived signed PUT for one quotation or evidence file',
    body: RequestClaimUploadRequest,
    response: UploadGrantView,
    status: 201,
  })
  upload(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UploadGrantView> {
    return this.spending.requestUpload(auth.userId, id, body);
  }

  @Post('spending')
  @Idempotent({ required: true })
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary:
      'Start a draft spending request on a cost + fee package (the server prices the lines)',
    body: SaveSpendingRequest,
    response: SpendingView,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<SpendingView> {
    return this.spending.create(auth.userId, id, body);
  }

  @Get('spending/:requestId')
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary: 'One spending request with its ledger, expenses and answers',
    response: SpendingView,
  })
  get(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
  ): Promise<SpendingView> {
    return this.spending.get(auth.userId, id, requestId);
  }

  @Put('spending/:requestId')
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary: 'Save a request not yet approved (If-Match: version)',
    body: SaveSpendingRequest,
    response: SpendingView,
    ifMatch: true,
  })
  save(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<SpendingView> {
    return this.spending.save(auth.userId, id, requestId, ifMatch, body);
  }

  @Post('spending/:requestId/submit')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary:
      'Send to the owner; it must fit the package headroom (If-Match: version)',
    response: SpendingView,
    ifMatch: true,
  })
  submit(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<SpendingView> {
    return this.spending.submit(auth.userId, id, requestId, ifMatch);
  }

  @Post('spending/:requestId/decision')
  @HttpCode(200)
  @Idempotent()
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary:
      'Owner approves (reserves budget after a locked headroom check), rejects or asks for changes (If-Match: version)',
    body: SpendingDecisionRequest,
    response: SpendingView,
    ifMatch: true,
  })
  decide(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<SpendingView> {
    return this.spending.decide(auth.userId, id, requestId, ifMatch, body);
  }

  @Post('spending/:requestId/expenses')
  @Idempotent({ required: true })
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary:
      'Record a direct expense: posts cost and converts that much of the reservation (no payment)',
    body: PostExpenseRequest,
    response: SpendingView,
    status: 201,
  })
  postExpense(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
    @Body() body: unknown,
  ): Promise<SpendingView> {
    return this.spending.postExpense(auth.userId, id, requestId, body);
  }

  @Post('spending/:requestId/close')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary:
      'Close an approved request and release what is still reserved (If-Match)',
    response: SpendingView,
    ifMatch: true,
  })
  close(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<SpendingView> {
    return this.spending.close(auth.userId, id, requestId, ifMatch);
  }

  @Post('spending/:requestId/withdraw')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary: 'Withdraw a request not yet approved (If-Match: version)',
    response: SpendingView,
    ifMatch: true,
  })
  withdraw(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<SpendingView> {
    return this.spending.withdraw(auth.userId, id, requestId, ifMatch);
  }

  @Post('receipts/uploads')
  @Contract({
    tag: 'Spending',
    summary: 'A short-lived signed PUT for one receipt photo or PDF',
    body: RequestClaimUploadRequest,
    response: UploadGrantView,
    status: 201,
  })
  receiptUpload(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UploadGrantView> {
    return this.receipts.requestUpload(auth.userId, id, body);
  }

  @Put('expenses/:expenseId/receipt')
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary:
      'Capture or correct the supplier receipt of an expense (EBM fields; If-Match once it exists). Returns the request.',
    body: SaveReceiptRequest,
    response: SpendingView,
    ifMatch: true,
  })
  async saveReceipt(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('expenseId', uuid) expenseId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<SpendingView> {
    const requestId = await this.receipts.save(
      auth.userId,
      id,
      expenseId,
      ifMatch,
      body,
    );
    return this.spending.get(auth.userId, id, requestId);
  }

  @Post('expenses/:expenseId/receipt/review')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Spending',
    summary:
      'An independent reviewer marks the receipt manually reviewed or a discrepancy (If-Match). Returns the request.',
    body: ReviewReceiptRequest,
    response: SpendingView,
    ifMatch: true,
  })
  async reviewReceipt(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('expenseId', uuid) expenseId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<SpendingView> {
    const requestId = await this.receipts.review(
      auth.userId,
      id,
      expenseId,
      ifMatch,
      body,
    );
    return this.spending.get(auth.userId, id, requestId);
  }
}
