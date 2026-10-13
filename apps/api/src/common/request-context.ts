import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  ip: string | undefined;
  /** Set by the auth guard once the session is verified. */
  sessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The current request's id and IP, for audit events and error bodies. */
export const requestContext = (): RequestContext | undefined =>
  storage.getStore();

const SAFE_ID = /^[\w-]{8,64}$/;

/**
 * Gives every request an id (reusing a well-formed incoming x-request-id) and
 * returns it in the response header, so a user's error report can be traced.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const incoming = req.header('x-request-id');
  const requestId =
    incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', requestId);
  storage.run({ requestId, ip: req.ip }, next);
}

/** Runs fn inside a request context (jobs and tests). */
export const runWithRequestContext = <T>(
  ctx: Pick<RequestContext, 'requestId'> & Partial<RequestContext>,
  fn: () => T,
): T => storage.run({ ip: undefined, ...ctx }, fn);
