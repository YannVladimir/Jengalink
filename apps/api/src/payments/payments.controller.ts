import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  PaymentsOverview,
  RecordPaymentRequest,
  RequestClaimUploadRequest,
  UploadGrantView,
  VerifyPaymentRequest,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { PaymentsService } from './payments.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @Contract({
    tag: 'Payments',
    summary:
      'Cash paid (settled only), waiting for verification, owed on approved claims, and every payment',
    response: PaymentsOverview,
  })
  overview(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<PaymentsOverview> {
    return this.payments.overview(auth.userId, id);
  }

  @Post('uploads')
  @Contract({
    tag: 'Payments',
    summary:
      'A short-lived signed PUT for one proof of payment (screenshot, bank slip, PDF)',
    body: RequestClaimUploadRequest,
    response: UploadGrantView,
    status: 201,
  })
  upload(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UploadGrantView> {
    return this.payments.requestUpload(auth.userId, id, body);
  }

  @Post()
  @Idempotent({ required: true })
  @Contract({
    tag: 'Payments',
    summary:
      'Record a payment made outside JengaLink (MoMo, bank, cash) with proof; pending until verified',
    body: RecordPaymentRequest,
    response: PaymentsOverview,
    status: 201,
  })
  record(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<PaymentsOverview> {
    return this.payments.record(auth.userId, id, body);
  }

  @Post(':paymentId/verify')
  @HttpCode(200)
  @Idempotent()
  @Contract({
    tag: 'Payments',
    summary:
      'The other side, or finance, confirms the money arrived (settled) or disputes it (If-Match)',
    body: VerifyPaymentRequest,
    response: PaymentsOverview,
    ifMatch: true,
  })
  verify(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('paymentId', uuid) paymentId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<PaymentsOverview> {
    return this.payments.verify(auth.userId, id, paymentId, ifMatch, body);
  }

  @Post(':paymentId/cancel')
  @HttpCode(200)
  @Contract({
    tag: 'Payments',
    summary:
      'Withdraw a payment you recorded, before it is verified (If-Match)',
    response: PaymentsOverview,
    ifMatch: true,
  })
  cancel(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('paymentId', uuid) paymentId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<PaymentsOverview> {
    return this.payments.cancel(auth.userId, id, paymentId, ifMatch);
  }
}
