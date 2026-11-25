import { inject, injectable } from 'inversify';

import { ARCHIVE_PART_BYTES } from '../../core/data-export/archive-limits.ts';
import { createPartChunker } from '../../core/data-export/part-chunker.ts';
import type {
  ExportArchiveStorage,
  MultipartArchiveUpload,
  StoredArchive,
} from '../../core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { attachmentDisposition } from '../../core/media/file-name.ts';

export type ExportBucket = Pick<
  R2Bucket,
  'createMultipartUpload' | 'resumeMultipartUpload' | 'get' | 'delete'
>;

export interface ExportBucketEnv {
  readonly FILES_BUCKET: ExportBucket;
}

const ARCHIVE_CONTENT_TYPE = 'application/zip';
const ARCHIVE_CACHE_CONTROL = 'private, no-store';
const DELETE_KEYS_PER_CALL = 1000;
const NO_SUCH_UPLOAD_CODE = 10024;
const NO_SUCH_UPLOAD_MARKER = '(10024)';

// R2は存在しないアップロードの破棄をNoSuchUpload(10024)で拒否するが、破棄の目的(残さないこと)は達しているため成功とみなす。codeが無い経路ではメッセージ末尾の番号で判定する
function isNoSuchUpload(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if ('code' in error && typeof error.code === 'number') {
    return error.code === NO_SUCH_UPLOAD_CODE;
  }
  return error.message.includes(NO_SUCH_UPLOAD_MARKER);
}

async function abortQuietly(upload: R2MultipartUpload): Promise<void> {
  try {
    await upload.abort();
  } catch (error) {
    if (!isNoSuchUpload(error)) {
      throw error;
    }
  }
}

// Workersの型定義はR2の本文の要素の型を定めないが、R2の本文はバイト列の塊を流す
function bytesOf(body: ReadableStream): ReadableStream<Uint8Array> {
  return body as ReadableStream<Uint8Array>;
}

// 1つの部分の大きさのバッファだけを持ち、満ちた部分を順に送るため、ZIPの大きさに関わらずメモリは一定に収まる
class R2MultipartArchiveUpload implements MultipartArchiveUpload {
  private readonly chunker = createPartChunker(ARCHIVE_PART_BYTES);
  private readonly parts: R2UploadedPart[] = [];
  private byteSize = 0;
  private closed = false;

  constructor(private readonly upload: R2MultipartUpload) {}

  get uploadId(): string {
    return this.upload.uploadId;
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.assertOpen();
    await this.closingOnFailure(async () => {
      for (const part of this.chunker.push(chunk)) {
        await this.sendPart(part);
      }
    });
  }

  async complete(): Promise<{ readonly byteSize: number }> {
    this.assertOpen();
    await this.closingOnFailure(async () => {
      const last = this.chunker.flush();
      if (last !== undefined) {
        await this.sendPart(last);
      }
      await this.upload.complete(this.parts);
    });
    this.closed = true;
    return { byteSize: this.byteSize };
  }

  async abort(): Promise<void> {
    this.closed = true;
    await abortQuietly(this.upload);
  }

  // 失敗した時点でバッファや送信済みの部分が欠けるため、同じ書き込み先での再試行は欠けたまま完了してしまう。失敗したら閉じ、呼び出し側にabortさせる
  private async closingOnFailure(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.closed = true;
      throw error;
    }
  }

  private async sendPart(part: Uint8Array): Promise<void> {
    const uploaded = await this.upload.uploadPart(this.parts.length + 1, part);
    this.parts.push(uploaded);
    this.byteSize += part.byteLength;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('完了または破棄したアップロードには書き込めません');
    }
  }
}

@injectable()
export class R2ExportArchiveStorage implements ExportArchiveStorage {
  constructor(
    @inject(PLATFORM_TYPES.Env) private readonly env: ExportBucketEnv,
  ) {}

  objectKeyOf(exportId: string): string {
    return `data-exports/${exportId}.zip`;
  }

  async beginUpload(input: {
    readonly objectKey: string;
    readonly fileName: string;
  }): Promise<MultipartArchiveUpload> {
    const upload = await this.env.FILES_BUCKET.createMultipartUpload(
      input.objectKey,
      {
        httpMetadata: {
          contentType: ARCHIVE_CONTENT_TYPE,
          contentDisposition: attachmentDisposition(input.fileName),
          cacheControl: ARCHIVE_CACHE_CONTROL,
        },
      },
    );
    return new R2MultipartArchiveUpload(upload);
  }

  async abortUpload(objectKey: string, uploadId: string): Promise<void> {
    await abortQuietly(
      this.env.FILES_BUCKET.resumeMultipartUpload(objectKey, uploadId),
    );
  }

  async open(objectKey: string): Promise<StoredArchive | undefined> {
    const object = await this.env.FILES_BUCKET.get(objectKey);
    if (object === null) {
      return undefined;
    }
    return {
      body: bytesOf(object.body),
      size: object.size,
      meta: {
        contentType: object.httpMetadata?.contentType,
        contentDisposition: object.httpMetadata?.contentDisposition,
        cacheControl: object.httpMetadata?.cacheControl,
      },
    };
  }

  async delete(objectKeys: readonly string[]): Promise<void> {
    for (
      let start = 0;
      start < objectKeys.length;
      start += DELETE_KEYS_PER_CALL
    ) {
      await this.env.FILES_BUCKET.delete(
        objectKeys.slice(start, start + DELETE_KEYS_PER_CALL),
      );
    }
  }
}
