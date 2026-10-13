import { createHash } from 'node:crypto';
import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.guard';
import type { Database } from '../db/client';
import { DB } from '../db/database.module';
import { idempotencyRecords } from '../db/schema';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_FORMAT = /^[A-Za-z0-9_-]{8,255}$/;
const RETENTION_DAYS = 7;
/** An in-progress claim older than this is treated as abandoned (the server died mid-request). */
const ABANDONED_AFTER_MS = 60_000;

const META = 'idempotency';
interface IdempotencyOptions {
  /** True for writes that could duplicate money, stock, bookings or provider effects (spec §19.1). */
  required: boolean;
}

/** Stable JSON: same content → same hash, whatever the key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * A retry with the same Idempotency-Key and body returns the original response
 * (with `Idempotent-Replayed: true`); the same key with a different body is 409.
 * A failed request releases its key, so the client can retry after fixing it.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.handle(ctx, next));
  }

  private async handle(
    ctx: ExecutionContext,
    next: CallHandler,
  ): Promise<unknown> {
    const options = this.reflector.get<IdempotencyOptions>(
      META,
      ctx.getHandler(),
    );
    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header(IDEMPOTENCY_HEADER);

    if (!key) {
      if (options.required) {
        throw new BadRequestException({
          message:
            'This request needs an Idempotency-Key header, so a retry can never act twice.',
          fieldErrors: [{ field: 'Idempotency-Key', message: 'Required' }],
        });
      }
      return lastValueFrom(next.handle());
    }
    if (!KEY_FORMAT.test(key)) {
      throw new BadRequestException({
        message:
          'Idempotency-Key must be 8–255 letters, digits, dashes or underscores.',
        fieldErrors: [{ field: 'Idempotency-Key', message: 'Invalid format' }],
      });
    }

    const actorUserId = req.auth!.userId;
    const scope = `${req.method} ${req.originalUrl.split('?')[0]}`;
    const bodyHash = createHash('sha256')
      .update(canonical(req.body))
      .digest('hex');
    const sameKey = and(
      eq(idempotencyRecords.actorUserId, actorUserId),
      eq(idempotencyRecords.scope, scope),
      eq(idempotencyRecords.key, key),
    );

    // Clear an expired record, or an abandoned in-progress claim, for this key.
    await this.db
      .delete(idempotencyRecords)
      .where(
        and(
          sameKey,
          or(
            lt(idempotencyRecords.expiresAt, new Date()),
            and(
              eq(idempotencyRecords.state, 'in_progress'),
              lt(
                idempotencyRecords.updatedAt,
                new Date(Date.now() - ABANDONED_AFTER_MS),
              ),
            ),
          ),
        ),
      );

    // Claim the key atomically; only one concurrent request can win.
    const claimed = await this.db
      .insert(idempotencyRecords)
      .values({
        actorUserId,
        scope,
        key,
        bodyHash,
        expiresAt: new Date(Date.now() + RETENTION_DAYS * 86_400_000),
        createdBy: actorUserId,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyRecords.id });

    if (claimed.length === 0) {
      const [existing] = await this.db
        .select()
        .from(idempotencyRecords)
        .where(sameKey);
      if (!existing) throw new ConflictException('Please try again.');
      if (existing.bodyHash !== bodyHash) {
        throw new ConflictException(
          'This Idempotency-Key was already used for a different request.',
        );
      }
      if (existing.state === 'in_progress') {
        throw new ConflictException({
          message:
            'The same request is still being processed. Try again in a moment.',
          retryAfterSeconds: 2,
        });
      }
      res.status(existing.responseStatus ?? 200);
      res.setHeader('Idempotent-Replayed', 'true');
      return existing.responseBody;
    }

    const recordId = claimed[0].id;
    try {
      const body: unknown = await lastValueFrom(next.handle());
      await this.db
        .update(idempotencyRecords)
        .set({
          state: 'completed',
          responseStatus: res.statusCode,
          responseBody: body ?? null,
          updatedAt: new Date(),
          revision: sql`${idempotencyRecords.revision} + 1`,
        })
        .where(eq(idempotencyRecords.id, recordId));
      return body;
    } catch (err) {
      // The action did not happen: release the key so a corrected retry can use it.
      await this.db
        .delete(idempotencyRecords)
        .where(eq(idempotencyRecords.id, recordId));
      throw err;
    }
  }
}

/** Marks a write as idempotent. `required` makes the Idempotency-Key header mandatory. */
export const Idempotent = (options: IdempotencyOptions = { required: false }) =>
  applyDecorators(
    SetMetadata(META, options),
    UseInterceptors(IdempotencyInterceptor),
  );
