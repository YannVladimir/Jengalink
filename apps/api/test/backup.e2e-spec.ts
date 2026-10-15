import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from 'dotenv';
import { Client } from 'pg';
import {
  type BackupManifest,
  prune,
  runBackup,
  runRestore,
  type Storage,
  verifyRestore,
} from '../src/ops/backup';

// Backs up the test database and bucket, restores both into new ones and compares everything.
// pg_dump/pg_restore run inside the Postgres container (PG_DOCKER_CONTAINER) or from the PATH.
config({ path: '.env.test', quiet: true });
const env = process.env as Record<string, string>;
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
const tools = { dockerContainer: env.PG_DOCKER_CONTAINER || undefined };

// Every file in the test bucket is copied twice over: give it time on a busy machine.
jest.setTimeout(300_000);

describe('backups and restore (e2e)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jl-backup-'));
  const key = randomBytes(32);
  const source: Storage = { s3, bucket: env.S3_BUCKET };
  const suffix = randomUUID().slice(0, 8);
  const target: Storage = { s3, bucket: `jl-restore-${suffix}` };
  const targetName = `jengalink_restore_${suffix}`;
  const targetUrl = (() => {
    const u = new URL(env.DATABASE_URL);
    u.pathname = `/${targetName}`;
    return u.toString();
  })();
  const admin = (() => {
    const u = new URL(env.DATABASE_URL);
    u.pathname = '/postgres';
    return u.toString();
  })();
  const fileKey = `orgs/backup-check/${suffix}/photo.jpg`;
  const photo = randomBytes(2048);
  let manifest: BackupManifest;

  const sql = async (url: string, text: string) => {
    const db = new Client({ connectionString: url });
    await db.connect();
    try {
      return await db.query(text);
    } finally {
      await db.end();
    }
  };

  beforeAll(async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: source.bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: source.bucket }));
    }
    await s3.send(
      new PutObjectCommand({
        Bucket: source.bucket,
        Key: fileKey,
        Body: photo,
        ContentType: 'image/jpeg',
      }),
    );
    await sql(admin, `create database "${targetName}"`);
  });

  afterAll(async () => {
    await sql(admin, `drop database if exists "${targetName}" with (force)`);
    await s3.send(
      new DeleteObjectCommand({ Bucket: source.bucket, Key: fileKey }),
    );
    try {
      for (;;) {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket: target.bucket }),
        );
        const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (!keys.length) break;
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: target.bucket,
            Delete: { Objects: keys },
          }),
        );
      }
      await s3.send(new DeleteBucketCommand({ Bucket: target.bucket }));
    } catch {
      // never created
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('backs up the database (one snapshot) and every stored file, encrypted', async () => {
    manifest = await runBackup({
      dir,
      databaseUrl: env.DATABASE_URL,
      storage: source,
      key,
      appEnv: 'test',
      tools,
    });
    expect(manifest.encryption?.cipher).toBe('aes-256-gcm');
    expect(manifest.database.migrations).toBeGreaterThan(25);
    expect(manifest.database.tables['public.projects']).toBeDefined();
    const obj = manifest.files.objects.find((o) => o.key === fileKey);
    expect(obj).toMatchObject({
      bytes: photo.length,
      contentType: 'image/jpeg',
    });
    expect(manifest.files.objects.some((o) => o.key.startsWith('tmp/'))).toBe(
      false,
    );

    // A second run reuses the stored files instead of downloading them again.
    const second = await runBackup({
      dir,
      databaseUrl: env.DATABASE_URL,
      storage: source,
      key,
      appEnv: 'test',
      tools,
    });
    expect(second.files.objects.find((o) => o.key === fileKey)?.sha256).toBe(
      obj!.sha256,
    );
    const kept = await prune(dir, 1, 0);
    expect(kept.kept).toEqual([second.id]);
    manifest = second;
  });

  it('refuses the wrong key before touching anything', async () => {
    await expect(
      runRestore({
        dir,
        manifest,
        key: randomBytes(32),
        databaseUrl: targetUrl,
        storage: target,
        tools,
      }),
    ).rejects.toThrow(/not the key/);
  });

  it('restores the database and files together, and they match the backup exactly', async () => {
    const report = await runRestore({
      dir,
      manifest,
      key,
      databaseUrl: targetUrl,
      storage: target,
      tools,
    });
    expect(report.problems).toEqual([]);
    expect(report.tables).toBeGreaterThan(30);
    expect(report.files).toBe(manifest.files.count);

    // Restoring over data is refused.
    await expect(
      runRestore({
        dir,
        manifest,
        key,
        databaseUrl: targetUrl,
        storage: target,
        tools,
      }),
    ).rejects.toThrow(/not empty/);
  });

  it('verification notices a changed row and a lost file', async () => {
    await sql(
      targetUrl,
      `update drizzle.__drizzle_migrations set created_at = created_at + 1 where id = (select min(id) from drizzle.__drizzle_migrations)`,
    );
    await s3.send(
      new DeleteObjectCommand({ Bucket: target.bucket, Key: fileKey }),
    );
    const problems = await verifyRestore(manifest, targetUrl, target);
    expect(problems).toEqual(
      expect.arrayContaining([
        'table drizzle.__drizzle_migrations: same row count, different content',
        `file ${fileKey} is missing`,
      ]),
    );
  });
});
