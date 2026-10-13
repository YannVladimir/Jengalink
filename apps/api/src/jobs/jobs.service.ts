import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import PgBoss from 'pg-boss';
import type { Database, Tx } from '../db/client';
import { DB, DB_POOL } from '../db/database.module';
import { processedEvents } from '../db/schema';
import {
  type EventEnvelope,
  type EventPayloads,
  type EventType,
  queueName,
} from './events';
import { relayOutbox } from './outbox-relay';

export type EventHandler<T extends EventType> = (
  payload: EventPayloads[T],
  tx: Tx,
  event: EventEnvelope<T>,
) => Promise<void>;

interface Consumer {
  type: EventType;
  name: string;
  queue: string;
  handler: EventHandler<EventType>;
}

/**
 * Runs the job system inside the API process (modular monolith, spec §16.1):
 * pg-boss for queues and retries, the outbox relay, and idempotent consumers.
 * Feature modules call `on()` during their onModuleInit to subscribe.
 */
@Injectable()
export class JobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JobsService.name);
  private readonly consumers: Consumer[] = [];
  private boss?: PgBoss;
  private relayTimer?: NodeJS.Timeout;
  private relaying = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: Database,
    @Inject(DB_POOL) private readonly pool: Pool,
  ) {}

  /** Subscribes `consumer` to `type`. Each consumer gets every event once. */
  on<T extends EventType>(type: T, consumer: string, handler: EventHandler<T>) {
    if (this.boss)
      throw new Error('Register consumers before the job system starts');
    this.consumers.push({
      type,
      name: consumer,
      queue: queueName(type, consumer),
      handler: handler,
    });
  }

  queuesFor = (type: EventType) =>
    this.consumers.filter((c) => c.type === type).map((c) => c.queue);

  async onApplicationBootstrap() {
    if (this.config.get<boolean>('JOBS_ENABLED')) await this.start();
  }

  async onApplicationShutdown() {
    await this.stop();
  }

  async start(
    options: { relayIntervalMs?: number; pollingIntervalSeconds?: number } = {},
  ) {
    if (this.boss) return;
    const boss = new PgBoss({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      schema: 'pgboss',
      max: 4,
    });
    boss.on('error', (err) => this.logger.error(err));
    await boss.start();
    this.boss = boss;

    for (const c of this.consumers) {
      await boss.createQueue(c.queue, {
        retryLimit: 5,
        retryBackoff: true,
        retryDelay: 5,
      });
      await boss.work<EventEnvelope>(
        c.queue,
        { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
        async (jobs) => {
          for (const job of jobs) await this.consume(c, job.data);
        },
      );
    }

    this.relayTimer = setInterval(
      () => void this.relayNow(),
      options.relayIntervalMs ?? 1000,
    );
  }

  async stop() {
    clearInterval(this.relayTimer);
    this.relayTimer = undefined;
    await this.boss?.stop({ graceful: true, wait: true });
    this.boss = undefined;
  }

  /** Relays pending outbox events now. Safe to call concurrently. */
  async relayNow(limit = 50): Promise<number> {
    if (!this.boss || this.relaying) return 0;
    this.relaying = true;
    try {
      let total = 0;
      let n: number;
      do {
        n = await relayOutbox(this.pool, this.boss, this.queuesFor, limit);
        total += n;
      } while (n === limit);
      return total;
    } catch (err) {
      this.logger.error('Outbox relay failed', err as Error);
      return 0;
    } finally {
      this.relaying = false;
    }
  }

  /**
   * Runs a handler at most once per (consumer, event): the dedupe row and the
   * handler's writes commit together, so a retried or duplicate job is a no-op.
   * Throwing rolls both back and pg-boss retries the job.
   */
  async consume(
    consumer: Pick<Consumer, 'name' | 'handler'>,
    event: EventEnvelope,
  ) {
    await this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(processedEvents)
        .values({ consumer: consumer.name, eventId: event.eventId })
        .onConflictDoNothing()
        .returning({ id: processedEvents.id });
      if (claimed.length === 0) return;
      await consumer.handler(event.payload, tx, event);
    });
  }

  get bossInstance(): PgBoss | undefined {
    return this.boss;
  }
}
