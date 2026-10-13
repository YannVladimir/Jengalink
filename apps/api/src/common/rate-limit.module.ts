import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RateLimitInterceptor, RateLimitService } from './rate-limit';

@Global()
@Module({
  providers: [
    RateLimitService,
    { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}
