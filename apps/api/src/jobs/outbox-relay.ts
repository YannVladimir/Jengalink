import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import type { EventEnvelope, EventType } from './events';

interface PendingRow {
  id: string;
  type: EventType;
  payload: EventEnvelope['payload'];
  occurred_at: Date;
}

/**
 * Moves up to `limit` pending outbox events into pg-boss, one job per consumer
 * queue, and marks them published, all in ONE transaction: an event is either
 * queued for every consumer and marked, or left pending for the next run.
 * SKIP LOCKED lets several relays run side by side without sending twice;
 * the job id = event id, so a replay cannot create a duplicate job either.
 */
export async function relayOutbox(
  pool: Pool,
  boss: PgBoss,
  queuesFor: (type: EventType) => string[],
  limit = 50,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<PendingRow>(
      `select id, type, payload, occurred_at from outbox_events
       where published_at is null
       order by id
       limit $1
       for update skip locked`,
      [limit],
    );
    const db = {
      executeSql: (text: string, values?: unknown[]) =>
        client.query(text, values),
    };
    for (const row of rows) {
      const envelope: EventEnvelope = {
        eventId: row.id,
        type: row.type,
        occurredAt: row.occurred_at.toISOString(),
        payload: row.payload,
      };
      for (const queue of queuesFor(row.type)) {
        await boss.send(queue, envelope, { id: row.id, db });
      }
    }
    if (rows.length > 0) {
      await client.query(
        `update outbox_events set published_at = now(), updated_at = now()
         where id = any($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
    }
    await client.query('commit');
    return rows.length;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
