import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { envFilePath, validateEnv } from '../src/config/env';
import {
  mediaKey,
  StorageService,
  UploadRejectedError,
} from '../src/storage/storage.service';

// Runs against the local S3 service (`pnpm services:up`), bucket jengalink-test.
describe('private object storage (e2e)', () => {
  let moduleRef: TestingModule;
  let storage: StorageService;
  const photo = Buffer.from('fake-jpeg-bytes-for-a-site-photo');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath,
          validate: validateEnv,
        }),
      ],
      providers: [StorageService],
    }).compile();
    storage = moduleRef.get(StorageService);
    await storage.ensureBucket();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const finalKey = () => mediaKey(randomUUID(), randomUUID(), randomUUID());
  const put = (url: string, body: Buffer, contentType: string) =>
    fetch(url, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': contentType },
    });

  it('uploads with a signed PUT, promotes, and downloads with a signed GET', async () => {
    const grant = await storage.createUploadGrant('image/jpeg');
    expect(grant.key).toMatch(/^tmp\//);

    const upload = await put(grant.url, photo, grant.headers['Content-Type']);
    expect(upload.status).toBe(200);

    const key = finalKey();
    const stored = await storage.promoteUpload(grant, key);
    expect(stored).toEqual({
      key,
      sizeBytes: photo.length,
      contentType: 'image/jpeg',
    });

    const url = await storage.createDownloadUrl(key, { fileName: 'slab.jpg' });
    const download = await fetch(url);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('slab.jpg');
    expect(Buffer.from(await download.arrayBuffer())).toEqual(photo);

    // The temporary object is gone after promotion.
    await expect(storage.promoteUpload(grant, finalKey())).rejects.toThrow(
      'Upload not found',
    );
  });

  it('refuses unsigned reads: the bucket is private', async () => {
    const grant = await storage.createUploadGrant('image/jpeg');
    await put(grant.url, photo, 'image/jpeg');
    const key = finalKey();
    await storage.promoteUpload(grant, key);

    const signed = new URL(await storage.createDownloadUrl(key));
    const unsigned = `${signed.origin}${signed.pathname}`;
    expect((await fetch(unsigned)).status).toBe(403);
  });

  it('refuses a signed link used for a different object', async () => {
    const grant = await storage.createUploadGrant('image/jpeg');
    const otherKey = grant.url.replace(grant.key, `tmp/${randomUUID()}`);
    expect((await put(otherKey, photo, 'image/jpeg')).status).toBe(403);
  });

  it('refuses an upload with a different content type than granted', async () => {
    const grant = await storage.createUploadGrant('image/jpeg');
    expect((await put(grant.url, photo, 'text/html')).status).toBe(403);
  });

  it('refuses file types outside the allowed list', async () => {
    await expect(storage.createUploadGrant('text/html')).rejects.toThrow(
      UploadRejectedError,
    );
  });

  it('rejects and deletes an upload larger than its grant allows', async () => {
    const grant = await storage.createUploadGrant('image/jpeg', 10);
    await put(grant.url, photo, 'image/jpeg');

    await expect(storage.promoteUpload(grant, finalKey())).rejects.toThrow(
      'larger than 10 bytes',
    );
    await expect(storage.promoteUpload(grant, finalKey())).rejects.toThrow(
      'Upload not found',
    );
  });

  it('expires download links', async () => {
    const grant = await storage.createUploadGrant('application/pdf');
    await put(grant.url, photo, 'application/pdf');
    const key = finalKey();
    await storage.promoteUpload(grant, key);

    const url = await storage.createDownloadUrl(key, { expiresInSeconds: 1 });
    await new Promise((r) => setTimeout(r, 2100));
    expect((await fetch(url)).status).toBe(403);
  });
});
