import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { HealthResponse } from '@jengalink/contracts';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/app.setup';
import { JengaLogger } from '../src/observability/logger';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as HealthResponse;
        expect(body.status).toBe('ok');
      });
  });

  it('gives unknown routes a request id and logs them', async () => {
    const logger = app.get(JengaLogger);
    // Tests log at warn level, so capture the request line before filtering.
    const lines: string[] = [];
    jest
      .spyOn(logger, 'event')
      .mockImplementation((...args) => lines.push(JSON.stringify(args)));
    const res = await request(app.getHttpServer())
      .get('/nope?phone=0788123456')
      .expect(404);
    const requestId = res.header['x-request-id'];
    expect((res.body as { requestId: string }).requestId).toBe(requestId);
    await new Promise((r) => setImmediate(r));
    const logged = lines.join('\n');
    expect(logged).toContain('"path":"/nope"');
    expect(logged).not.toContain('0788123456');
  });

  afterEach(async () => {
    await app.close();
  });
});
