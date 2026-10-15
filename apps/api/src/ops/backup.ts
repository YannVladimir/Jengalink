// Backups of the database and stored files together, and restoring them (spec §21: recovery point
// 24 hours, recovery time 8 hours; "restore database and media together to a consistent point").
//
// Layout of a backup directory (a mounted volume, synced off-site by the host):
//   runs/<id>/database.dump   pg_dump custom format, taken inside one database snapshot
//   runs/<id>/manifest.json   what the run holds: row counts and a fingerprint per table, every file
//   objects/<ab>/<sha256>     stored files by content; shared between runs (files never change)
// With BACKUP_KEY set, the dump and every file are encrypted (AES-256-GCM); the manifest is not.
import { spawn, type ChildProcess } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import {
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline as pipelineCb, type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Client } from 'pg';

const MAGIC = Buffer.from('JLB1');
const HEADER = MAGIC.length + 12;
const TAG = 16;

export interface TableFingerprint {
  rows: number;
  /** md5 over the sorted md5 of every row: equal tables give equal fingerprints. */
  hash: string;
}

export interface StoredObject {
  key: string;
  sha256: string;
  bytes: number;
  contentType: string;
  etag: string;
}

export interface BackupManifest {
  format: 1;
  id: string;
  createdAt: string;
  appEnv: string;
  durationMs: number;
  /** keyId = the first 16 hex characters of sha256(key): finds a wrong key before anything is touched. */
  encryption: { cipher: 'aes-256-gcm'; keyId: string } | null;
  database: {
    name: string;
    file: string;
    bytes: number;
    sha256: string;
    migrations: number;
    tables: Record<string, TableFingerprint>;
  };
  files: {
    bucket: string;
    count: number;
    bytes: number;
    objects: StoredObject[];
    /** Files the database points to that were not in storage at backup time. */
    missing: string[];
  };
}

export interface Storage {
  s3: S3Client;
  bucket: string;
}

export interface PgTools {
  /** Run pg_dump / pg_restore inside this Docker container (local development has no client tools). */
  dockerContainer?: string;
}

type Log = (message: string) => void;

// ---------------------------------------------------------------------------------------------
// Encryption

export function parseBackupKey(hex: string | undefined): Buffer | null {
  if (!hex) return null;
  if (!/^[0-9a-f]{64}$/i.test(hex))
    throw new Error(
      'BACKUP_KEY must be 64 hex characters (32 bytes): openssl rand -hex 32',
    );
  return Buffer.from(hex, 'hex');
}

export const keyId = (key: Buffer) =>
  createHash('sha256').update(key).digest('hex').slice(0, 16);

export function encryptBuffer(data: Buffer, key: Buffer | null): Buffer {
  if (!key) return data;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([
    MAGIC,
    iv,
    cipher.update(data),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}

export function decryptBuffer(data: Buffer, key: Buffer | null): Buffer {
  if (!key) return data;
  if (!data.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('Not an encrypted backup file');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    data.subarray(MAGIC.length, HEADER),
  );
  decipher.setAuthTag(data.subarray(data.length - TAG));
  return Buffer.concat([
    decipher.update(data.subarray(HEADER, data.length - TAG)),
    decipher.final(),
  ]);
}

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

/** Streams into `file` (encrypted with a key); returns the size and sha256 of the plain bytes. */
async function writeStream(source: Readable, file: string, key: Buffer | null) {
  const hash = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  const out = createWriteStream(file);
  if (!key) {
    await pipeline(source, tap, out);
  } else {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    out.write(Buffer.concat([MAGIC, iv]));
    await pipeline(source, tap, cipher, out);
    await appendFile(file, cipher.getAuthTag());
  }
  return { bytes, sha256: hash.digest('hex') };
}

/** The plain bytes of `file`; a wrong key or a damaged file fails the stream at the end. */
async function readStream(file: string, key: Buffer | null): Promise<Readable> {
  if (!key) return createReadStream(file);
  const { size } = await stat(file);
  const fh = await open(file);
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    await fh.read(head, 0, HEADER, 0);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally {
    await fh.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error(`${file} is not an encrypted backup file`);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    head.subarray(MAGIC.length),
  );
  decipher.setAuthTag(tag);
  return pipelineCb(
    createReadStream(file, { start: HEADER, end: size - TAG - 1 }),
    decipher,
    () => undefined,
  );
}

// ---------------------------------------------------------------------------------------------
// Postgres

/** pg_dump / pg_restore with the password in the environment, never on the command line. */
function pgSpawn(
  tool: 'pg_dump' | 'pg_restore',
  databaseUrl: string,
  args: string[],
  tools: PgTools,
): ChildProcess {
  const url = new URL(databaseUrl);
  const password = decodeURIComponent(url.password);
  url.password = '';
  const env = { ...process.env, PGPASSWORD: password };
  if (tools.dockerContainer) {
    // Inside the container the server listens on its own port.
    url.hostname = '127.0.0.1';
    url.port = '5432';
    return spawn(
      'docker',
      [
        'exec',
        '-i',
        '-e',
        'PGPASSWORD',
        tools.dockerContainer,
        tool,
        `--dbname=${url.toString()}`,
        ...args,
      ],
      { env },
    );
  }
  return spawn(tool, [`--dbname=${url.toString()}`, ...args], { env });
}

function finished(child: ChildProcess, what: string): Promise<void> {
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  return new Promise((resolve, reject) => {
    child.on('error', (err) => reject(new Error(`${what}: ${err.message}`)));
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${what} failed (${code}): ${stderr.trim()}`)),
    );
  });
}

/** Same text for the same values in every session: fingerprints must not depend on settings. */
async function stableSession(db: Client) {
  await db.query(
    "set timezone = 'UTC'; set datestyle = 'ISO, YMD'; set intervalstyle = 'postgres'; set extra_float_digits = 1; set bytea_output = 'hex'",
  );
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Row count and content fingerprint of every table, in the session's current snapshot. */
export async function tableFingerprints(
  db: Client,
): Promise<Record<string, TableFingerprint>> {
  const { rows: tables } = await db.query<{ schema: string; name: string }>(
    `select n.nspname as schema, c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and c.relpersistence = 'p'
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
      order by 1, 2`,
  );
  const out: Record<string, TableFingerprint> = {};
  for (const t of tables) {
    const { rows } = await db.query<{ rows: string; hash: string | null }>(
      `select count(*) as rows, md5(string_agg(h, '' order by h)) as hash
         from (select md5(t::text) as h from ${quote(t.schema)}.${quote(t.name)} t) x`,
    );
    out[`${t.schema}.${t.name}`] = {
      rows: Number(rows[0].rows),
      hash: rows[0].hash ?? '',
    };
  }
  return out;
}

/**
 * Stored files the database points to. Blocked (infected) files are deleted on purpose.
 * Keep in step with the schema: media.storage_key / thumb_key, project_exports.storage_key.
 */
const REFERENCED_FILES = `
  select storage_key as key from media where scan_status <> 'infected'
  union select thumb_key from media where thumb_key is not null
  union select storage_key from project_exports where storage_key is not null`;

async function referencedFiles(db: Client): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(REFERENCED_FILES);
  return new Set(rows.map((r) => r.key));
}

async function isEmptyDatabase(db: Client) {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from pg_tables where schemaname not in ('pg_catalog', 'information_schema')`,
  );
  return Number(rows[0].n) === 0;
}

// ---------------------------------------------------------------------------------------------
// Object storage

async function* listObjects(storage: Storage) {
  let token: string | undefined;
  do {
    const page = await storage.s3.send(
      new ListObjectsV2Command({
        Bucket: storage.bucket,
        ContinuationToken: token,
      }),
    );
    for (const o of page.Contents ?? [])
      if (o.Key) yield { key: o.Key, etag: o.ETag ?? '', bytes: o.Size ?? 0 };
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

async function getObject(storage: Storage, key: string) {
  const res = await storage.s3.send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
  );
  return {
    body: Buffer.from(await res.Body!.transformToByteArray()),
    contentType: res.ContentType ?? 'application/octet-stream',
  };
}

/** Runs `fn` over `items`, `limit` at a time (files are many and small). */
async function eachLimit<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit = 8,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

const objectPath = (dir: string, hash: string) =>
  join(dir, 'objects', hash.slice(0, 2), hash);

// ---------------------------------------------------------------------------------------------
// Backup

export interface BackupOptions {
  dir: string;
  databaseUrl: string;
  storage: Storage;
  key: Buffer | null;
  appEnv: string;
  tools: PgTools;
  log?: Log;
}

/** A new run id: sorts by time and is safe as a folder name. */
export const runId = (at: Date) => at.toISOString().replace(/[:.]/g, '-');

export async function listRuns(dir: string): Promise<string[]> {
  if (!existsSync(join(dir, 'runs'))) return [];
  const names = await readdir(join(dir, 'runs'));
  return names
    .filter(
      (n) =>
        !n.endsWith('.partial') &&
        existsSync(join(dir, 'runs', n, 'manifest.json')),
    )
    .sort();
}

export async function readManifest(
  dir: string,
  id: string,
): Promise<BackupManifest> {
  return JSON.parse(
    await readFile(join(dir, 'runs', id, 'manifest.json'), 'utf8'),
  ) as BackupManifest;
}

/**
 * One backup run. The table fingerprints, the list of referenced files and pg_dump all read the same
 * database snapshot; files are copied afterwards (they never change once stored, so a file in the
 * snapshot is still there unless it was deleted on purpose in between, which `missing` reports).
 */
export async function runBackup(o: BackupOptions): Promise<BackupManifest> {
  const log = o.log ?? (() => undefined);
  const started = Date.now();
  const id = runId(new Date(started));
  const partial = join(o.dir, 'runs', `${id}.partial`);
  await mkdir(partial, { recursive: true });

  const db = new Client({ connectionString: o.databaseUrl });
  await db.connect();
  let database: BackupManifest['database'];
  let referenced: Set<string>;
  try {
    await db.query('begin isolation level repeatable read read only');
    await stableSession(db);
    const { rows } = await db.query<{ snapshot: string }>(
      'select pg_export_snapshot() as snapshot',
    );
    const dump = pgSpawn(
      'pg_dump',
      o.databaseUrl,
      ['--format=custom', `--snapshot=${rows[0].snapshot}`],
      o.tools,
    );
    const done = finished(dump, 'pg_dump');
    log('Database: dumping…');
    const [written] = await Promise.all([
      writeStream(dump.stdout!, join(partial, 'database.dump'), o.key),
      done,
    ]);
    const tables = await tableFingerprints(db);
    referenced = await referencedFiles(db);
    const migrations = tables['drizzle.__drizzle_migrations']?.rows ?? 0;
    database = {
      name: new URL(o.databaseUrl).pathname.slice(1),
      file: 'database.dump',
      ...written,
      migrations,
      tables,
    };
    await db.query('commit');
    log(
      `Database: ${Object.keys(tables).length} tables, ${(written.bytes / 1e6).toFixed(1)} MB, ${migrations} migrations`,
    );
  } finally {
    await db.end();
  }

  // Files: only new ones are downloaded; the previous run says which are already stored.
  const runs = await listRuns(o.dir);
  const known = new Map<string, StoredObject>();
  if (runs.length)
    for (const obj of (await readManifest(o.dir, runs[runs.length - 1])).files
      .objects)
      known.set(obj.key, obj);
  const objects: StoredObject[] = [];
  let fetched = 0;
  const items: { key: string; etag: string; bytes: number }[] = [];
  for await (const item of listObjects(o.storage))
    if (!item.key.startsWith('tmp/')) items.push(item); // tmp/ = unconfirmed uploads
  await eachLimit(items, async (item) => {
    const prev = known.get(item.key);
    if (
      prev &&
      prev.etag === item.etag &&
      prev.bytes === item.bytes &&
      existsSync(objectPath(o.dir, prev.sha256))
    ) {
      objects.push(prev);
      return;
    }
    const { body, contentType } = await getObject(o.storage, item.key);
    const hash = sha256(body);
    const path = objectPath(o.dir, hash);
    if (!existsSync(path)) {
      await mkdir(join(o.dir, 'objects', hash.slice(0, 2)), {
        recursive: true,
      });
      // Two keys with the same content can arrive together: each writes its own temporary file.
      const tmp = `${path}.${randomBytes(4).toString('hex')}.partial`;
      await writeFile(tmp, encryptBuffer(body, o.key));
      await rename(tmp, path).catch(async (err) => {
        // Windows refuses to replace a file the other writer just created; its copy is the same.
        if (!existsSync(path)) throw err;
        await rm(tmp, { force: true });
      });
    }
    fetched += 1;
    objects.push({
      key: item.key,
      sha256: hash,
      bytes: body.length,
      contentType,
      etag: item.etag,
    });
  });
  objects.sort((a, b) => (a.key < b.key ? -1 : 1));
  const stored = new Set(objects.map((x) => x.key));
  const missing = [...referenced].filter((k) => !stored.has(k)).sort();
  const files = {
    bucket: o.storage.bucket,
    count: objects.length,
    bytes: objects.reduce((n, x) => n + x.bytes, 0),
    objects,
    missing,
  };
  log(
    `Files: ${objects.length} (${(files.bytes / 1e6).toFixed(1)} MB), ${fetched} new${missing.length ? `, ${missing.length} MISSING` : ''}`,
  );

  const manifest: BackupManifest = {
    format: 1,
    id,
    createdAt: new Date(started).toISOString(),
    appEnv: o.appEnv,
    durationMs: Date.now() - started,
    encryption: o.key ? { cipher: 'aes-256-gcm', keyId: keyId(o.key) } : null,
    database,
    files,
  };
  await writeFile(
    join(partial, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  // Only a finished run gets its real name: a crash never leaves a run that looks complete.
  await rename(partial, join(o.dir, 'runs', id));
  return manifest;
}

// ---------------------------------------------------------------------------------------------
// Retention

/**
 * Runs to keep: the newest `daily` runs, plus the newest run of each of the last `monthly` months.
 * Run ids start with an ISO date, so they sort by time and their first 7 characters are the month.
 */
export function runsToKeep(
  ids: string[],
  daily: number,
  monthly: number,
): Set<string> {
  const sorted = [...ids].sort().reverse();
  const keep = new Set(sorted.slice(0, daily));
  const months = new Set<string>();
  for (const id of sorted) {
    const month = id.slice(0, 7);
    if (months.has(month)) continue;
    if (months.size >= monthly) break;
    months.add(month);
    keep.add(id);
  }
  return keep;
}

/** Deletes runs outside the retention policy and files no kept run needs. */
export async function prune(
  dir: string,
  daily: number,
  monthly: number,
  log: Log = () => undefined,
) {
  const runs = await listRuns(dir);
  const keep = runsToKeep(runs, daily, monthly);
  const removed = runs.filter((r) => !keep.has(r));
  for (const r of removed) await rm(join(dir, 'runs', r), { recursive: true });
  // Unfinished runs left by a crash.
  for (const n of await readdir(join(dir, 'runs')))
    if (n.endsWith('.partial'))
      await rm(join(dir, 'runs', n), { recursive: true });
  const needed = new Set<string>();
  for (const r of keep)
    for (const obj of (await readManifest(dir, r)).files.objects)
      needed.add(obj.sha256);
  let dropped = 0;
  if (existsSync(join(dir, 'objects')))
    for (const sub of await readdir(join(dir, 'objects')))
      for (const name of await readdir(join(dir, 'objects', sub)))
        if (!needed.has(name)) {
          await rm(join(dir, 'objects', sub, name));
          dropped += 1;
        }
  log(
    `Retention: kept ${keep.size} run(s), removed ${removed.length} run(s) and ${dropped} file(s)`,
  );
  return { kept: [...keep].sort(), removed, droppedFiles: dropped };
}

// ---------------------------------------------------------------------------------------------
// Restore and verification

export interface RestoreOptions {
  dir: string;
  manifest: BackupManifest;
  key: Buffer | null;
  /** An empty database: restoring never overwrites live data. */
  databaseUrl: string;
  /** A missing or empty bucket. */
  storage: Storage;
  tools: PgTools;
  log?: Log;
}

export interface RestoreReport {
  run: string;
  restoreMs: number;
  verifyMs: number;
  tables: number;
  rows: number;
  files: number;
  problems: string[];
}

function checkKey(manifest: BackupManifest, key: Buffer | null) {
  if (manifest.encryption && !key)
    throw new Error(`Backup ${manifest.id} is encrypted: set BACKUP_KEY`);
  if (manifest.encryption && key && keyId(key) !== manifest.encryption.keyId)
    throw new Error(
      `BACKUP_KEY is not the key backup ${manifest.id} was made with`,
    );
  return manifest.encryption ? key : null;
}

export async function runRestore(o: RestoreOptions): Promise<RestoreReport> {
  const log = o.log ?? (() => undefined);
  const key = checkKey(o.manifest, o.key);
  const started = Date.now();

  const db = new Client({ connectionString: o.databaseUrl });
  await db.connect();
  try {
    if (!(await isEmptyDatabase(db)))
      throw new Error(
        'The target database is not empty: restore into a new database',
      );
  } finally {
    await db.end();
  }
  try {
    await o.storage.s3.send(
      new HeadBucketCommand({ Bucket: o.storage.bucket }),
    );
  } catch {
    await o.storage.s3.send(
      new CreateBucketCommand({ Bucket: o.storage.bucket }),
    );
  }
  if (!(await listObjects(o.storage).next()).done)
    throw new Error(`The target bucket ${o.storage.bucket} is not empty`);

  // Database: the dump is decrypted on the fly and checked against its recorded sha256.
  log('Database: restoring…');
  const restore = pgSpawn(
    'pg_restore',
    o.databaseUrl,
    [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--single-transaction',
    ],
    o.tools,
  );
  const done = finished(restore, 'pg_restore');
  const hash = createHash('sha256');
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  await Promise.all([
    pipeline(
      await readStream(
        join(o.dir, 'runs', o.manifest.id, o.manifest.database.file),
        key,
      ),
      tap,
      restore.stdin!,
    ),
    done,
  ]);
  if (hash.digest('hex') !== o.manifest.database.sha256)
    throw new Error('The database dump does not match its manifest');

  log(`Files: restoring ${o.manifest.files.count}…`);
  await eachLimit(o.manifest.files.objects, async (obj) => {
    const body = decryptBuffer(
      await readFile(objectPath(o.dir, obj.sha256)),
      key,
    );
    await o.storage.s3.send(
      new PutObjectCommand({
        Bucket: o.storage.bucket,
        Key: obj.key,
        Body: body,
        ContentType: obj.contentType,
      }),
    );
  });
  const restoreMs = Date.now() - started;

  log('Verifying…');
  const verifyStarted = Date.now();
  const problems = await verifyRestore(o.manifest, o.databaseUrl, o.storage);
  return {
    run: o.manifest.id,
    restoreMs,
    verifyMs: Date.now() - verifyStarted,
    tables: Object.keys(o.manifest.database.tables).length,
    rows: Object.values(o.manifest.database.tables).reduce(
      (n, t) => n + t.rows,
      0,
    ),
    files: o.manifest.files.count,
    problems,
  };
}

/**
 * Compares a restored copy with the manifest: every table's rows (count and content fingerprint),
 * every file byte for byte (sha256), and every file the restored database points to.
 */
export async function verifyRestore(
  manifest: BackupManifest,
  databaseUrl: string,
  storage: Storage,
): Promise<string[]> {
  const problems: string[] = [];
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  let referenced: Set<string>;
  try {
    await db.query('begin isolation level repeatable read read only');
    await stableSession(db);
    const tables = await tableFingerprints(db);
    referenced = await referencedFiles(db);
    await db.query('commit');
    for (const [name, want] of Object.entries(manifest.database.tables)) {
      const got = tables[name];
      if (!got) problems.push(`table ${name} is missing`);
      else if (got.rows !== want.rows)
        problems.push(`table ${name}: ${got.rows} rows, expected ${want.rows}`);
      else if (got.hash !== want.hash)
        problems.push(`table ${name}: same row count, different content`);
    }
    for (const name of Object.keys(tables))
      if (!manifest.database.tables[name])
        problems.push(`table ${name} is not in the backup`);
  } finally {
    await db.end();
  }
  const restored = new Map<string, string>();
  const keys: string[] = [];
  for await (const item of listObjects(storage)) keys.push(item.key);
  await eachLimit(keys, async (k) => {
    restored.set(k, sha256((await getObject(storage, k)).body));
  });
  for (const obj of manifest.files.objects) {
    const got = restored.get(obj.key);
    if (!got) problems.push(`file ${obj.key} is missing`);
    else if (got !== obj.sha256) problems.push(`file ${obj.key} differs`);
  }
  const known = new Set(manifest.files.missing);
  for (const k of referenced)
    if (!restored.has(k) && !known.has(k))
      problems.push(`the database points to ${k}, which was not restored`);
  return problems;
}
