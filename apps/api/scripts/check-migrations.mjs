// Fails when src/db/schema has changes that no migration in ./drizzle covers.
// Generates into a scratch copy of ./drizzle and checks that nothing new appears.
// (drizzle-kit resolves --out relative to cwd, so the scratch dir lives here.)
import { execSync } from 'node:child_process';
import { cpSync, readdirSync, rmSync } from 'node:fs';

const scratch = '.drift-check';
const sqlCount = () => readdirSync(scratch).filter((f) => f.endsWith('.sql')).length;

rmSync(scratch, { recursive: true, force: true });
try {
  cpSync('drizzle', scratch, { recursive: true });
  const before = sqlCount();
  const out = execSync(
    `pnpm exec drizzle-kit generate --dialect=postgresql --schema=./src/db/schema/index.ts --casing=snake_case --out=${scratch} --name=drift`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (sqlCount() > before) {
    console.error('Schema changed without a migration. Run: pnpm --filter @jengalink/api db:generate --name <change>');
    process.exit(1);
  }
  if (!out.includes('No schema changes')) {
    console.error(`Unexpected drizzle-kit output:\n${out}`);
    process.exit(1);
  }
  console.log('Migrations match the schema.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
