import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AuthTokens,
  MeResponse,
  SessionInfo,
  StartOtpResponse,
  VerifyOtpResponse,
} from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ConsoleMessageSender } from '../src/messaging/message-sender';
import type { Database } from '../src/db/client';
import { DB } from '../src/db/database.module';
import { configureApp } from '../src/app.setup';

const PHONE = '0788123456';
const PHONE_E164 = '+250788123456';

describe('sign-in with phone or email OTP (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleRef.get(DB);
    sender = moduleRef.get(ConsoleMessageSender);
  });

  beforeEach(async () => {
    await db.execute(sql`truncate otp_challenges, sessions, users cascade`);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const start = (channel: 'sms' | 'email', destination: string) =>
    http().post('/v1/auth/otp/start').send({ channel, destination });
  const verify = (challengeId: string, code: string) =>
    http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId, code, deviceName: 'Test phone' });

  /** Lets a new code be requested immediately by ageing earlier challenges. */
  const skipResendDelay = () =>
    db.execute(
      sql`update otp_challenges set created_at = created_at - interval '2 minutes'`,
    );

  async function signIn(channel: 'sms' | 'email' = 'sms', destination = PHONE) {
    const started = await start(channel, destination).expect(202);
    const { challengeId } = started.body as StartOtpResponse;
    const normalized =
      channel === 'sms' ? PHONE_E164 : destination.toLowerCase();
    const code = sender.lastCodeFor(normalized)!;
    const res = await verify(challengeId, code).expect(200);
    return res.body as VerifyOtpResponse;
  }

  it('keeps health public and denies everything else without a session', async () => {
    await http().get('/health').expect(200);
    await http().get('/v1/me').expect(401);
    await http()
      .get('/v1/me')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
  });

  it('signs in by phone, creates the user once, and reuses it next time', async () => {
    const first = await signIn();
    expect(first.isNewUser).toBe(true);
    expect(first.user.verifiedPhone).toBe(PHONE_E164);
    expect(first.expiresIn).toBe(900);

    const me = await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);
    expect((me.body as MeResponse).id).toBe(first.user.id);

    await skipResendDelay();
    const second = await signIn('sms', '+250 78 812 3456');
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it('answers start the same way for new and existing accounts, with a masked destination', async () => {
    const res = await start('sms', PHONE).expect(202);
    const body = res.body as StartOtpResponse;
    expect(Object.keys(body).sort()).toEqual([
      'challengeId',
      'expiresAt',
      'resendAfter',
      'sentTo',
    ]);
    expect(body.sentTo).toBe('+250 78* *** 456');
  });

  it('explains which numbers work', async () => {
    const res = await start('sms', '+32470123456').expect(400);
    expect((res.body as { message: string }).message).toContain(
      'MTN or Airtel',
    );
  });

  it('never stores the code itself', async () => {
    await start('sms', PHONE).expect(202);
    const code = sender.lastCodeFor(PHONE_E164)!;
    const rows = await db.execute<{ code_hash: string }>(
      sql`select code_hash from otp_challenges`,
    );
    expect(rows.rows[0].code_hash).not.toContain(code);
    expect(rows.rows[0].code_hash).toHaveLength(64);
  });

  it('counts wrong codes and locks the challenge after 5', async () => {
    const { challengeId } = (await start('sms', PHONE).expect(202))
      .body as StartOtpResponse;
    const code = sender.lastCodeFor(PHONE_E164)!;
    const wrong = code === '000000' ? '111111' : '000000';

    const first = await verify(challengeId, wrong).expect(401);
    expect((first.body as { attemptsLeft: number }).attemptsLeft).toBe(4);
    for (let i = 0; i < 3; i++) await verify(challengeId, wrong).expect(401);
    await verify(challengeId, wrong).expect(429);
    // Even the right code is refused once locked.
    await verify(challengeId, code).expect(429);
  });

  it('refuses expired and already-used codes', async () => {
    const { challengeId } = (await start('sms', PHONE).expect(202))
      .body as StartOtpResponse;
    const code = sender.lastCodeFor(PHONE_E164)!;
    await verify(challengeId, code).expect(200);
    await verify(challengeId, code).expect(400);

    await skipResendDelay();
    const second = (await start('sms', PHONE).expect(202))
      .body as StartOtpResponse;
    await db.execute(
      sql`update otp_challenges set expires_at = now() - interval '1 second'`,
    );
    await verify(second.challengeId, sender.lastCodeFor(PHONE_E164)!).expect(
      400,
    );
  });

  it('enforces the resend delay and the hourly cap per number', async () => {
    await start('sms', PHONE).expect(202);
    const again = await start('sms', PHONE).expect(429);
    expect(
      (again.body as { retryAfterSeconds: number }).retryAfterSeconds,
    ).toBeGreaterThan(50);

    for (let i = 0; i < 4; i++) {
      await skipResendDelay();
      await start('sms', PHONE).expect(202);
    }
    await skipResendDelay();
    await start('sms', PHONE).expect(429);
  });

  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    const tokens = await signIn();
    const rotated = (
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200)
    ).body as AuthTokens;
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(200);

    // The reply was lost (slow network, app closed): the phone still holds the old token. Within
    // the grace it simply rotates again; the session goes on.
    const retried = (
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200)
    ).body as AuthTokens;
    await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${retried.accessToken}`)
      .expect(200);

    // A token from two rotations ago is theft: the whole session ends.
    const next = (
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: retried.refreshToken })
        .expect(200)
    ).body as AuthTokens;
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: next.refreshToken })
      .expect(401);
    await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${next.accessToken}`)
      .expect(401);
  });

  it('after the grace, replaying the previous token is theft too', async () => {
    const tokens = await signIn();
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    await db.execute(
      sql`update sessions set rotated_at = now() - interval '3 minutes'`,
    );
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  });

  it('ends the session immediately on logout', async () => {
    const tokens = await signIn();
    const auth = { Authorization: `Bearer ${tokens.accessToken}` };
    await http().post('/v1/auth/logout').set(auth).expect(204);
    await http().get('/v1/me').set(auth).expect(401);
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  });

  it('signs in by email for owners abroad, separately from phone accounts, and saves a name', async () => {
    const byPhone = await signIn();
    await skipResendDelay();
    const byEmail = await signIn('email', 'Aline.Uwase@Example.com');
    expect(byEmail.isNewUser).toBe(true);
    expect(byEmail.user.verifiedEmail).toBe('aline.uwase@example.com');
    expect(byEmail.user.id).not.toBe(byPhone.user.id);

    const updated = await http()
      .patch('/v1/me')
      .set('Authorization', `Bearer ${byEmail.accessToken}`)
      .set('If-Match', `"${byEmail.user.revision}"`)
      .send({ displayName: 'Aline Uwase', locale: 'rw' })
      .expect(200);
    expect(updated.body).toMatchObject({
      displayName: 'Aline Uwase',
      locale: 'rw',
    });
  });

  it('lists devices and signs out another one', async () => {
    const phoneA = await signIn();
    await skipResendDelay();
    const phoneB = await signIn();
    const authA = { Authorization: `Bearer ${phoneA.accessToken}` };

    const list = (await http().get('/v1/me/sessions').set(authA).expect(200))
      .body as SessionInfo[];
    expect(list).toHaveLength(2);
    const other = list.find((s) => !s.current)!;

    await http()
      .post('/v1/sessions/revoke')
      .set(authA)
      .send({ sessionId: other.id })
      .expect(204);
    await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${phoneB.accessToken}`)
      .expect(401);
    await http().get('/v1/me').set(authA).expect(200);
  });
});
