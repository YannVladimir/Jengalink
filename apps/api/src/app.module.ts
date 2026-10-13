import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ObservabilityModule } from './observability/observability.module';
import { envFilePath, validateEnv } from './config/env';
import { DatabaseModule } from './db/database.module';
import { JobsModule } from './jobs/jobs.module';
import { LocationsModule } from './locations/locations.module';
import { MessagingModule } from './messaging/messaging.module';
import { ClaimsModule } from './claims/claims.module';
import { SpendingModule } from './spending/spending.module';
import { PaymentsModule } from './payments/payments.module';
import { MoneyModule } from './money/money.module';
import { ChangesModule } from './changes/changes.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DecisionsModule } from './decisions/decisions.module';
import { ExportsModule } from './exports/exports.module';
import { RateLimitModule } from './common/rate-limit.module';
import { QuotesModule } from './quotes/quotes.module';
import { SiteUpdatesModule } from './updates/site-updates.module';
import { ProjectsModule } from './projects/projects.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    LocationsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath,
      validate: validateEnv,
    }),
    ObservabilityModule,
    DatabaseModule,
    JobsModule,
    StorageModule,
    MessagingModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    SiteUpdatesModule,
    QuotesModule,
    ClaimsModule,
    SpendingModule,
    PaymentsModule,
    MoneyModule,
    ChangesModule,
    ReportsModule,
    NotificationsModule,
    DecisionsModule,
    ExportsModule,
    RateLimitModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
