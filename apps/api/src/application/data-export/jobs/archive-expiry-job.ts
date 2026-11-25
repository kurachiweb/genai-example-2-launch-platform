import { inject, injectable } from 'inversify';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../../../lib/core/data-export/identifiers.ts';
import type {
  DataExportIncidentReporter,
  DataExportRecord,
  DataExportStore,
  ExportArchiveStorage,
} from '../../../../lib/core/data-export/ports.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { DATA_EXPORT_TYPES } from '../data-export-types.ts';
import {
  DATA_EXPORT_JOB_BATCH_SIZE,
  DATA_EXPORT_JOB_MAX_BATCHES,
  type DrainSummary,
  drainInBatches,
} from './batch-drain.ts';

export const ARCHIVE_EXPIRY_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'data-export.archive-expiry',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 2100,
    handler: DATA_EXPORT_TYPES.ArchiveExpiryJob,
  });

const logger = getAppLogger(['api', 'application', 'data-export']);

interface StageSummary {
  readonly found: number;
  readonly failed: number;
  readonly limitReached: boolean;
}

const toStageSummary = ({
  handled,
  retained,
  limitReached,
}: DrainSummary): StageSummary => ({
  found: handled,
  failed: retained,
  limitReached,
});

@injectable()
export class ArchiveExpiryJob implements ScheduledJobHandler {
  constructor(
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: DataExportStore,
    @inject(DATA_EXPORT_PLATFORM_TYPES.ExportArchiveStorage)
    private readonly storage: ExportArchiveStorage,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter)
    private readonly reporter: DataExportIncidentReporter,
  ) {}

  // 期限の列と未完了のアップロードの有無で対象を選び、処理した記録は次の読み取りから外れるため、2回実行しても結果は変わらない。記録は履歴として残し、ZIPと未完了のアップロードだけを消す
  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const expired = await this.expireReady(scheduledTime);
    const aborted = await this.abortFailedUploads();
    const failed = expired.failed + aborted.failed;
    // 失敗した記録は次の起動が再び拾うため、ジョブは失敗にせず件数だけを運用者へ知らせる
    if (failed > 0) {
      this.reporter.report({
        kind: 'archive-deletion-failed',
        job: ARCHIVE_EXPIRY_JOB_DEFINITION.name,
        count: failed,
      });
    }
    logger.info('期限切れのデータエクスポートのファイルを整理しました', {
      expired,
      aborted,
    });
  }

  private async expireReady(now: Date): Promise<StageSummary> {
    const summary = await drainInBatches({
      batchSize: DATA_EXPORT_JOB_BATCH_SIZE,
      maxBatches: DATA_EXPORT_JOB_MAX_BATCHES,
      list: (limit) => this.store.listExpired({ now, limit }),
      handle: async (record) => {
        if (!(await this.deleteObject(record))) {
          return 'retained';
        }
        await this.store.markExpired(record.id);
        return 'resolved';
      },
    });
    return toStageSummary(summary);
  }

  private async abortFailedUploads(): Promise<StageSummary> {
    const summary = await drainInBatches({
      batchSize: DATA_EXPORT_JOB_BATCH_SIZE,
      maxBatches: DATA_EXPORT_JOB_MAX_BATCHES,
      list: (limit) => this.store.listFailedWithUpload({ limit }),
      handle: async (record) => {
        if (!(await this.abortUpload(record))) {
          return 'retained';
        }
        await this.store.clearUpload(record.id);
        return 'resolved';
      },
    });
    return toStageSummary(summary);
  }

  // オブジェクトが既に無くても削除は成功するため、置き場所の列だけを見て削除する。失敗した記録は完了のまま残り、次の起動が削除し直す
  private async deleteObject(record: DataExportRecord): Promise<boolean> {
    if (record.objectKey === null) {
      return true;
    }
    try {
      await this.storage.delete([record.objectKey]);
      return true;
    } catch (error: unknown) {
      logger.warning(
        '期限切れのデータエクスポートのファイルを削除できませんでした',
        {
          exportId: record.id,
          error,
        },
      );
      return false;
    }
  }

  private async abortUpload(record: DataExportRecord): Promise<boolean> {
    if (record.uploadId === null) {
      return true;
    }
    try {
      await this.storage.abortUpload(
        record.objectKey ?? this.storage.objectKeyOf(record.id),
        record.uploadId,
      );
      return true;
    } catch (error: unknown) {
      logger.warning(
        '失敗したデータエクスポートの未完了のアップロードを破棄できませんでした',
        {
          exportId: record.id,
          error,
        },
      );
      return false;
    }
  }
}
