import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { ARCHIVE_PART_BYTES } from '../../core/data-export/archive-limits.ts';
import { attachmentDisposition } from '../../core/media/file-name.ts';
import type { ExportBucket } from './r2-export-archive-storage.ts';
import { R2ExportArchiveStorage } from './r2-export-archive-storage.ts';

const MIB = 1024 * 1024;
const FIFTEEN_MIB = 15 * MIB;
const R2_DELETE_KEYS_LIMIT = 1000;
const ODD_CHUNK_BYTES = 3_000_011;

interface RecordedCalls {
  readonly partSizes: number[];
  readonly deleteSizes: number[];
}

// 実際のR2へ処理を委ねつつ、部分の大きさと削除の呼び出しの鍵数を記録する
function recordingBucket(real: R2Bucket): {
  readonly bucket: ExportBucket;
  readonly calls: RecordedCalls;
} {
  const calls: RecordedCalls = { partSizes: [], deleteSizes: [] };
  const wrap = (upload: R2MultipartUpload): R2MultipartUpload => ({
    key: upload.key,
    uploadId: upload.uploadId,
    uploadPart: (partNumber, value, options) => {
      calls.partSizes.push((value as Uint8Array).byteLength);
      return upload.uploadPart(partNumber, value, options);
    },
    abort: () => upload.abort(),
    complete: (parts) => upload.complete(parts),
  });
  const bucket: ExportBucket = {
    createMultipartUpload: async (key, options) =>
      wrap(await real.createMultipartUpload(key, options)),
    resumeMultipartUpload: (key, uploadId) =>
      wrap(real.resumeMultipartUpload(key, uploadId)),
    get: (key) => real.get(key),
    delete: (keys) => {
      calls.deleteSizes.push(Array.isArray(keys) ? keys.length : 1);
      return real.delete(keys);
    },
  };
  return { bucket, calls };
}

function abortFailingBucket(failure: Error): ExportBucket {
  return {
    createMultipartUpload: () => Promise.reject(failure),
    resumeMultipartUpload: (key, uploadId) => ({
      key,
      uploadId,
      uploadPart: () => Promise.reject(failure),
      abort: () => Promise.reject(failure),
      complete: () => Promise.reject(failure),
    }),
    get: () => Promise.reject(failure),
    delete: () => Promise.reject(failure),
  };
}

interface FailOnceCounts {
  complete: number;
  abort: number;
}

// 指定した段階の最初の1回だけ失敗する偽のアップロード
function failOnceBucket(failingStep: 'uploadPart' | 'complete'): {
  readonly bucket: ExportBucket;
  readonly counts: FailOnceCounts;
} {
  const counts: FailOnceCounts = { complete: 0, abort: 0 };
  const failures = new Set<string>([failingStep]);
  const failOnce = (step: string): Promise<void> => {
    if (failures.delete(step)) {
      return Promise.reject(new Error('一度きりの失敗'));
    }
    return Promise.resolve();
  };
  const upload: R2MultipartUpload = {
    key: 'data-exports/X.zip',
    uploadId: 'upload',
    uploadPart: async (partNumber) => {
      await failOnce('uploadPart');
      return { partNumber, etag: 'etag' };
    },
    abort: () => {
      counts.abort += 1;
      return Promise.resolve();
    },
    complete: async () => {
      counts.complete += 1;
      await failOnce('complete');
      return { key: 'data-exports/X.zip' } as R2Object;
    },
  };
  const bucket: ExportBucket = {
    createMultipartUpload: () => Promise.resolve(upload),
    resumeMultipartUpload: () => upload,
    get: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  };
  return { bucket, counts };
}

function newExportId(): string {
  return crypto.randomUUID().replaceAll('-', '').toUpperCase();
}

function patternBytes(start: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = (start + index) % 251;
  }
  return bytes;
}

async function digestOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function bytesOf(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function writeInChunks(
  upload: { write(chunk: Uint8Array): Promise<void> },
  total: number,
  chunkBytes: number,
): Promise<void> {
  for (let offset = 0; offset < total; offset += chunkBytes) {
    await upload.write(
      patternBytes(offset, Math.min(chunkBytes, total - offset)),
    );
  }
}

function newStorage(): {
  readonly storage: R2ExportArchiveStorage;
  readonly calls: RecordedCalls;
} {
  const { bucket, calls } = recordingBucket(env.FILES_BUCKET);
  return {
    storage: new R2ExportArchiveStorage({ FILES_BUCKET: bucket }),
    calls,
  };
}

describe('R2ExportArchiveStorage', () => {
  describe('objectKeyOf', () => {
    test('要求のIDからdata-exports配下のzipのキーを返す', () => {
      const { storage } = newStorage();

      expect(storage.objectKeyOf('01ABC')).toBe('data-exports/01ABC.zip');
    });
  });

  describe('beginUpload・write・complete', () => {
    test('15MiBを書くと最後以外の部分が10MiBで揃い、完了した大きさと内容が一致する', async () => {
      const { storage, calls } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });

      await writeInChunks(upload, FIFTEEN_MIB, ODD_CHUNK_BYTES);
      const completed = await upload.complete();

      expect(calls.partSizes).toStrictEqual([
        ARCHIVE_PART_BYTES,
        FIFTEEN_MIB - ARCHIVE_PART_BYTES,
      ]);
      expect(completed).toStrictEqual({ byteSize: FIFTEEN_MIB });
      const stored = await storage.open(objectKey);
      expect(stored?.size).toBe(FIFTEEN_MIB);
      const body = await bytesOf(
        stored?.body ?? new ReadableStream<Uint8Array>(),
      );
      expect(await digestOf(body)).toBe(
        await digestOf(patternBytes(0, FIFTEEN_MIB)),
      );
    });

    test('部分の大きさちょうどの20MiBでは空の最後の部分を送らない', async () => {
      const { storage, calls } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });

      await writeInChunks(upload, 2 * ARCHIVE_PART_BYTES, MIB);
      const completed = await upload.complete();

      expect(calls.partSizes).toStrictEqual([
        ARCHIVE_PART_BYTES,
        ARCHIVE_PART_BYTES,
      ]);
      expect(completed.byteSize).toBe(2 * ARCHIVE_PART_BYTES);
    });

    test('1部分に満たない書き込みは完了のときに1つの部分として送る', async () => {
      const { storage, calls } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });

      await upload.write(patternBytes(0, 1234));
      const completed = await upload.complete();

      expect(calls.partSizes).toStrictEqual([1234]);
      expect(completed).toStrictEqual({ byteSize: 1234 });
      expect((await storage.open(objectKey))?.size).toBe(1234);
    });

    test('アップロードのIDを返す', async () => {
      const { storage } = newStorage();
      const upload = await storage.beginUpload({
        objectKey: storage.objectKeyOf(newExportId()),
        fileName: 'export.zip',
      });

      expect(upload.uploadId).not.toBe('');

      await upload.abort();
    });

    test('完了や破棄の後の書き込みは拒否する', async () => {
      const { storage } = newStorage();
      const completedUpload = await storage.beginUpload({
        objectKey: storage.objectKeyOf(newExportId()),
        fileName: 'export.zip',
      });
      await completedUpload.write(patternBytes(0, 10));
      await completedUpload.complete();
      const abortedUpload = await storage.beginUpload({
        objectKey: storage.objectKeyOf(newExportId()),
        fileName: 'export.zip',
      });
      await abortedUpload.abort();

      await expect(completedUpload.write(patternBytes(0, 1))).rejects.toThrow();
      await expect(abortedUpload.write(patternBytes(0, 1))).rejects.toThrow();
    });
  });

  describe('完了の失敗', () => {
    test.each(['uploadPart', 'complete'] as const)(
      'complete中の%sの失敗の後は書き込み先が閉じ、欠けたまま完了せずabortは呼べる',
      async (failingStep) => {
        const harness = failOnceBucket(failingStep);
        const storage = new R2ExportArchiveStorage({
          FILES_BUCKET: harness.bucket,
        });
        const upload = await storage.beginUpload({
          objectKey: 'data-exports/X.zip',
          fileName: 'export.zip',
        });
        await upload.write(patternBytes(0, 100));

        await expect(upload.complete()).rejects.toThrow('一度きりの失敗');
        await expect(upload.complete()).rejects.toThrow(
          '完了または破棄したアップロードには書き込めません',
        );
        await expect(upload.write(patternBytes(0, 1))).rejects.toThrow(
          '完了または破棄したアップロードには書き込めません',
        );

        expect(harness.counts.complete).toBe(
          failingStep === 'complete' ? 1 : 0,
        );
        await expect(upload.abort()).resolves.toBeUndefined();
        expect(harness.counts.abort).toBe(1);
      },
    );

    test('満ちた部分の送信に失敗したwriteの後も書き込み先が閉じる', async () => {
      const harness = failOnceBucket('uploadPart');
      const storage = new R2ExportArchiveStorage({
        FILES_BUCKET: harness.bucket,
      });
      const upload = await storage.beginUpload({
        objectKey: 'data-exports/X.zip',
        fileName: 'export.zip',
      });

      await expect(
        upload.write(patternBytes(0, ARCHIVE_PART_BYTES)),
      ).rejects.toThrow('一度きりの失敗');
      await expect(upload.complete()).rejects.toThrow(
        '完了または破棄したアップロードには書き込めません',
      );

      expect(harness.counts.complete).toBe(0);
    });
  });

  describe('保存のメタデータと読み出し', () => {
    test('zipの種類・日本語のファイル名を含むattachment・private, no-storeを保存し、openが写しを返す', async () => {
      const { storage } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const fileName = 'データエクスポート-20261122.zip';
      const upload = await storage.beginUpload({ objectKey, fileName });
      await upload.write(patternBytes(0, 100));
      await upload.complete();

      const stored = await storage.open(objectKey);
      const raw = await env.FILES_BUCKET.head(objectKey);

      expect(stored?.meta).toStrictEqual({
        contentType: 'application/zip',
        contentDisposition: attachmentDisposition(fileName),
        cacheControl: 'private, no-store',
      });
      expect(stored?.meta.contentDisposition).toContain(
        "filename*=UTF-8''%E3%83%87",
      );
      expect(raw?.httpMetadata?.contentType).toBe('application/zip');
      expect(raw?.httpMetadata?.cacheControl).toBe('private, no-store');
      expect(stored?.size).toBe(100);
      expect(stored?.body).toBeInstanceOf(ReadableStream);
    });

    test('openは返す値にR2の型の項目を含めない', async () => {
      const { storage } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });
      await upload.write(patternBytes(0, 10));
      await upload.complete();

      const stored = await storage.open(objectKey);

      expect(Object.keys(stored ?? {}).sort()).toStrictEqual([
        'body',
        'meta',
        'size',
      ]);
      expect(Object.keys(stored?.meta ?? {}).sort()).toStrictEqual([
        'cacheControl',
        'contentDisposition',
        'contentType',
      ]);
    });

    test('無いキーのopenはundefinedを返す', async () => {
      const { storage } = newStorage();

      expect(
        await storage.open(storage.objectKeyOf(newExportId())),
      ).toBeUndefined();
    });
  });

  describe('abortUpload', () => {
    test('途中のアップロードを破棄するとオブジェクトが残らず、再度の破棄も成功する', async () => {
      const { storage } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });
      await writeInChunks(upload, ARCHIVE_PART_BYTES + MIB, MIB);

      await storage.abortUpload(objectKey, upload.uploadId);

      expect(await env.FILES_BUCKET.head(objectKey)).toBeNull();
      await expect(
        storage.abortUpload(objectKey, upload.uploadId),
      ).resolves.toBeUndefined();
    });

    test('書き込み先のabortの後もオブジェクトが無く、既に無いアップロードの破棄が成功する', async () => {
      const { storage } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });
      await upload.write(patternBytes(0, 10));

      await upload.abort();

      expect(await env.FILES_BUCKET.head(objectKey)).toBeNull();
      await expect(
        storage.abortUpload(objectKey, upload.uploadId),
      ).resolves.toBeUndefined();
    });

    test('R2がNoSuchUpload(10024)で拒否する存在しないアップロードの破棄は成功とみなす', async () => {
      const storage = new R2ExportArchiveStorage({
        FILES_BUCKET: abortFailingBucket(
          new Error(
            'abortMultipartUpload: The specified multipart upload does not exist. (10024)',
          ),
        ),
      });

      await expect(
        storage.abortUpload('data-exports/X.zip', 'gone'),
      ).resolves.toBeUndefined();
    });

    test('codeが10024のエラーはメッセージに番号が無くても成功とみなす', async () => {
      const storage = new R2ExportArchiveStorage({
        FILES_BUCKET: abortFailingBucket(
          Object.assign(new Error('abortMultipartUpload: no such upload'), {
            code: 10024,
          }),
        ),
      });

      await expect(
        storage.abortUpload('data-exports/X.zip', 'gone'),
      ).resolves.toBeUndefined();
    });

    test('NoSuchUpload以外の破棄の失敗は呼び出し元へ伝える', async () => {
      const storage = new R2ExportArchiveStorage({
        FILES_BUCKET: abortFailingBucket(
          new Error(
            'abortMultipartUpload: We encountered an internal error. Please try again. (10001)',
          ),
        ),
      });

      await expect(
        storage.abortUpload('data-exports/X.zip', 'upload'),
      ).rejects.toThrow('(10001)');
    });

    test('codeが10024以外のエラーはメッセージに10024があっても呼び出し元へ伝える', async () => {
      const storage = new R2ExportArchiveStorage({
        FILES_BUCKET: abortFailingBucket(
          Object.assign(new Error('abortMultipartUpload: failed (10024)'), {
            code: 10001,
          }),
        ),
      });

      await expect(
        storage.abortUpload('data-exports/X.zip', 'upload'),
      ).rejects.toThrow('(10024)');
    });

    test('完了済みのアップロードの破棄は保存済みのオブジェクトを消さない', async () => {
      const { storage } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });
      await upload.write(patternBytes(0, 10));
      await upload.complete();

      await storage.abortUpload(objectKey, upload.uploadId);

      expect((await storage.open(objectKey))?.size).toBe(10);
    });
  });

  describe('delete', () => {
    test('存在するキーと無いキーを混ぜて削除しても成功し、存在するキーは消える', async () => {
      const { storage } = newStorage();
      const objectKey = storage.objectKeyOf(newExportId());
      const upload = await storage.beginUpload({
        objectKey,
        fileName: 'export.zip',
      });
      await upload.write(patternBytes(0, 10));
      await upload.complete();

      await expect(
        storage.delete([objectKey, storage.objectKeyOf(newExportId())]),
      ).resolves.toBeUndefined();

      expect(await env.FILES_BUCKET.head(objectKey)).toBeNull();
    });

    test('キーが無い削除は何も呼ばずに成功する', async () => {
      const { storage, calls } = newStorage();

      await expect(storage.delete([])).resolves.toBeUndefined();
      expect(calls.deleteSizes).toStrictEqual([]);
    });

    test('1,000件を超えるキーは1,000件ずつに分けて削除する', async () => {
      const { storage, calls } = newStorage();
      const keys = Array.from({ length: 2 * R2_DELETE_KEYS_LIMIT + 1 }, () =>
        storage.objectKeyOf(newExportId()),
      );

      await storage.delete(keys);

      expect(calls.deleteSizes).toStrictEqual([
        R2_DELETE_KEYS_LIMIT,
        R2_DELETE_KEYS_LIMIT,
        1,
      ]);
    });
  });
});
