import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.guard';
import { JengaLogger } from './logger';

/** One line per request: method, path, status, duration, user id. Never bodies or headers. */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  constructor(private readonly logger: JengaLogger) {}

  use(req: Request & { auth?: AuthUser }, res: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      const durationMs = Math.round(
        Number(process.hrtime.bigint() - started) / 1e6,
      );
      this.logger.event(
        status >= 500 ? 'error' : 'info',
        'request',
        {
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status,
          durationMs,
          ...(req.auth ? { userId: req.auth.userId } : {}),
        },
        'HTTP',
      );
    });
    next();
  }
}
