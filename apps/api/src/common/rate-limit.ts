import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { lt, sql } from 'drizzle-orm';
import type { Observable } from 'rxjs';
import type { Database } from '../db/client';
import { DB } from '../db/database.module';
import { rateLimits } from '../db/schema';

export interface RateLimitRule {
  /** Shared by every route that should count together (e.g. all upload routes). */
  name: string;
  /** Count per signed-in person, or per network address (public and sign-in routes). */
  by: 'user' | 'ip';
  limit: number;
  windowSeconds: number;
}

const RATE_LIMIT = 'rateLimit';

/** The limits in one place (spec §20). Sign-in codes also have their own per-number limits. */
export const LIMITS = {
  /** Photo and file upload links, all routes together: plenty for a busy site day. */
  uploads: { name: 'uploads', by: 'user', limit: 120, windowSeconds: 3600 },
  /** Checking sign-in codes from one network. */
  otpVerify: { name: 'otp-verify', by: 'ip', limit: 30, windowSeconds: 600 },
  /** Refreshing sessions from one network (a shared office or site connection). */
  refresh: { name: 'refresh', by: 'ip', limit: 120, windowSeconds: 600 },
  /** Opening shared report links (public) from one network. */
  shareLinks: { name: 'share-links', by: 'ip', limit: 120, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>;
/** At most `limit` requests per `windowSeconds`, counted by person or by network address. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT, rule);

/**
 * Counts in Postgres (one upsert per request), so several API instances share the same limits.
 * Over the limit: 429 with `retryAfterSeconds` and a Retry-After header.
 */
@Injectable()
export class RateLimitService {
  /** Off only in automated tests (RATE_LIMITS=off); a test can switch it on for its own checks. */
  enabled: boolean;

  constructor(
    @Inject(DB) private readonly db: Database,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('RATE_LIMITS') !== 'off';
  }

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
    now = Date.now(),
  ) {
    const windowMs = windowSeconds * 1000;
    const start = new Date(Math.floor(now / windowMs) * windowMs);
    const [row] = await this.db
      .insert(rateLimits)
      .values({ key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1`, updatedAt: new Date() },
      })
      .returning({ count: rateLimits.count });
    // Now and then, forget windows older than a day.
    if (Math.random() < 0.01)
      void this.db
        .delete(rateLimits)
        .where(lt(rateLimits.windowStart, new Date(now - 86_400_000)))
        .catch(() => undefined);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((start.getTime() + windowMs - now) / 1000),
    );
    return { allowed: row.count <= limit, retryAfterSeconds };
  }
}

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async intercept(
    ctx: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const rule = this.reflector.get<RateLimitRule | undefined>(
      RATE_LIMIT,
      ctx.getHandler(),
    );
    if (!rule || !this.limits.enabled) return next.handle();
    const req = ctx
      .switchToHttp()
      .getRequest<{ ip?: string; auth?: { userId: string } }>();
    const who = rule.by === 'user' ? req.auth?.userId : req.ip;
    if (!who) return next.handle();
    const r = await this.limits.hit(
      `${rule.name}:${rule.by}:${who}`,
      rule.limit,
      rule.windowSeconds,
    );
    if (!r.allowed) {
      ctx
        .switchToHttp()
        .getResponse<{ setHeader(k: string, v: string): void }>()
        .setHeader('Retry-After', String(r.retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests. Try again in a little while.',
          retryAfterSeconds: r.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return next.handle();
  }
}
