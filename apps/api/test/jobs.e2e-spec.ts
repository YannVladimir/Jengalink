import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import PgBoss from 'pg-boss';
import { envFilePath, validateEnv } from '../src/config/env';
import type { Database } from '../src/db/client';
import { DB, DB_POOL, DatabaseModule } from '../src/db/database.module';
import { outboxEvents } from '../src/db/schema';
import type { EventEnvelope } from '../src/jobs/events';
import { JobsModule } from '../src/jobs/jobs.module';
import { JobsService } from '../src/jobs/jobs.service';
import { recordEvent } from '../src/jobs/outbox';
import { relayOutbox } from '../src/jobs/outbox-relay';

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for condition');
}

describe('jobs: outbox + pg-boss (e2e)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let pool: Pool;
  let jobs: JobsService;
  const received: Record<'notify' | 'report', string[]> = {
    notify: [],
    report: [],
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath,
          validate: validateEnv,
        }),
        DatabaseModule,
        JobsModule,
      ],
    }).compile();
    db = moduleRef.get(DB);
    pool = moduleRef.get(DB_POOL);
    jobs = moduleRef.get(JobsService);

    jobs.on('system.ping', 'notify', (payload) => {
      received.notify.push(payload.note);
      return Promise.resolve();
    });
    jobs.on('system.ping', 'report', (payload) => {
      received.report.push(payload.note);
      return Promise.resolve();
    });
    await jobs.start({ relayIntervalMs: 200, pollingIntervalSeconds: 0.5 });
  });

  beforeEach(async () => {
    await jobs.stop();
    await db.execute(sql`truncate outbox_events, processed_events`);
    await db.execute(sql`delete from pgboss.job`);
    received.notify = [];
    received.report = [];
    await jobs.start({ relayIntervalMs: 200, pollingIntervalSeconds: 0.5 });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const countJobs = async (queue: string) => {
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from pgboss.job where name = $1',
      [queue],
    );
    return rows[0].n;
  };

  it('drops the event when the business transaction rolls back', async () => {
    await expect(
      db.transaction(async (tx) => {
        await recordEvent(tx, 'system.ping', { note: 'rolled back' });
        throw new Error('domain rule failed');
      }),
    ).rejects.toThrow('domain rule failed');

    const rows = await db.select().from(outboxEvents);
    expect(rows).toHaveLength(0);
  });

  it('delivers a committed event to every consumer exactly once', async () => {
    const eventId = await db.transaction((tx) =>
      recordEvent(tx, 'system.ping', { note: 'hello' }),
    );

    await waitFor(
      () => received.notify.length === 1 && received.report.length === 1,
    );
    // Give a duplicate a chance to show up before asserting there is none.
    await new Promise((r) => setTimeout(r, 1500));
    expect(received).toEqual({ notify: ['hello'], report: ['hello'] });

    const [row] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(row.publishedAt).not.toBeNull();
  });

  it('never sends an event twice when relays run in parallel', async () => {
    await jobs.stop(); // drive the relay by hand; no workers, no timer
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: 'pgboss',
    });
    await boss.start();
    try {
      await db.transaction(async (tx) => {
        for (let i = 0; i < 20; i++)
          await recordEvent(tx, 'system.ping', { note: `n${i}` });
      });
      const queues = jobs.queuesFor('system.ping');
      const [a, b, c] = await Promise.all([
        relayOutbox(pool, boss, jobs.queuesFor, 7),
        relayOutbox(pool, boss, jobs.queuesFor, 7),
        relayOutbox(pool, boss, jobs.queuesFor, 7),
      ]);
      const rest = await relayOutbox(pool, boss, jobs.queuesFor, 50);
      expect(a + b + c + rest).toBe(20);
      for (const q of queues) expect(await countJobs(q)).toBe(20);
      // A second pass finds nothing left to send.
      expect(await relayOutbox(pool, boss, jobs.queuesFor, 50)).toBe(0);
    } finally {
      await boss.stop({ graceful: false });
    }
  });

  it('ignores a duplicate delivery of the same event', async () => {
    let calls = 0;
    const consumer = {
      name: 'dedupe-test',
      handler: () => {
        calls++;
        return Promise.resolve();
      },
    };
    const event: EventEnvelope = {
      eventId: '01900000-0000-7000-8000-000000000001',
      type: 'system.ping',
      occurredAt: new Date().toISOString(),
      payload: { note: 'dup' },
    };
    await jobs.consume(consumer, event);
    await jobs.consume(consumer, event);
    expect(calls).toBe(1);
  });

  it('lets a failed handler run again on retry', async () => {
    let calls = 0;
    const consumer = {
      name: 'retry-test',
      handler: () => {
        calls++;
        return calls === 1
          ? Promise.reject(new Error('provider timeout'))
          : Promise.resolve();
      },
    };
    const event: EventEnvelope = {
      eventId: '01900000-0000-7000-8000-000000000002',
      type: 'system.ping',
      occurredAt: new Date().toISOString(),
      payload: { note: 'retry' },
    };
    await expect(jobs.consume(consumer, event)).rejects.toThrow(
      'provider timeout',
    );
    await jobs.consume(consumer, event);
    expect(calls).toBe(2);
  });
});
