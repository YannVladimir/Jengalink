import { Controller, Get } from '@nestjs/common';
import { DecisionInbox } from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { DecisionsService } from './decisions.service';

@Controller('decisions')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Get()
  @Contract({
    tag: 'Decisions',
    summary:
      'Everything waiting on you across your projects, oldest first, with where to decide it',
    response: DecisionInbox,
  })
  inbox(@CurrentUser() auth: AuthUser): Promise<DecisionInbox> {
    return this.decisions.inbox(auth.userId);
  }
}
