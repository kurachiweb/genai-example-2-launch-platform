import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { unzipSync } from 'fflate';

import type {
  ExportFileView,
  ExportSnapshot,
} from '../../../lib/core/data-export/export-snapshot.ts';
import type {
  ClaimResult,
  DataExportNotifier,
  DataExportRecord,
  DataExportStore,
  DataExportTerminator,
  ExportArchiveStorage,
  MultipartArchiveUpload,
} from '../../../lib/core/data-export/ports.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type {
  MediaContent,
  MediaFiles,
} from '../../../lib/core/media/ports.ts';
import {
  ArchiveGenerationService,
  type GenerationOutcome,
} from './archive-generation-service.ts';
import type { ExportSnapshotCollector } from './export-snapshot-collector.ts';
import type { AccountSourceReader } from './sources/account-source-reader.ts';

export const EXPORT_ID = '01JE0DXPT00000000000000001';
export const USER_ID = '01JE0DXUS00000000000000001';
export const OBJECT_KEY = `data-exports/${EXPORT_ID}.zip`;
export const UPLOAD_ID = 'UPLOAD-NEW';
export const REQUESTED_AT = new Date('2026-11-22T12:00:00.000Z');
export const NOW = new Date('2026-11-22T04:21:00.000Z');
export const FINISHED_AT = new Date('2026-11-22T04:21:07.500Z');
export const DURATION_MS = 7500;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const LEASE_MS = 1200 * 1000;
export const HANDLE = 'secret-handle';
export const ZIP_FILE_NAME = `launch-stadium-export-${HANDLE}-20261122.zip`;
export const ATTEMPTS = 2;

const AT = new Date('2026-11-01T00:00:00.000Z');

function fileView(fileId: string): ExportFileView {
  return {
    fileId,
    originalFileName: `${fileId}.png`,
    contentType: 'image/png',
    byteSize: 10,
    quarantined: false,
  };
}

export function snapshotOf(): ExportSnapshot {
  return {
    requestedAt: REQUESTED_AT,
    account: {
      email: 'user@example.com',
      emailVerifiedAt: AT,
      registeredAt: AT,
      mfaEnabled: false,
      plan: null,
      notificationSettings: null,
      apiKeys: [],
    },
    profile: {
      handle: HANDLE,
      nickname: 'ユーザー',
      headline: null,
      bioMarkdown: null,
      avatarFileId: 'F-AVATAR',
      websites: [],
      updatedAt: AT,
    },
    products: [
      {
        id: 'P-1',
        handle: 'product-one',
        name: 'プロダクト1',
        tagline: 'タグライン',
        categoryName: '開発ツール',
        websiteUrl: 'https://product.example/',
        descriptionMarkdown: '説明',
        logoFileId: 'F-LOGO',
        screenshotFileIds: ['F-SHOT'],
        createdAt: AT,
        updatedAt: AT,
        deletedAt: null,
        hiddenByAdmin: false,
      },
    ],
    launches: [],
    comments: [],
    upvotes: [],
    ratings: [],
    follows: [],
    reports: [],
    inquiries: [
      {
        id: 'I-1',
        category: '不具合',
        status: 'open',
        createdAt: AT,
        messages: [
          {
            id: 'M-1',
            sender: 'user',
            adminNickname: null,
            body: '困っています',
            attachments: [
              {
                fileId: 'F-ATTACH',
                originalFileName: 'F-ATTACH.png',
                contentType: 'image/png',
                size: 10,
              },
            ],
            createdAt: AT,
          },
        ],
      },
    ],
    sponsorships: [],
    payments: [],
    files: new Map(
      ['F-AVATAR', 'F-LOGO', 'F-SHOT', 'F-ATTACH'].map((fileId) => [
        fileId,
        fileView(fileId),
      ]),
    ),
  };
}

export function recordOf(
  overrides: Partial<DataExportRecord> = {},
): DataExportRecord {
  return {
    id: EXPORT_ID,
    userId: USER_ID,
    status: 'generating',
    requestedAt: REQUESTED_AT,
    runToken: 'TOKEN',
    leaseExpiresAt: new Date(NOW.getTime() + LEASE_MS),
    attempts: ATTEMPTS,
    uploadId: null,
    objectKey: null,
    fileName: null,
    byteSize: null,
    completedAt: null,
    expiresAt: null,
    failedAt: null,
    failureKind: null,
    noticeStatus: 'none',
    updatedAt: NOW,
    ...overrides,
  };
}

export function bodyOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

export function erroringBody(error: Error): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('途中まで'));
      controller.error(error);
    },
  });
}

export function contentOf(
  fileId: string,
  body: ReadableStream<Uint8Array> = bodyOf(`内容:${fileId}`),
): MediaContent {
  return { file: { id: fileId } as MediaFileView, body };
}

export interface HarnessOptions {
  readonly claim?: ClaimResult;
  readonly claimError?: Error;
  readonly snapshot?: ExportSnapshot | undefined;
  readonly collectError?: Error;
  readonly unreadableFileIds?: readonly string[];
  readonly openContent?: (fileId: string) => Promise<MediaContent | undefined>;
  readonly recordUploadResult?: boolean;
  readonly markReadyResult?: boolean;
  readonly markReadyError?: Error;
  readonly accountExists?: boolean;
  readonly existsError?: Error;
  readonly terminatorResult?: 'failed' | 'already_finished';
  readonly terminatorError?: Error;
  readonly abortUploadError?: Error;
  readonly uploadAbortError?: Error;
  readonly storageDeleteError?: Error;
  readonly notifyError?: Error;
  readonly releaseLeaseError?: Error;
}

function resolveOrReject<T>(error: Error | undefined, value: T): Promise<T> {
  return error === undefined ? Promise.resolve(value) : Promise.reject(error);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const merged = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export interface ZipTimestamp {
  readonly name: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const END_RECORD_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;

// 中央ディレクトリの各項目からDOS形式の更新日時を読み、ローカルの時刻の成分へ戻す
function readZipTimestamps(zip: Uint8Array): readonly ZipTimestamp[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endOffset = zip.length - END_RECORD_BYTES;
  const count = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const entries: ZipTimestamp[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = view.getUint16(offset + 12, true);
    const date = view.getUint16(offset + 14, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      name: new TextDecoder().decode(
        zip.subarray(
          offset + CENTRAL_HEADER_BYTES,
          offset + CENTRAL_HEADER_BYTES + nameLength,
        ),
      ),
      year: (date >> 9) + 1980,
      month: (date >> 5) & 15,
      day: date & 31,
      hour: time >> 11,
      minute: (time >> 5) & 63,
      second: (time & 31) * 2,
    });
    offset += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function createHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const calls = {
    claim: [] as Parameters<DataExportStore['claim']>[0][],
    recordUpload: [] as Parameters<DataExportStore['recordUpload']>[0][],
    releaseLease: [] as Parameters<DataExportStore['releaseLease']>[0][],
    markReady: [] as Parameters<DataExportStore['markReady']>[0][],
    collect: [] as unknown[][],
    abortUpload: [] as unknown[][],
    beginUpload: [] as Parameters<ExportArchiveStorage['beginUpload']>[0][],
    delete: [] as (readonly string[])[],
    fail: [] as Parameters<DataExportTerminator['fail']>[0][],
    notify: [] as string[],
    exists: [] as string[],
    opened: [] as string[],
  };
  const written: Uint8Array[] = [];
  const upload: MultipartArchiveUpload = {
    uploadId: UPLOAD_ID,
    write: (chunk) => {
      written.push(Uint8Array.from(chunk));
      return Promise.resolve();
    },
    complete: () => {
      events.push('upload.complete');
      return Promise.resolve({ byteSize: concatenate(written).length });
    },
    abort: () => {
      events.push('upload.abort');
      return resolveOrReject(options.uploadAbortError, undefined);
    },
  };
  const store: Pick<
    DataExportStore,
    'claim' | 'recordUpload' | 'releaseLease' | 'markReady'
  > = {
    claim: (input) => {
      events.push('claim');
      calls.claim.push(input);
      return options.claimError === undefined
        ? Promise.resolve(
            options.claim ?? { kind: 'claimed', record: recordOf() },
          )
        : Promise.reject(options.claimError);
    },
    recordUpload: (input) => {
      events.push('recordUpload');
      calls.recordUpload.push(input);
      return Promise.resolve(options.recordUploadResult ?? true);
    },
    releaseLease: (input) => {
      events.push('releaseLease');
      calls.releaseLease.push(input);
      return resolveOrReject(options.releaseLeaseError, undefined);
    },
    markReady: (input) => {
      events.push('markReady');
      calls.markReady.push(input);
      return resolveOrReject(
        options.markReadyError,
        options.markReadyResult ?? true,
      );
    },
  };
  const storage: Pick<
    ExportArchiveStorage,
    'objectKeyOf' | 'beginUpload' | 'abortUpload' | 'delete'
  > = {
    objectKeyOf: (exportId) => `data-exports/${exportId}.zip`,
    beginUpload: (input) => {
      events.push('beginUpload');
      calls.beginUpload.push(input);
      return Promise.resolve(upload);
    },
    abortUpload: (...args) => {
      events.push('storage.abortUpload');
      calls.abortUpload.push(args);
      return resolveOrReject(options.abortUploadError, undefined);
    },
    delete: (keys) => {
      events.push('storage.delete');
      calls.delete.push(keys);
      return resolveOrReject(options.storageDeleteError, undefined);
    },
  };
  const notifier: DataExportNotifier = {
    notify: (exportId) => {
      events.push('notify');
      calls.notify.push(exportId);
      return resolveOrReject(options.notifyError, 'requested' as const);
    },
  };
  const terminator: DataExportTerminator = {
    fail: (input) => {
      events.push('terminator.fail');
      calls.fail.push(input);
      return resolveOrReject(
        options.terminatorError,
        options.terminatorResult ?? ('failed' as const),
      );
    },
  };
  const collector: Pick<ExportSnapshotCollector, 'collect'> = {
    collect: (...args) => {
      events.push('collect');
      calls.collect.push(args);
      return resolveOrReject(
        options.collectError,
        'snapshot' in options ? options.snapshot : snapshotOf(),
      );
    },
  };
  const accounts: Pick<AccountSourceReader, 'exists'> = {
    exists: (userId) => {
      events.push('exists');
      calls.exists.push(userId);
      return resolveOrReject(
        options.existsError,
        options.accountExists ?? true,
      );
    },
  };
  const unreadable = new Set(options.unreadableFileIds ?? []);
  const files: Pick<MediaFiles, 'openContent'> = {
    openContent: (fileId) => {
      calls.opened.push(fileId);
      if (options.openContent !== undefined) {
        return options.openContent(fileId);
      }
      return Promise.resolve(
        unreadable.has(fileId) ? undefined : contentOf(fileId),
      );
    },
  };
  const service = new ArchiveGenerationService(
    store as DataExportStore,
    storage as ExportArchiveStorage,
    notifier,
    terminator,
    collector as ExportSnapshotCollector,
    accounts as AccountSourceReader,
    files as MediaFiles,
    { now: () => FINISHED_AT },
  );

  return {
    events,
    calls,
    written,
    runToken: (): string => calls.claim[0]?.runToken ?? '',
    generate: (): Promise<GenerationOutcome> =>
      service.generate({ exportId: EXPORT_ID, now: NOW }),
    zipBytes: (): number => concatenate(written).length,
    zipTimestamps: (): readonly ZipTimestamp[] =>
      readZipTimestamps(concatenate(written)),
    zipEntries: (): Record<string, Uint8Array> =>
      unzipSync(concatenate(written)),
  };
}

export function captureLogs(): {
  readonly start: () => void;
  readonly stop: () => void;
  readonly all: () => readonly LogRecord[];
} {
  let records: LogRecord[] = [];
  return {
    start: () => {
      records = [];
      configureSync({
        reset: true,
        sinks: { capture: (record) => records.push(record) },
        loggers: [
          { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
          { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
        ],
      });
    },
    stop: () => {
      resetSync();
    },
    all: () => records,
  };
}

export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('例外になりませんでした');
}
