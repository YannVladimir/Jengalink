import './support/demo-on';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartOtpResponse } from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Database } from '../src/db/client';
import { DB } from '../src/db/database.module';
import { ConsoleMessageSender } from '../src/messaging/message-sender';

// A demo environment (spec §34): the apps learn it before sign-in, and the demo people sign in
// with the fixed code, without SMS and without the per-number limits. Everyone else is unchanged.
describe('demo environment (e2e)', () => {
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
    delete process.env.DEMO_MODE;
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const start = (destination: string) =>
    http().post('/v1/auth/otp/start').send({ channel: 'sms', destination });

  it('tells the apps, without a session, that this is a demo', async () => {
    const res = await http().get('/v1/environment').expect(200);
    expect(res.body).toEqual({ demo: true });
  });

  it('signs the demo people in with 000000, again and again, and sends nothing', async () => {
    for (let i = 0; i < 7; i++) {
      const s = (await start('0788000101').expect(202))
        .body as StartOtpResponse;
      const v = await http()
        .post('/v1/auth/otp/verify')
        .send({ challengeId: s.challengeId, code: '000000' })
        .expect(200);
      expect((v.body as { accessToken: string }).accessToken).toEqual(
        expect.any(String),
      );
    }
    expect(sender.lastCodeFor('+250788000101')).toBeUndefined();
  });

  it('keeps real numbers on random codes and the resend delay', async () => {
    const s = (await start('0788123987').expect(202)).body as StartOtpResponse;
    const code = sender.lastCodeFor('+250788123987');
    expect(code).toMatch(/^\d{6}$/);
    if (code !== '000000')
      await http()
        .post('/v1/auth/otp/verify')
        .send({ challengeId: s.challengeId, code: '000000' })
        .expect(401);
    await start('0788123987').expect(429);
  });
});
