import type {
  DataExportFailureKind,
  DataExportStatus,
} from '../../../common-lib/data-export/data-export-rules.ts';
import type { ArchiveByteSink } from './zip-archive-writer.ts';

export type DataExportNoticeStatus =
  'none' | 'pending' | 'requested' | 'skipped';

export interface DataExportRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: DataExportStatus;
  readonly requestedAt: Date;
  readonly runToken: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly attempts: number;
  readonly uploadId: string | null;
  readonly objectKey: string | null;
  readonly fileName: string | null;
  readonly byteSize: number | null;
  readonly completedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly failedAt: Date | null;
  readonly failureKind: DataExportFailureKind | null;
  readonly noticeStatus: DataExportNoticeStatus;
  readonly updatedAt: Date;
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly record: DataExportRecord }
  | { readonly kind: 'busy' }
  | { readonly kind: 'finished' }
  | { readonly kind: 'not_found' };

export interface DataExportStore {
  create(input: {
    readonly id: string;
    readonly userId: string;
    readonly requestedAt: Date;
  }): Promise<DataExportRecord>;
  remove(id: string): Promise<void>;
  find(id: string): Promise<DataExportRecord | undefined>;
  findOwnedReady(input: {
    readonly id: string;
    readonly userId: string;
    readonly now: Date;
  }): Promise<DataExportRecord | undefined>;
  claim(input: {
    readonly id: string;
    readonly runToken: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  }): Promise<ClaimResult>;
  recordUpload(input: {
    readonly id: string;
    readonly runToken: string;
    readonly uploadId: string;
    readonly objectKey: string;
  }): Promise<boolean>;
  releaseLease(input: {
    readonly id: string;
    readonly runToken: string;
  }): Promise<void>;
  markReady(input: {
    readonly id: string;
    readonly runToken: string;
    readonly fileName: string;
    readonly byteSize: number;
    readonly completedAt: Date;
    readonly expiresAt: Date;
  }): Promise<boolean>;
  markFailed(input: {
    readonly id: string;
    readonly kind: DataExportFailureKind;
    readonly failedAt: Date;
    readonly notice: 'pending' | 'skipped';
  }): Promise<DataExportRecord | undefined>;
  advanceNotice(input: {
    readonly id: string;
    readonly to: 'requested' | 'skipped';
  }): Promise<boolean>;
  listStalled(input: {
    readonly requestedBefore: Date;
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]>;
  listPendingNotices(input: {
    readonly updatedBefore: Date;
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]>;
  listExpired(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]>;
  markExpired(id: string): Promise<boolean>;
  listFailedWithUpload(input: {
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]>;
  clearUpload(id: string): Promise<void>;
  listByUserPage(input: {
    readonly userId: string;
    readonly afterId: string | undefined;
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]>;
  listForUser(input: {
    readonly userId: string;
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]>;
  removeMany(ids: readonly string[]): Promise<void>;
}

export interface MultipartArchiveUpload extends ArchiveByteSink {
  readonly uploadId: string;
  complete(): Promise<{ readonly byteSize: number }>;
  abort(): Promise<void>;
}

export interface StoredArchiveMeta {
  readonly contentType: string | undefined;
  readonly contentDisposition: string | undefined;
  readonly cacheControl: string | undefined;
}

export interface StoredArchive {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly meta: StoredArchiveMeta;
}

export interface ExportArchiveStorage {
  objectKeyOf(exportId: string): string;
  beginUpload(input: {
    readonly objectKey: string;
    readonly fileName: string;
  }): Promise<MultipartArchiveUpload>;
  abortUpload(objectKey: string, uploadId: string): Promise<void>;
  open(objectKey: string): Promise<StoredArchive | undefined>;
  delete(objectKeys: readonly string[]): Promise<void>;
}

export interface DataExportNotifier {
  notify(exportId: string): Promise<'requested' | 'skipped' | 'not_pending'>;
}

export interface DataExportTerminator {
  fail(input: {
    readonly exportId: string;
    readonly kind: DataExportFailureKind;
    readonly now: Date;
    readonly notify: boolean;
  }): Promise<'failed' | 'already_finished'>;
}

export type DataExportIncident =
  | {
      readonly kind: 'generation-failed';
      readonly exportId: string;
      readonly attempts: number;
      readonly error: unknown;
    }
  | {
      readonly kind: 'generation-abandoned';
      readonly exportId: string;
      readonly by: 'watchdog' | 'recovery';
    }
  | {
      readonly kind: 'archive-deletion-failed';
      readonly job: string;
      readonly count: number;
    }
  | { readonly kind: 'notice-redispatch-failed'; readonly count: number }
  | { readonly kind: 'archive-missing'; readonly exportId: string };

export interface DataExportIncidentReporter {
  report(incident: DataExportIncident): void;
}
