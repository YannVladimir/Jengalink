// Backups from the command line. Hosted: run `backup` nightly from the host's scheduler (exit code
// non-zero = alert), and the `restore` drill at least quarterly in a separate environment.
//
//   pnpm backup                     database + files into BACKUP_DIR, then retention
//   pnpm backup:list                runs on disk
//   pnpm backup:restore -- --target-db <url> --target-bucket <name> [--run <id>]
//   pnpm backup:drill               back up, restore into a scratch database and bucket, verify
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { z } from 'zod';
import { envSchema, withFileSecrets } from '../config/env';
import {
  type BackupManifest,
  listRuns,
  parseBackupKey,
  prune,
  readManifest,
  runBackup,
  runRestore,
  type Storage,
} from './backup';

const backupEnv = envSchema
  .pick({
    APP_ENV: true,
    DATABASE_URL: true,
    S3_ENDPOINT: true,
    S3_REGION: true,
    S3_BUCKET: true,
    S3_ACCESS_KEY_ID: true,
    S3_SECRET_ACCESS_KEY: true,
    S3_FORCE_PATH_STYLE: true,
  })
  .extend({
    // A volume the host copies off-site; required where real data lives.
    BACKUP_DIR: z.string().optional().default(''),
    // 64 hex characters (openssl rand -hex 32). Required where real data lives; keep it outside the backups.
    BACKUP_KEY: z.string().optional().default(''),
    BACKUP_KEEP_DAILY: z.coerce.number().int().min(1).default(14),
    BACKUP_KEEP_MONTHLY: z.coerce.number().int().min(0).default(12),
    // Local development: run pg_dump/pg_restore inside the Postgres container.
    PG_DOCKER_CONTAINER: z.string().optional().default(''),
  });
type BackupEnv = z.infer<typeof backupEnv>;

/** RPO and RTO from the spec (§21), checked by the drill. */
const RECOVERY_POINT_HOURS = 24;
const RECOVERY_TIME_HOURS = 8;

function args(argv: string[]) {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i] ?? '';
    else rest.push(argv[i]);
  }
  return { flags, rest };
}

function loadEnv(file: string | undefined): BackupEnv {
  if (file && existsSync(file)) loadDotenv({ path: file, quiet: true });
  const env = backupEnv.parse(withFileSecrets(process.env));
  const hosted = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
  if (hosted && (!env.BACKUP_DIR || !env.BACKUP_KEY))
    throw new Error(
      'BACKUP_DIR and BACKUP_KEY (or BACKUP_KEY_FILE) are required in hosted environments',
    );
  return env;
}

const backupDir = (env: BackupEnv) =>
  env.BACKUP_DIR
    ? resolve(env.BACKUP_DIR)
    : resolve(__dirname, '../../../../.backups');

function storage(env: BackupEnv, bucket = env.S3_BUCKET): Storage {
  return {
    bucket,
    s3: new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  };
}

const log = (m: string) => console.log(`  ${m}`);
const tools = (env: BackupEnv) => ({
  dockerContainer: env.PG_DOCKER_CONTAINER || undefined,
});
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function backup(env: BackupEnv) {
  const dir = backupDir(env);
  console.log(`Backing up to ${dir}`);
  const manifest = await runBackup({
    dir,
    databaseUrl: env.DATABASE_URL,
    storage: storage(env),
    key: parseBackupKey(env.BACKUP_KEY),
    appEnv: env.APP_ENV,
    tools: tools(env),
    log,
  });
  await prune(dir, env.BACKUP_KEEP_DAILY, env.BACKUP_KEEP_MONTHLY, log);
  console.log(
    `Backup ${manifest.id} done in ${seconds(manifest.durationMs)}${manifest.encryption ? ' (encrypted)' : ' (NOT encrypted)'}`,
  );
  if (manifest.files.missing.length) {
    console.error(
      `${manifest.files.missing.length} file(s) the database points to are not in storage:\n${manifest.files.missing.map((k) => `    ${k}`).join('\n')}`,
    );
    process.exitCode = 2;
  }
  return manifest;
}

async function pickRun(
  env: BackupEnv,
  id: string | undefined,
): Promise<BackupManifest> {
  const runs = await listRuns(backupDir(env));
  const run = id ?? runs[runs.length - 1];
  if (!run || !runs.includes(run))
    throw new Error(id ? `No backup ${id}` : 'No backups yet');
  return readManifest(backupDir(env), run);
}

async function restore(
  env: BackupEnv,
  manifest: BackupManifest,
  targetDb: string,
  targetBucket: string,
) {
  if (targetDb === env.DATABASE_URL || targetBucket === env.S3_BUCKET)
    throw new Error(
      'Restore into a new database and bucket, never over the live ones',
    );
  console.log(
    `Restoring ${manifest.id} into ${new URL(targetDb).pathname.slice(1)} and ${targetBucket}`,
  );
  const report = await runRestore({
    dir: backupDir(env),
    manifest,
    key: parseBackupKey(env.BACKUP_KEY),
    databaseUrl: targetDb,
    storage: storage(env, targetBucket),
    tools: tools(env),
    log,
  });
  console.log(
    `  Restored ${report.tables} tables (${report.rows} rows) and ${report.files} files in ${seconds(report.restoreMs)}; verified in ${seconds(report.verifyMs)}`,
  );
  if (report.problems.length) {
    console.error(
      `Verification FAILED:\n${report.problems.map((p) => `    ${p}`).join('\n')}`,
    );
    process.exitCode = 1;
  } else
    console.log('  Verified: every table and every file matches the backup');
  return report;
}

/** A scratch database next to the source one (dropped and created again for each drill). */
async function scratchDatabase(env: BackupEnv): Promise<string> {
  const source = new URL(env.DATABASE_URL);
  const name = `${source.pathname.slice(1)}_restore_drill`;
  const admin = new URL(env.DATABASE_URL);
  admin.pathname = '/postgres';
  const db = new Client({ connectionString: admin.toString() });
  await db.connect();
  try {
    await db.query(`drop database if exists "${name}" with (force)`);
    await db.query(`create database "${name}"`);
  } finally {
    await db.end();
  }
  source.pathname = `/${name}`;
  return source.toString();
}

/** Empties the drill bucket from an earlier drill. Only ever a *-restore-drill bucket. */
async function emptyDrillBucket(target: Storage) {
  if (!target.bucket.endsWith('-restore-drill'))
    throw new Error('Not a drill bucket');
  for (;;) {
    let page;
    try {
      page = await target.s3.send(
        new ListObjectsV2Command({ Bucket: target.bucket }),
      );
    } catch {
      return; // no bucket yet
    }
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (!keys.length) return;
    await target.s3.send(
      new DeleteObjectsCommand({
        Bucket: target.bucket,
        Delete: { Objects: keys },
      }),
    );
  }
}

async function drill(env: BackupEnv) {
  if (env.APP_ENV === 'production')
    throw new Error(
      'Drill in a separate environment: copy the backup there and run backup:restore',
    );
  const started = Date.now();
  const manifest = await backup(env);
  const targetDb = await scratchDatabase(env);
  const targetBucket = `${env.S3_BUCKET}-restore-drill`;
  await emptyDrillBucket(storage(env, targetBucket));
  const report = await restore(env, manifest, targetDb, targetBucket);
  const result = {
    drilledAt: new Date().toISOString(),
    backup: manifest.id,
    target: {
      database: new URL(targetDb).pathname.slice(1),
      bucket: targetBucket,
    },
    backupMs: manifest.durationMs,
    restoreMs: report.restoreMs,
    verifyMs: report.verifyMs,
    totalMs: Date.now() - started,
    databaseBytes: manifest.database.bytes,
    tables: report.tables,
    rows: report.rows,
    files: report.files,
    fileBytes: manifest.files.bytes,
    missingAtBackup: manifest.files.missing,
    problems: report.problems,
    passed: report.problems.length === 0,
    withinRecoveryTime:
      report.restoreMs + report.verifyMs < RECOVERY_TIME_HOURS * 3_600_000,
  };
  await writeFile(
    join(backupDir(env), 'runs', manifest.id, 'drill.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(
    `Drill ${result.passed ? 'PASSED' : 'FAILED'}: restore + verify ${seconds(report.restoreMs + report.verifyMs)} (target ${RECOVERY_TIME_HOURS} h). The copy stays in ${result.target.database} / ${targetBucket} for checks in the app.`,
  );
}

async function list(env: BackupEnv) {
  const dir = backupDir(env);
  const runs = await listRuns(dir);
  if (!runs.length) return console.log(`No backups in ${dir}`);
  const now = Date.now();
  for (const id of runs) {
    const m = await readManifest(dir, id);
    console.log(
      `${id}  ${(m.database.bytes / 1e6).toFixed(1)} MB database, ${m.files.count} files${m.encryption ? ', encrypted' : ''}${m.files.missing.length ? `, ${m.files.missing.length} missing` : ''}`,
    );
  }
  const last = await readManifest(dir, runs[runs.length - 1]);
  const ageHours = (now - Date.parse(last.createdAt)) / 3_600_000;
  console.log(
    `Newest is ${ageHours.toFixed(1)} h old (recovery point target ${RECOVERY_POINT_HOURS} h)`,
  );
  if (ageHours > RECOVERY_POINT_HOURS) process.exitCode = 3;
}

async function main() {
  const { flags, rest } = args(process.argv.slice(2));
  const [command, envFile] = rest;
  const env = loadEnv(envFile);
  switch (command) {
    case 'backup':
      await backup(env);
      break;
    case 'list':
      await list(env);
      break;
    case 'restore':
      if (!flags['target-db'] || !flags['target-bucket'])
        throw new Error(
          'restore needs --target-db <url> and --target-bucket <name>',
        );
      await restore(
        env,
        await pickRun(env, flags.run),
        flags['target-db'],
        flags['target-bucket'],
      );
      break;
    case 'drill':
      await drill(env);
      break;
    default:
      throw new Error('Commands: backup, list, restore, drill');
  }
}

void main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
