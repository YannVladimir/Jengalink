import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const appEnvs = [
  'development',
  'test',
  'staging',
  'production',
] as const;
export type AppEnv = (typeof appEnvs)[number];

export const envSchema = z.object({
  APP_ENV: z.enum(appEnvs),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().startsWith('postgres'),
  // S3-compatible private object storage.
  S3_ENDPOINT: z.string().url(),
  // Host that phones and browsers use for signed links (defaults to S3_ENDPOINT).
  S3_PUBLIC_ENDPOINT: z.union([z.string().url(), z.literal('')]).optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Signs 15-minute access tokens. Long random string; different per environment.
  JWT_SECRET: z.string().min(32),
  // Mixed into sign-in code hashes so a database leak does not reveal codes.
  OTP_PEPPER: z.string().min(32),
  // Where sign-in codes go. 'console' prints them (development); real providers come later.
  SMS_PROVIDER: z.enum(['console']).default('console'),
  EMAIL_PROVIDER: z.enum(['console']).default('console'),
  // Pushes to phones: 'console' prints them (development); 'expo' sends through Expo's push service.
  PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  // Optional: Expo access token when 'Enhanced push security' is on for the project.
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),
  // Base URL of the web app, used in invitation links and messages.
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
  // Logs: json in staging/production (one object per line), pretty elsewhere.
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.union([z.enum(['pretty', 'json']), z.literal('')]).optional(),
  // Error tracking; leave empty to keep Sentry off.
  SENTRY_DSN: z.union([z.string().url(), z.literal('')]).optional(),
  // Virus scanning (clamd). Empty = a basic EICAR-only check, allowed outside production only.
  CLAMAV_HOST: z.string().optional().default(''),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  // Behind a load balancer or proxy: how many hops to trust for the client address (rate limits,
  // audit). 0 = connect directly (development). Hosted environments usually need 1.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // Web origins allowed to call the API from a browser (comma-separated). Empty = WEB_APP_URL,
  // plus the local preview ports outside staging and production. Phones send no origin.
  CORS_ORIGINS: z.string().optional().default(''),
  // Rate limits (sign-in checks, uploads, share links). Off only for automated tests.
  RATE_LIMITS: z.enum(['on', 'off']).default('on'),
  // Runs pg-boss workers and the outbox relay in this process.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = Omit<z.infer<typeof envSchema>, 'LOG_FORMAT'> & {
  LOG_FORMAT: 'pretty' | 'json';
};

/**
 * Secrets that may come from a file instead of the environment: `JWT_SECRET_FILE=/run/secrets/jwt`.
 * This is how Docker and Kubernetes secrets and most cloud secret managers (a vault) hand them over,
 * so the values never sit in the environment, a shell history or a deploy config.
 */
export const FILE_SECRETS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'OTP_PEPPER',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'EXPO_ACCESS_TOKEN',
  'SENTRY_DSN',
  'BACKUP_KEY',
] as const;

export function withFileSecrets(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...raw };
  for (const k of FILE_SECRETS) {
    const file = raw[`${k}_FILE`];
    if (typeof file !== 'string' || !file) continue;
    if (raw[k])
      throw new Error(`Invalid environment: set ${k} or ${k}_FILE, not both`);
    try {
      out[k] = readFileSync(file, 'utf8').trim();
    } catch {
      throw new Error(
        `Invalid environment: ${k}_FILE (${file}) cannot be read`,
      );
    }
  }
  return out;
}

/** Values from .env.example and local development: never acceptable where real people's data lives. */
const DEV_VALUES = ['jengalink-local-secret', 'jengalink:jengalink@'];

/** Validates process env at startup; the API refuses to boot on a bad config. */
export function validateEnv(input: Record<string, unknown>): Env {
  const raw = withFileSecrets(input);
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  const env = parsed.data;
  // The console sender prints sign-in codes: never allowed in production.
  if (
    env.APP_ENV === 'production' &&
    (env.SMS_PROVIDER === 'console' || env.EMAIL_PROVIDER === 'console')
  ) {
    throw new Error(
      'Invalid environment: SMS_PROVIDER/EMAIL_PROVIDER "console" is for development only',
    );
  }
  // Real people get real pushes in production.
  if (env.APP_ENV === 'production' && env.PUSH_PROVIDER === 'console') {
    throw new Error(
      'Invalid environment: PUSH_PROVIDER "console" is for development only',
    );
  }
  // Uploaded photos must be virus-scanned by a real engine in production.
  if (env.APP_ENV === 'production' && !env.CLAMAV_HOST) {
    throw new Error(
      'Invalid environment: CLAMAV_HOST is required in production',
    );
  }
  const hosted = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
  if (hosted) {
    // Real secrets only: no development values, and each secret different.
    const secretValues = [
      env.DATABASE_URL,
      env.S3_SECRET_ACCESS_KEY,
      env.JWT_SECRET,
      env.OTP_PEPPER,
    ];
    if (secretValues.some((v) => DEV_VALUES.some((d) => v.includes(d))))
      throw new Error(
        'Invalid environment: a development secret is set in a hosted environment',
      );
    if (env.RATE_LIMITS === 'off')
      throw new Error(
        'Invalid environment: RATE_LIMITS must be on in a hosted environment',
      );
    if (env.JWT_SECRET === env.OTP_PEPPER)
      throw new Error(
        'Invalid environment: JWT_SECRET and OTP_PEPPER must be different',
      );
    if (!env.WEB_APP_URL.startsWith('https://'))
      throw new Error(
        'Invalid environment: WEB_APP_URL must be https in a hosted environment',
      );
  }
  return { ...env, LOG_FORMAT: env.LOG_FORMAT || (hosted ? 'json' : 'pretty') };
}

/** Jest sets NODE_ENV=test; everything else reads .env. Hosted envs use real env vars. */
export const envFilePath =
  process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
