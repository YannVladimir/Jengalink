import { Global, Module } from '@nestjs/common';
import { JengaLogger } from './logger';
import { RequestLogMiddleware } from './request-log.middleware';

@Global()
@Module({
  providers: [JengaLogger, RequestLogMiddleware],
  exports: [JengaLogger],
})
export class ObservabilityModule {}
