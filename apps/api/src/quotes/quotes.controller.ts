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
  Query,
} from '@nestjs/common';
import {
  AgreementView,
  QuoteDecisionRequest,
  QuotePdfLink,
  QuoteSummary,
  QuoteView,
  SaveQuoteRequest,
} from '@jengalink/contracts';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { Idempotent } from '../common/idempotency';
import { WithETag } from '../common/versioning';
import { ZodPipe } from '../common/zod.pipe';
import { QuotesService } from './quotes.service';

const uuid = new ParseUUIDPipe({ version: '7' });
const RevisionQuery = z
  .object({ revision: z.coerce.number().int().min(1).optional() })
  .meta({ id: 'QuoteRevisionQuery' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id/quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @Contract({
    tag: 'Quotes',
    summary: 'Quotes on the project (owners and others see sent ones only)',
    response: QuoteSummary,
    list: true,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<QuoteSummary[]> {
    return this.quotes.list(auth.userId, id);
  }

  @Post()
  @Idempotent()
  @WithETag()
  @Contract({
    tag: 'Quotes',
    summary:
      'Start a quote: scope, exclusions, priced milestones, validity (contractor, manager)',
    body: SaveQuoteRequest,
    response: QuoteView,
    status: 201,
  })
  create(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    return this.quotes.create(auth.userId, id, body);
  }

  @Get(':quoteId')
  @WithETag()
  @Contract({
    tag: 'Quotes',
    summary: 'One quote (latest visible revision, or ?revision=n)',
    query: RevisionQuery,
    response: QuoteView,
  })
  get(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('quoteId', uuid) quoteId: string,
    @Query(new ZodPipe(RevisionQuery)) query: z.infer<typeof RevisionQuery>,
  ): Promise<QuoteView> {
    return this.quotes.get(auth.userId, id, quoteId, query.revision);
  }

  @Put(':quoteId')
  @WithETag()
  @Contract({
    tag: 'Quotes',
    summary:
      'Save the draft; after sending, saving starts a new revision (If-Match: version)',
    body: SaveQuoteRequest,
    response: QuoteView,
    ifMatch: true,
  })
  save(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('quoteId', uuid) quoteId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    return this.quotes.save(auth.userId, id, quoteId, ifMatch, body);
  }

  @Post(':quoteId/send')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Quotes',
    summary:
      'Send the latest draft revision to the owner (it is frozen from then on)',
    response: QuoteView,
  })
  send(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('quoteId', uuid) quoteId: string,
  ): Promise<QuoteView> {
    return this.quotes.send(auth.userId, id, quoteId);
  }

  @Post(':quoteId/decision')
  @HttpCode(200)
  @WithETag()
  @Contract({
    tag: 'Quotes',
    summary:
      'Owner accepts (creates the next agreement version, sets the contract value) or declines the exact revision; If-Match: version',
    body: QuoteDecisionRequest,
    response: QuoteView,
    ifMatch: true,
  })
  decide(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('quoteId', uuid) quoteId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    return this.quotes.decide(auth.userId, id, quoteId, ifMatch, body);
  }

  @Post(':quoteId/pdf')
  @HttpCode(200)
  @Contract({
    tag: 'Quotes',
    summary: 'A 5-minute private link to the branded PDF, in your language',
    query: RevisionQuery,
    response: QuotePdfLink,
  })
  pdf(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('quoteId', uuid) quoteId: string,
    @Query(new ZodPipe(RevisionQuery)) query: z.infer<typeof RevisionQuery>,
  ): Promise<QuotePdfLink> {
    return this.quotes.pdf(auth.userId, id, quoteId, query.revision);
  }
}

@Controller('projects/:id/agreements')
export class AgreementsController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @Contract({
    tag: 'Quotes',
    summary: 'Agreement versions (what the owner accepted), newest first',
    response: AgreementView,
    list: true,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<AgreementView[]> {
    return this.quotes.agreements(auth.userId, id);
  }
}
