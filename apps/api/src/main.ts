import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JengaLogger } from './observability/logger';
import { initSentry } from './observability/sentry';

async function bootstrap() {
  // Buffer start-up logs until the structured logger (which needs config) is ready.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(JengaLogger);
  app.useLogger(logger);
  const config = app.get(ConfigService);
  const sentry = initSentry(
    config.get<string>('SENTRY_DSN'),
    config.getOrThrow<string>('APP_ENV'),
    process.env.npm_package_version ?? '0.0.0',
  );
  logger.log(
    sentry
      ? 'Error tracking on (Sentry)'
      : 'Error tracking off (no SENTRY_DSN)',
    'Bootstrap',
  );
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
