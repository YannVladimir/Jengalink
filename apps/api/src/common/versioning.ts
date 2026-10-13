import {
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';

// Optimistic concurrency (spec §19.1): responses carry ETag "<revision>";
// updates send If-Match with the revision they read; a stale one gets 412.

export const etagFor = (revision: number) => `"${revision}"`;

export class PreconditionRequiredException extends HttpException {
  constructor() {
    super(
      {
        message:
          'Send If-Match with the version you are changing, so nobody else’s change is overwritten.',
        fieldErrors: [{ field: 'If-Match', message: 'Required' }],
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
}

/** 412: someone changed the record since the caller read it. */
export class VersionConflictException extends HttpException {
  constructor(currentRevision?: number) {
    super(
      {
        message:
          'This was changed by someone else. Reload to see the latest version, then try again.',
        ...(currentRevision !== undefined ? { currentRevision } : {}),
      },
      HttpStatus.PRECONDITION_FAILED,
    );
  }
}

/** Accepts "3", W/"3" or 3. Returns null when absent or malformed. */
export function parseIfMatch(header: string | undefined): number | null {
  if (!header) return null;
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header.trim());
  return m ? Number(m[1]) : null;
}

/** The revision the client says it is changing. Missing → 428. */
export const IfMatch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const revision = parseIfMatch(
      ctx.switchToHttp().getRequest<Request>().header('if-match'),
    );
    if (revision === null) throw new PreconditionRequiredException();
    return revision;
  },
);

/** Sets the ETag header from the response body's `revision`. */
@Injectable()
class ETagInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        const revision = (body as { revision?: unknown } | null)?.revision;
        if (typeof revision === 'number')
          res.setHeader('ETag', etagFor(revision));
        return body;
      }),
    );
  }
}

export const WithETag = () => UseInterceptors(ETagInterceptor);
