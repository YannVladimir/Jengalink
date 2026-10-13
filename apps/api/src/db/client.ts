import { Logger } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export const createPool = (url: string) => {
  const pool = new Pool({ connectionString: url, max: 10 });
  // An idle connection dropped (database restart, network blip, the machine woke from sleep):
  // without a listener Node would crash the API. The pool discards it and opens a new one.
  pool.on('error', (err) =>
    new Logger('Database').warn(`Idle connection lost: ${err.message}`),
  );
  // A connection in use (inside a transaction) also emits 'error' when it drops; its query fails
  // and is handled where it was made, so here it only needs a listener (or Node exits).
  pool.on('connect', (client) =>
    client.on('error', (err) =>
      new Logger('Database').warn(`Connection lost: ${err.message}`),
    ),
  );
  return pool;
};

export const createDb = (pool: Pool): Database =>
  drizzle(pool, { schema, casing: 'snake_case' });

/** A transaction handle, for code that must run inside the caller's transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
