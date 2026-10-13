import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorBody } from '@jengalink/contracts';
import type { Response } from 'express';
import { captureServerError } from '../observability/sentry';
import { requestContext } from './request-context';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  412: 'version_conflict',
  413: 'too_large',
  422: 'validation_failed',
  428: 'precondition_required',
  429: 'rate_limited',
  503: 'unavailable',
};

/**
 * One error shape for every response (spec §3.3): code, message, fieldErrors,
 * requestId, retryable. Extra safe fields (attemptsLeft, retryAfterSeconds)
 * are kept. Unexpected errors never leak internals.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = requestContext()?.requestId ?? 'unknown';

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong on our side. Please try again.';
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const rest = { ...(body as Record<string, unknown>) };
        const m = rest.message;
        // Nest's own fields are replaced by the spec's shape below.
        delete rest.message;
        delete rest.statusCode;
        delete rest.error;
        message = Array.isArray(m)
          ? m.join('. ')
          : typeof m === 'string'
            ? m
            : exception.message;
        extra = rest;
      }
    } else {
      captureServerError(exception, {
        route: host
          .switchToHttp()
          .getRequest<{ originalUrl?: string }>()
          .originalUrl?.split('?')[0],
      });
      this.logger.error(
        `Unhandled error (request ${requestId})`,
        exception as Error,
      );
    }

    const payload: ApiErrorBody = {
      statusCode: status,
      code: CODES[status] ?? (status >= 500 ? 'server_error' : 'error'),
      message,
      fieldErrors: (extra.fieldErrors as ApiErrorBody['fieldErrors']) ?? [],
      requestId,
      retryable: status === 429 || status >= 500,
      ...extra,
    };
    // Deliberate 5xx responses (e.g. SMS provider down) are worth knowing about too.
    if (status >= 500 && exception instanceof HttpException)
      captureServerError(exception);
    res.status(status).json(payload);
  }
}
