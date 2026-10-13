// Writes apps/api/openapi.json and packages/contracts/src/generated/openapi.ts from the code.
// Usage: pnpm openapi (write) · pnpm openapi:check (fail if the files are out of date)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApi } from './build';

const API_DIR = resolve(__dirname, '../..');
const SPEC_PATH = join(API_DIR, 'openapi.json');
const CONTRACTS_DIR = resolve(API_DIR, '../../packages/contracts');
const TYPES_PATH = join(CONTRACTS_DIR, 'src/generated/openapi.ts');
const HEADER =
  '// Generated from apps/api/openapi.json by `pnpm openapi`. Do not edit by hand.\n';

function toTypes(specPath: string): string {
  const out = join(mkdtempSync(join(tmpdir(), 'jl-openapi-')), 'openapi.ts');
  execFileSync('pnpm', ['exec', 'openapi-typescript', specPath, '-o', out], {
    cwd: CONTRACTS_DIR,
    stdio: 'pipe',
    shell: true,
  });
  const types = HEADER + readFileSync(out, 'utf8');
  rmSync(out, { force: true });
  return types;
}

async function main() {
  const check = process.argv.includes('--check');
  const app = await NestFactory.create(AppModule, { logger: false });
  const version = (
    JSON.parse(readFileSync(join(API_DIR, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  const spec = `${JSON.stringify(buildOpenApi(app, version), null, 2)}\n`;
  await app.close();

  if (check) {
    const tmp = join(
      mkdtempSync(join(tmpdir(), 'jl-openapi-')),
      'openapi.json',
    );
    writeFileSync(tmp, spec);
    const stale: string[] = [];
    if (readFileSync(SPEC_PATH, 'utf8') !== spec)
      stale.push('apps/api/openapi.json');
    if (readFileSync(TYPES_PATH, 'utf8') !== toTypes(tmp))
      stale.push('packages/contracts/src/generated/openapi.ts');
    if (stale.length) {
      console.error(
        `Out of date: ${stale.join(', ')}. Run: pnpm --filter @jengalink/api openapi`,
      );
      process.exit(1);
    }
    console.log('OpenAPI document and client types match the code.');
    return;
  }

  writeFileSync(SPEC_PATH, spec);
  writeFileSync(TYPES_PATH, toTypes(SPEC_PATH));
  console.log(`Wrote ${SPEC_PATH} and ${TYPES_PATH}`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
