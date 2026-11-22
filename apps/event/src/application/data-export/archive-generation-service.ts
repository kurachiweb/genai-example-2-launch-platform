import { inject, injectable } from 'inversify';

import {
  DATA_EXPORT_RETENTION_DAYS,
  type DataExportFailureKind,
} from '../../../common-lib/data-export/data-export-rules.ts';
import { ArchiveTooLargeError } from '../../../lib/core/data-export/archive-limits.ts';
import { archiveFileName } from '../../../lib/core/data-export/archive-names.ts';
import { GENERATION_LEASE_SECONDS } from '../../../lib/core/data-export/data-export-messages.ts';
import { buildExportDocuments } from '../../../lib/core/data-export/documents/build-export-documents.ts';
import { planArchive } from '../../../lib/core/data-export/export-plan.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type {
  DataExportNotifier,
  DataExportRecord,
  DataExportStore,
  DataExportTerminator,
  ExportArchiveStorage,
  MultipartArchiveUpload,
} from '../../../lib/core/data-export/ports.ts';
import {
  createZipArchiveWriter,
  type ZipArchiveWriter,
} from '../../../lib/core/data-export/zip-archive-writer.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_DATA_EXPORT_TYPES } from './event-data-export-types.ts';
import type { ExportSnapshotCollector } from './export-snapshot-collector.ts';
import type { AccountSourceReader } from './sources/account-source-reader.ts';

export type GenerationOutcome =
  'ready' | 'busy' | 'finished' | 'canceled' | 'too_large' | 'superseded';

export interface GenerateArchiveInput {
  readonly exportId: string;
  readonly now: Date;
}

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;

const logger = getAppLogger(['event', 'application', 'data-export']);

interface ArchiveRun {
  readonly record: DataExportRecord;
  readonly runToken: string;
  readonly now: Date;
  upload: MultipartArchiveUpload | undefined;
  objectKey: string | undefined;
  completed: boolean;
  bytes: number;
  entries: number;
}

// 画像と添付を先に、JSONを最後に書いて、JSONのパスを実際に格納できたファイルに一致させながらZIPを作り、保存先へ分割してアップロードする。要求の状態の確定は実行の印を条件にした更新で行うため、同じ要求が重ねて生成されても1つだけが完了する
@injectable()
export class ArchiveGenerationService {
  constructor(
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: DataExportStore,
    @inject(DATA_EXPORT_PLATFORM_TYPES.ExportArchiveStorage)
    private readonly storage: ExportArchiveStorage,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportNotifier)
    private readonly notifier: DataExportNotifier,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportTerminator)
    private readonly terminator: DataExportTerminator,
    @inject(EVENT_DATA_EXPORT_TYPES.ExportSnapshotCollector)
    private readonly collector: ExportSnapshotCollector,
    @inject(EVENT_DATA_EXPORT_TYPES.AccountSourceReader)
    private readonly accounts: AccountSourceReader,
    @inject(MEDIA_TYPES.MediaFiles) private readonly files: MediaFiles,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 一時的な失敗は、アップロードの破棄とリースの解放の後に元の例外を投げる
  async generate(input: GenerateArchiveInput): Promise<GenerationOutcome> {
    const runToken = crypto.randomUUID();
    const claim = await this.store.claim({
      id: input.exportId,
      runToken,
      now: input.now,
      leaseUntil: new Date(
        input.now.getTime() + GENERATION_LEASE_SECONDS * MS_PER_SECOND,
      ),
    });
    if (claim.kind === 'busy') {
      return 'busy';
    }
    if (claim.kind !== 'claimed') {
      return 'finished';
    }
    const run: ArchiveRun = {
      record: claim.record,
      runToken,
      now: input.now,
      upload: undefined,
      objectKey: undefined,
      completed: false,
      bytes: 0,
      entries: 0,
    };
    try {
      return await this.produce(run);
    } catch (error) {
      return await this.handleFailure(run, error);
    }
  }

  private async produce(run: ArchiveRun): Promise<GenerationOutcome> {
    const { record, now } = run;
    await this.abortPreviousUpload(record);
    const snapshot = await this.collector.collect(
      record.userId,
      record.requestedAt,
      now,
    );
    if (snapshot === undefined) {
      return await this.fail(run, 'error', false, 'canceled');
    }
    const objectKey = this.storage.objectKeyOf(record.id);
    const fileName = archiveFileName(
      snapshot.profile.handle,
      record.requestedAt,
    );
    const upload = await this.storage.beginUpload({ objectKey, fileName });
    run.upload = upload;
    run.objectKey = objectKey;
    const recorded = await this.store.recordUpload({
      id: record.id,
      runToken: run.runToken,
      uploadId: upload.uploadId,
      objectKey,
    });
    if (!recorded) {
      await this.discard(run);
      return 'superseded';
    }

    const writer = createZipArchiveWriter({
      write: async (chunk) => {
        await upload.write(chunk);
        run.bytes += chunk.length;
      },
    });
    const plan = planArchive(snapshot);
    const stored = await this.writeBinaries(run, writer, plan.binaries);
    const documents = buildExportDocuments({ snapshot, plan, stored });
    for (const { path, text } of documents.files) {
      await writer.addText(path, text, now);
      run.entries += 1;
    }
    await writer.finish();
    const { byteSize } = await upload.complete();
    run.completed = true;
    return await this.finalize(run, fileName, byteSize);
  }

  // 前の実行が異常終了して残したアップロードを、新しいアップロードを始める前に破棄する
  private async abortPreviousUpload(record: DataExportRecord): Promise<void> {
    if (record.uploadId !== null && record.objectKey !== null) {
      await this.storage.abortUpload(record.objectKey, record.uploadId);
    }
  }

  // 読み出しの時点で隔離・削除されていたファイルは格納せず、格納の集合にも入れない
  private async writeBinaries(
    run: ArchiveRun,
    writer: ZipArchiveWriter,
    binaries: readonly { readonly fileId: string; readonly path: string }[],
  ): Promise<ReadonlySet<string>> {
    const stored = new Set<string>();
    for (const { fileId, path } of binaries) {
      const content = await this.files.openContent(fileId);
      if (content === undefined) {
        continue;
      }
      await writer.addStream(path, content.body, run.now);
      run.entries += 1;
      stored.add(fileId);
    }
    return stored;
  }

  private async finalize(
    run: ArchiveRun,
    fileName: string,
    byteSize: number,
  ): Promise<GenerationOutcome> {
    const { record } = run;
    if (!(await this.accounts.exists(record.userId))) {
      await this.removeArchive(run);
      return await this.fail(run, 'error', false, 'canceled');
    }
    const completedAt = this.clock.now();
    const marked = await this.store.markReady({
      id: record.id,
      runToken: run.runToken,
      fileName,
      byteSize,
      completedAt,
      expiresAt: new Date(
        completedAt.getTime() + DATA_EXPORT_RETENTION_DAYS * MS_PER_DAY,
      ),
    });
    if (!marked) {
      await this.removeArchive(run);
      return 'superseded';
    }
    run.bytes = byteSize;
    this.logFinished(run, 'ready');
    await this.requestNotice(record.id);
    return 'ready';
  }

  private async removeArchive(run: ArchiveRun): Promise<void> {
    if (run.objectKey !== undefined) {
      await this.storage.delete([run.objectKey]);
    }
    run.completed = false;
    run.upload = undefined;
  }

  private async fail(
    run: ArchiveRun,
    kind: DataExportFailureKind,
    notify: boolean,
    outcome: 'canceled' | 'too_large',
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<GenerationOutcome> {
    const result = await this.terminator.fail({
      exportId: run.record.id,
      kind,
      now: run.now,
      notify,
    });
    if (result !== 'failed') {
      return 'finished';
    }
    this.logFinished(run, outcome, extra);
    return outcome;
  }

  // 通知の状態は完了の記録と同時に依頼待ちになるため、依頼の失敗は日次の送り直しに任せる
  private async requestNotice(exportId: string): Promise<void> {
    try {
      await this.notifier.notify(exportId);
    } catch (error) {
      logger.warn('完了の通知を依頼できませんでした', {
        exportId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  private async handleFailure(
    run: ArchiveRun,
    error: unknown,
  ): Promise<GenerationOutcome> {
    const discarded = await this.discard(run);
    try {
      if (error instanceof ArchiveTooLargeError) {
        return await this.fail(run, 'too_large', true, 'too_large', {
          limit: error.limit,
        });
      }
    } catch (failure) {
      return await this.rethrow(run, discarded, failure);
    }
    return await this.rethrow(run, discarded, error);
  }

  // 破棄に失敗したときはリースを残す。期限が切れた後の次の実行が、記録に残ったアップロードを破棄し直す
  private async rethrow(
    run: ArchiveRun,
    discarded: boolean,
    error: unknown,
  ): Promise<never> {
    logger.warn('データエクスポートの生成が一時的に失敗しました', {
      ...this.attributesOf(run),
      outcome: 'retry',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    if (discarded) {
      await this.releaseLease(run);
    }
    throw error;
  }

  private async releaseLease(run: ArchiveRun): Promise<void> {
    try {
      await this.store.releaseLease({
        id: run.record.id,
        runToken: run.runToken,
      });
    } catch (error) {
      logger.warn('リースを解放できませんでした', {
        exportId: run.record.id,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  // 完了前ならアップロードを破棄し、完了後ならZIPを削除する。成功したかを返す
  private async discard(run: ArchiveRun): Promise<boolean> {
    try {
      if (run.completed) {
        await this.removeArchive(run);
      } else if (run.upload !== undefined) {
        await run.upload.abort();
        run.upload = undefined;
      }
      return true;
    } catch (error) {
      logger.warn('作りかけのZIPを片付けられませんでした', {
        exportId: run.record.id,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return false;
    }
  }

  private attributesOf(run: ArchiveRun) {
    return {
      exportId: run.record.id,
      byteSize: run.bytes,
      entryCount: run.entries,
      durationMs: Math.max(0, this.clock.now().getTime() - run.now.getTime()),
      attempts: run.record.attempts,
    };
  }

  private logFinished(
    run: ArchiveRun,
    outcome: 'ready' | 'canceled' | 'too_large',
    extra: Readonly<Record<string, unknown>> = {},
  ): void {
    logger.info(
      outcome === 'ready'
        ? 'データエクスポートのZIPを生成しました'
        : 'データエクスポートの生成を失敗として確定しました',
      { ...this.attributesOf(run), outcome, ...extra },
    );
  }
}
