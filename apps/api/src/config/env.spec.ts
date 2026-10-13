import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { allowedOrigins } from '../app.setup';
import { validateEnv } from './env';

const strong = (c: string) => c.repeat(40);
const base = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://jengalink:jengalink@localhost:5433/jengalink_dev',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_BUCKET: 'jengalink-dev',
  S3_ACCESS_KEY_ID: 'jengalink',
  S3_SECRET_ACCESS_KEY: 'jengalink-local-secret',
  JWT_SECRET: strong('a'),
  OTP_PEPPER: strong('b'),
};
const hosted = {
  ...base,
  APP_ENV: 'production',
  DATABASE_URL: 'postgres://app:Xk29fz@db.internal:5432/jengalink',
  S3_SECRET_ACCESS_KEY: 'Zq81-real-secret',
  SMS_PROVIDER: 'console',
  PUSH_PROVIDER: 'expo',
  CLAMAV_HOST: 'clamav',
  WEB_APP_URL: 'https://app.jengalink.rw',
};

describe('environment and secrets', () => {
  it('reads secrets from files (vaults, Docker and Kubernetes secrets)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jl-secrets-'));
    writeFileSync(join(dir, 'jwt'), `${strong('c')}\n`);
    const env = validateEnv({
      ...base,
      JWT_SECRET: undefined,
      JWT_SECRET_FILE: join(dir, 'jwt'),
    });
    expect(env.JWT_SECRET).toBe(strong('c'));
    expect(() =>
      validateEnv({ ...base, JWT_SECRET_FILE: join(dir, 'jwt') }),
    ).toThrow(/not both/);
    expect(() =>
      validateEnv({
        ...base,
        JWT_SECRET: undefined,
        JWT_SECRET_FILE: join(dir, 'missing'),
      }),
    ).toThrow(/cannot be read/);
  });

  it('refuses development secrets, a shared secret and plain http where real people’s data lives', () => {
    // Production also needs a real SMS provider (none chosen yet in A0); staging runs the same secret checks.
    const prod = (over: Record<string, unknown>) => () =>
      validateEnv({ ...hosted, ...over });
    expect(prod({})).toThrow(/SMS_PROVIDER/); // still no real SMS provider in A0
    const staging = (over: Record<string, unknown>) => () =>
      validateEnv({ ...hosted, APP_ENV: 'staging', ...over });
    expect(staging({})).not.toThrow();
    expect(staging({ S3_SECRET_ACCESS_KEY: 'jengalink-local-secret' })).toThrow(
      /development secret/,
    );
    expect(staging({ DATABASE_URL: base.DATABASE_URL })).toThrow(
      /development secret/,
    );
    expect(staging({ OTP_PEPPER: hosted.JWT_SECRET })).toThrow(
      /must be different/,
    );
    expect(staging({ WEB_APP_URL: 'http://app.jengalink.rw' })).toThrow(
      /https/,
    );
    expect(() =>
      validateEnv({ ...base, OTP_PEPPER: base.JWT_SECRET }),
    ).not.toThrow(); // development is relaxed
  });

  it('allows browsers only from the web app (plus local previews in development)', () => {
    const cfg = (v: Record<string, string>) => new ConfigService(v);
    expect(
      allowedOrigins(cfg({ WEB_APP_URL: 'https://app.jengalink.rw/' }), true),
    ).toEqual(['https://app.jengalink.rw']);
    expect(
      allowedOrigins(
        cfg({
          WEB_APP_URL: 'https://app.jengalink.rw',
          CORS_ORIGINS: 'https://a.rw, https://b.rw',
        }),
        true,
      ),
    ).toEqual(['https://a.rw', 'https://b.rw']);
    expect(
      allowedOrigins(cfg({ WEB_APP_URL: 'http://localhost:5173' }), false),
    ).toEqual(
      expect.arrayContaining([
        'http://localhost:5173',
        'http://localhost:8090',
      ]),
    );
  });
});
