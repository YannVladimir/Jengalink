import type { INestApplication } from '@nestjs/common';
import { requestContextMiddleware } from './common/request-context';
import { RequestLogMiddleware } from './observability/request-log.middleware';

/**
 * HTTP wiring shared by main.ts and the e2e tests. Middleware goes on the raw
 * app (not MiddlewareConsumer) so unknown routes get a request id and a log line too.
 */
export function configureApp(app: INestApplication) {
  const requestLog = app.get(RequestLogMiddleware);
  // Request id first, so the request log line carries it.
  app.use(requestContextMiddleware);
  app.use(requestLog.use.bind(requestLog));
  // Signed-in data must not sit in browser or proxy caches (shared phones, spec §3.3: limit caching).
  // ETags still work for If-Match; clients re-fetch instead of reusing a stale body.
  app.use(
    (
      _req: unknown,
      res: { setHeader(k: string, v: string): void },
      next: () => void,
    ) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({
    exposedHeaders: ['ETag', 'x-request-id', 'Idempotent-Replayed'],
  });
  return app;
}
