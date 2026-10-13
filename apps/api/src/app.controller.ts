import { Controller, Get } from '@nestjs/common';
import { HealthResponse } from '@jengalink/contracts';
import { AppService } from './app.service';
import { Public } from './auth/auth.guard';
import { Contract } from './common/contract';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @Contract({
    tag: 'Health',
    summary: 'Service, database and storage status',
    response: HealthResponse,
  })
  getHealth(): Promise<HealthResponse> {
    return this.appService.getHealth();
  }
}
