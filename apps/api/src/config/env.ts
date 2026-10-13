import { z } from 'zod';

export const appEnvs = [
  'development',
  'test',
  'staging',
  'production',
] as const;
export type AppEnv = (typeof appEnvs)[number];

const envSchema = z.object({
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
  // Runs pg-boss workers and the outbox relay in this process.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = Omit<z.infer<typeof envSchema>, 'LOG_FORMAT'> & {
  LOG_FORMAT: 'pretty' | 'json';
};

/** Validates process env at startup; the API refuses to boot on a bad config. */
export function validateEnv(raw: Record<string, unknown>): Env {
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
  return { ...env, LOG_FORMAT: env.LOG_FORMAT || (hosted ? 'json' : 'pretty') };
}

/** Jest sets NODE_ENV=test; everything else reads .env. Hosted envs use real env vars. */
export const envFilePath =
  process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
