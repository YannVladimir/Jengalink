// Applies pending SQL migrations from ./drizzle.
// Usage: pnpm db:migrate (dev) or pnpm db:migrate:test
import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client';

async function main() {
  config({ path: process.argv[2] ?? '.env', quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = createPool(url);
  try {
    await migrate(createDb(pool), { migrationsFolder: './drizzle' });
    console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}`);
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
