import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentInfo, HealthResponse } from '@jengalink/contracts';
import { AppService } from './app.service';
import { Public } from './auth/auth.guard';
import { Contract } from './common/contract';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly config: ConfigService,
  ) {}

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

  /** Public: the apps read it before sign-in, to show the Demo banner and the demo people. */
  @Public()
  @Get('environment')
  @Contract({
    tag: 'Health',
    summary: 'What kind of environment this is (demo or real)',
    response: EnvironmentInfo,
  })
  getEnvironment(): EnvironmentInfo {
    return { demo: this.config.get<string>('DEMO_MODE') === 'on' };
  }
}
