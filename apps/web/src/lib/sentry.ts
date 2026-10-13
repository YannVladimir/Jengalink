import * as Sentry from '@sentry/react';

// Same rules as the API's redact(): phones, emails and tokens never leave the browser.
const RULES: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]'],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g, '[jwt]'],
  [/(?:\+?250|\b0)7\d{8}\b/g, '[phone]'],
  [/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
];
const redact = (s: string) => RULES.reduce((out, [re, to]) => out.replace(re, to), s);

/** Starts error tracking only when VITE_SENTRY_DSN is set at build time. */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) event.request = { url: event.request.url?.split('?')[0] };
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      if (event.message) event.message = redact(event.message);
      for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = redact(ex.value);
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.message) crumb.message = redact(crumb.message);
      // Fetch/XHR breadcrumbs carry URLs with ids and queries; keep only the path.
      if (crumb.data?.url) crumb.data = { ...crumb.data, url: String(crumb.data.url).split('?')[0] };
      return crumb;
    },
  });
}
