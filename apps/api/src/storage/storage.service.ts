import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env';

/** File types the pilot accepts: site photos and receipts/documents. */
export const allowedContentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;
export type AllowedContentType = (typeof allowedContentTypes)[number];

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const UPLOAD_TTL_SECONDS = 10 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

export interface UploadGrant {
  key: string;
  url: string;
  method: 'PUT';
  /** Headers the client must send exactly; they are part of the signature. */
  headers: { 'Content-Type': AllowedContentType };
  maxBytes: number;
  expiresAt: string;
}

export class UploadRejectedError extends Error {}

export const isAllowedContentType = (t: string): t is AllowedContentType =>
  (allowedContentTypes as readonly string[]).includes(t);

/** Final object keys mirror the ownership scope (spec §16.3). */
export const mediaKey = (
  organizationId: string,
  projectId: string,
  mediaId: string,
) => `orgs/${organizationId}/projects/${projectId}/media/${mediaId}`;

/**
 * Private object storage (spec §16.2). Clients never get bucket credentials:
 * they upload to a temporary key with a short-lived signed PUT, the server
 * verifies the object, then promotes it to its final key. Downloads use
 * short-lived signed GETs, issued only after the caller's access is checked.
 */
@Injectable()
export class StorageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly signer: S3Client;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const base = {
      region: config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
      // Otherwise the SDK signs a checksum of the *empty* body into presigned
      // PUT links, and every real upload fails with BadDigest.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    const endpoint = config.getOrThrow<string>('S3_ENDPOINT');
    this.s3 = new S3Client({ ...base, endpoint });
    // Signing is offline; links must name the host the client can reach.
    this.signer = new S3Client({
      ...base,
      endpoint: config.get<string>('S3_PUBLIC_ENDPOINT') || endpoint,
    });
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
  }

  async onApplicationBootstrap() {
    const env = this.config.get<AppEnv>('APP_ENV');
    if (env === 'development' || env === 'test') await this.ensureBucket();
  }

  /** Creates the bucket locally; hosted buckets are provisioned outside the app. */
  async ensureBucket() {
    if (await this.isHealthy()) return;
    await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.logger.log(`Created bucket ${this.bucket}`);
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /** `prefix` scopes temporary keys (e.g. per project) so an upload can only be used where it was granted. */
  async createUploadGrant(
    contentType: string,
    maxBytes = DEFAULT_MAX_BYTES,
    prefix = 'tmp/',
  ): Promise<UploadGrant> {
    if (!isAllowedContentType(contentType)) {
      throw new UploadRejectedError(`File type ${contentType} is not allowed`);
    }
    if (!prefix.startsWith('tmp/') || !prefix.endsWith('/'))
      throw new UploadRejectedError('Upload prefix must be under tmp/');
    const key = `${prefix}${randomUUID()}`;
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      {
        expiresIn: UPLOAD_TTL_SECONDS,
        signableHeaders: new Set(['content-type']),
      },
    );
    return {
      key,
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      maxBytes,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Checks an uploaded temporary object against its grant and moves it to
   * `finalKey`. A missing, empty, oversized or mistyped object is deleted and
   * rejected, so a client cannot bypass the limits by ignoring them.
   */
  promoteUpload(
    grant: Pick<UploadGrant, 'key' | 'maxBytes' | 'headers'>,
    finalKey: string,
  ): Promise<{ key: string; sizeBytes: number; contentType: string }> {
    return this.promoteChecked(
      grant.key,
      {
        maxBytes: grant.maxBytes,
        contentTypes: [grant.headers['Content-Type']],
      },
      finalKey,
    );
  }

  /** Same checks as promoteUpload, accepting any of `contentTypes` (the grant itself is not stored). */
  async promoteChecked(
    key: string,
    limits: { maxBytes: number; contentTypes: readonly string[] },
    finalKey: string,
  ): Promise<{ key: string; sizeBytes: number; contentType: string }> {
    const grant = { key, maxBytes: limits.maxBytes };
    if (!grant.key.startsWith('tmp/')) {
      throw new UploadRejectedError('Not an upload key');
    }
    let head: HeadObjectCommandOutput;
    try {
      head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: grant.key }),
      );
    } catch {
      throw new UploadRejectedError('Upload not found');
    }
    const sizeBytes = head.ContentLength ?? 0;
    const contentType = head.ContentType ?? '';
    let problem: string | null = null;
    if (sizeBytes === 0) problem = 'File is empty';
    else if (sizeBytes > grant.maxBytes)
      problem = `File is larger than ${grant.maxBytes} bytes`;
    else if (!limits.contentTypes.includes(contentType))
      problem = 'File type does not match the upload';
    if (problem) {
      await this.delete(grant.key);
      throw new UploadRejectedError(problem);
    }
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: finalKey,
        CopySource: `${this.bucket}/${grant.key}`,
      }),
    );
    await this.delete(grant.key);
    return { key: finalKey, sizeBytes, contentType };
  }

  /** Call only after checking the caller may see the object's parent record. */
  createDownloadUrl(
    key: string,
    options: {
      fileName?: string;
      inline?: boolean;
      expiresInSeconds?: number;
    } = {},
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.fileName
          ? `${options.inline ? 'inline' : 'attachment'}; filename="${options.fileName.replace(/["\\]/g, '')}"`
          : undefined,
      }),
      { expiresIn: options.expiresInSeconds ?? DOWNLOAD_TTL_SECONDS },
    );
  }

  /** Server-side read (photo processing). Never hand the bytes to a client without an access check. */
  async getObject(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
