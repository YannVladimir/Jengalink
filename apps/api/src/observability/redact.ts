// Masks personal data and secrets before anything is logged or sent to Sentry
// (spec §21: keep tokens and personal data out of logs; spec §33: no names,
// phone numbers or amounts in analytics).

const RULES: [RegExp, (m: string) => string][] = [
  // Bearer / JWT access tokens
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, () => 'Bearer [redacted]'],
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    () => '[jwt]',
  ],
  // Refresh tokens: "<uuid>.<base64url secret>"
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{20,}/g,
    () => '[refresh-token]',
  ],
  // Rwandan mobiles: +2507XXXXXXXX, 2507XXXXXXXX, 07XXXXXXXX → keep the last 3 digits
  [/(?:\+?250|\b0)7\d{8}\b/g, (m) => `[phone …${m.slice(-3)}]`],
  // Email addresses → keep the first letter and the domain
  [
    /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    (m) => m.replace(/^(.)[^@]*/, '$1***'),
  ],
];

export function redact(text: string): string {
  return RULES.reduce((out, [re, fn]) => out.replace(re, fn), text);
}

const SECRET_KEYS =
  /^(authorization|cookie|password|token|accessToken|refreshToken|code|otp|secret|codeHash|tokenHash)$/i;

/** Deep-copies a value with secret fields removed and strings redacted. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value instanceof Error)
    return {
      name: value.name,
      message: redact(value.message),
      stack: value.stack && redact(value.stack),
    };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redactValue(v, depth + 1);
    return out;
  }
  return value;
}
