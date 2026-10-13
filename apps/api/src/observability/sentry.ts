import * as Sentry from '@sentry/node';
import { requestContext } from '../common/request-context';
import { redact, redactValue } from './redact';

let enabled = false;

/**
 * Sends a copy of an event with personal data removed: no request bodies,
 * headers, cookies, IPs or contacts; only the user id and the request id.
 */
export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
  }
  if (event.user)
    event.user = event.user.id ? { id: event.user.id } : undefined;
  if (event.message) event.message = redact(event.message);
  for (const ex of event.exception?.values ?? [])
    if (ex.value) ex.value = redact(ex.value);
  if (event.extra)
    event.extra = redactValue(event.extra) as Record<string, unknown>;
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = redact(b.message);
    if (b.data) b.data = redactValue(b.data) as Record<string, unknown>;
  }
  return event;
}

/** Starts Sentry only when SENTRY_DSN is set; otherwise every call is a no-op. */
export function initSentry(
  dsn: string | undefined,
  environment: string,
  release: string,
) {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment,
    release: `jengalink-api@${release}`,
    // Collect no personal data automatically; scrubEvent removes anything left.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
  enabled = true;
  return true;
}

/** Reports an unexpected server error (never 4xx), tagged with the request id. */
export function captureServerError(
  error: unknown,
  extra: { userId?: string; route?: string } = {},
) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    const ctx = requestContext();
    if (ctx?.requestId) scope.setTag('request_id', ctx.requestId);
    if (extra.route) scope.setTag('route', extra.route);
    if (extra.userId) scope.setUser({ id: extra.userId });
    Sentry.captureException(error);
  });
}
