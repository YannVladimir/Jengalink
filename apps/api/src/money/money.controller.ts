import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MoneyAcross, ProjectMoney } from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { MoneyService } from './money.service';

const uuid = new ParseUUIDPipe({ version: '7' });

@Controller()
export class MoneyController {
  constructor(private readonly money: MoneyService) {}

  @Get('projects/:id/money')
  @Contract({
    tag: 'Payments',
    summary:
      'The Money screen for one project: contract bar figures, claims with step dates, latest payments, what waits on you',
    response: ProjectMoney,
  })
  project(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ProjectMoney> {
    return this.money.project(auth.userId, id);
  }

  @Get('money')
  @Contract({
    tag: 'Payments',
    summary:
      'Amounts owed and due across every project you can see money on, and what waits on you',
    response: MoneyAcross,
  })
  across(@CurrentUser() auth: AuthUser): Promise<MoneyAcross> {
    return this.money.across(auth.userId);
  }
}
