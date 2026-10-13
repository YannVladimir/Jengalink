import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
  const config = app.get(ConfigService);
  const hosted = ['staging', 'production'].includes(
    config.get<string>('APP_ENV') ?? '',
  );
  // Behind a proxy, the client address comes from X-Forwarded-For (rate limits, audit trail).
  const hops = config.get<number>('TRUST_PROXY') ?? 0;
  if (hops > 0) (app as NestExpressApplication).set('trust proxy', hops);
  // Security headers: this API only returns JSON, so nothing may be framed, sniffed or embedded.
  app.use(
    (
      _req: unknown,
      res: { setHeader(k: string, v: string): void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'",
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      if (hosted)
        res.setHeader(
          'Strict-Transport-Security',
          'max-age=31536000; includeSubDomains',
        );
      next();
    },
  );
  // Browsers: only the web app (and local previews in development). Phones send no Origin.
  app.enableCors({
    origin: allowedOrigins(config, hosted),
    exposedHeaders: [
      'ETag',
      'x-request-id',
      'Idempotent-Replayed',
      'Retry-After',
    ],
  });
  return app;
}

/** WEB_APP_URL (or CORS_ORIGINS), plus the local preview ports outside staging and production. */
export function allowedOrigins(
  config: ConfigService,
  hosted: boolean,
): string[] {
  const listed = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const web = new URL(
    config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173',
  ).origin;
  const base = listed.length ? listed : [web];
  if (hosted) return base;
  const local = [5173, 4173, 8081, 8090, 19006].flatMap((port) => [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  return [...new Set([...base, ...local])];
}
