import type { ConfigService } from '@nestjs/config';
import type { ErrorEvent } from '@sentry/node';
import { validateEnv } from '../config/env';
import { runWithRequestContext } from '../common/request-context';
import { JengaLogger } from './logger';
import { redact, redactValue } from './redact';
import { scrubEvent } from './sentry';

const parse = (l: string) => JSON.parse(l) as Record<string, unknown>;

describe('redact', () => {
  it.each([
    ['call 0788123456 now', 'call [phone …456] now'],
    ['sent to +250788123456', 'sent to [phone …456]'],
    ['contact aline.uwase@example.rw', 'contact a***@example.rw'],
    ['Authorization: Bearer abc.def.ghi', 'Authorization: Bearer [redacted]'],
    [
      'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      'token [jwt]',
    ],
    [
      'refresh 0b3f6c1e-2a4d-4e8b-9c7a-1f2e3d4c5b6a.Zx9_kq-AbCdEfGhIjKlMnOpQrSt',
      'refresh [refresh-token]',
    ],
  ])('%s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it('leaves ordinary text, amounts and ids alone', () => {
    const s = 'Project 42 updated: 1,250,000 RWF, request 7f3a';
    expect(redact(s)).toBe(s);
  });

  it('removes secret fields and redacts nested strings', () => {
    expect(
      redactValue({
        code: '123456',
        refreshToken: 'x',
        headers: { Authorization: 'Bearer t', host: 'api' },
        users: [{ phone: '0788123456' }],
      }),
    ).toEqual({
      code: '[redacted]',
      refreshToken: '[redacted]',
      headers: { Authorization: '[redacted]', host: 'api' },
      users: [{ phone: '[phone …456]' }],
    });
  });
});

function logger(level = 'debug', format = 'json') {
  const config = {
    get: (k: string) => ({ LOG_LEVEL: level, LOG_FORMAT: format })[k],
  } as unknown as ConfigService;
  const lines: string[] = [];
  const log = new JengaLogger(config);
  log.write = (l) => lines.push(l);
  return { log, lines };
}

describe('JengaLogger', () => {
  it('writes one redacted JSON object per line with the request id', () => {
    const { log, lines } = logger();
    runWithRequestContext({ requestId: 'req-123' }, () =>
      log.event(
        'info',
        'code sent to 0788123456',
        { status: 200, otp: '999999' },
        'Auth',
      ),
    );
    const line = parse(lines[0]);
    expect(line).toMatchObject({
      level: 'info',
      msg: 'code sent to [phone …456]',
      context: 'Auth',
      requestId: 'req-123',
      status: 200,
      otp: '[redacted]',
    });
    expect(lines[0]).not.toContain('0788123456');
  });

  it('drops lines below the configured level', () => {
    const { log, lines } = logger('warn');
    log.log('hello');
    log.debug('noise');
    log.warn('careful');
    expect(lines.map((l) => parse(l).msg)).toEqual(['careful']);
  });

  it('understands Nest error(message, stack, context)', () => {
    const { log, lines } = logger();
    log.error('boom', 'Error: boom\n    at x', 'ExceptionsHandler');
    log.error('plain', 'Bootstrap');
    expect(parse(lines[0])).toMatchObject({
      context: 'ExceptionsHandler',
      stack: 'Error: boom\n    at x',
    });
    expect(parse(lines[1])).toMatchObject({ context: 'Bootstrap' });
  });

  it('prints readable lines in pretty mode', () => {
    const { log, lines } = logger('info', 'pretty');
    log.log('started', 'Bootstrap');
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d INFO {2}\[Bootstrap\] started$/);
  });
});

describe('scrubEvent', () => {
  it('removes request data, contacts and query strings before sending', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'failed for 0788123456',
      user: { id: 'u1', email: 'a@b.rw', ip_address: '1.2.3.4' },
      request: {
        url: 'https://api/x?phone=0788123456',
        data: { code: '123456' },
        headers: { authorization: 'Bearer t' },
        cookies: { s: '1' },
      },
      exception: { values: [{ value: 'no user aline@example.rw' }] },
      breadcrumbs: [{ message: 'otp 0788123456', data: { token: 't' } }],
    });
    expect(event.request).toEqual({ url: 'https://api/x' });
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.message).toBe('failed for [phone …456]');
    expect(event.exception?.values?.[0].value).toBe('no user a***@example.rw');
    expect(event.breadcrumbs?.[0]).toEqual({
      message: 'otp [phone …456]',
      data: { token: '[redacted]' },
    });
  });
});

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    S3_ENDPOINT: 'http://localhost:8333',
    S3_BUCKET: 'bucket',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    JWT_SECRET: 'j'.repeat(32),
    OTP_PEPPER: 'p'.repeat(32),
  };

  it('refuses the console code sender in production', () => {
    expect(() => validateEnv({ ...base, APP_ENV: 'production' })).toThrow(
      /development only/,
    );
  });

  it('defaults to json logs when hosted and pretty locally', () => {
    expect(validateEnv({ ...base, APP_ENV: 'staging' }).LOG_FORMAT).toBe(
      'json',
    );
    expect(validateEnv({ ...base, APP_ENV: 'development' }).LOG_FORMAT).toBe(
      'pretty',
    );
  });
});
