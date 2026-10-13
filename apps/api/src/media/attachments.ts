import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type ClaimFile,
  ClaimFileType,
  MAX_CLAIM_FILE_BYTES,
} from '@jengalink/contracts';
import type { media, projects } from '../db/schema';
import {
  mediaKey,
  StorageService,
  UploadRejectedError,
} from '../storage/storage.service';

export type Promoted = { key: string; sizeBytes: number; contentType: string };
const scanView = {
  pending: 'processing',
  clean: 'ready',
  infected: 'blocked',
  failed: 'failed',
} as const;

/**
 * Files attached to a record (claims, spending requests): photos or PDFs, uploaded to a
 * temporary key, checked and moved before the record is saved, scanned by the media pipeline.
 */
@Injectable()
export class AttachmentsService {
  constructor(private readonly storage: StorageService) {}

  /** Moves uploads to final keys (checked first); a bad file stops the whole save. */
  async promote(
    project: typeof projects.$inferSelect,
    files: { uploadKey: string }[],
    prefix: string,
  ): Promise<Promoted[]> {
    const bad = files.findIndex(
      (f) => !f.uploadKey.startsWith(prefix) || f.uploadKey.includes('..'),
    );
    if (bad >= 0)
      throw new BadRequestException({
        message: 'Unknown file upload',
        fieldErrors: [
          {
            field: `files.${bad}.uploadKey`,
            message: 'Not an upload for this record',
          },
        ],
      });
    const promoted: Promoted[] = [];
    try {
      for (const f of files)
        promoted.push(
          await this.storage.promoteChecked(
            f.uploadKey,
            {
              maxBytes: MAX_CLAIM_FILE_BYTES,
              contentTypes: ClaimFileType.options,
            },
            mediaKey(project.organizationId, project.id, crypto.randomUUID()),
          ),
        );
    } catch (err) {
      await this.dropKeys(promoted.map((p) => p.key));
      if (err instanceof UploadRejectedError)
        throw new BadRequestException({
          message: `A file could not be used: ${err.message}`,
          fieldErrors: [
            { field: `files.${promoted.length}`, message: err.message },
          ],
        });
      throw err;
    }
    return promoted;
  }

  /** Storage is not transactional: callers drop keys once the rows are gone (or never saved). */
  async dropKeys(keys: string[]) {
    await Promise.all(
      keys.map((k) => this.storage.delete(k).catch(() => undefined)),
    );
  }

  /** What readers see; links only for clean files, nothing unscanned or blocked is handed out. */
  views(rows: (typeof media.$inferSelect)[]): Promise<ClaimFile[]> {
    return Promise.all(
      rows.map(async (f) => {
        const ready = f.scanStatus === 'clean';
        return {
          id: f.id,
          kind:
            f.contentType === 'application/pdf'
              ? ('document' as const)
              : ('photo' as const),
          fileName: f.fileName,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          status: scanView[f.scanStatus],
          url: ready
            ? await this.storage.createDownloadUrl(f.storageKey, {
                fileName: f.fileName ?? undefined,
                inline: true,
              })
            : null,
          thumbUrl:
            ready && f.thumbKey
              ? await this.storage.createDownloadUrl(f.thumbKey)
              : null,
          uploadedAt: f.createdAt.toISOString(),
        };
      }),
    );
  }
}
