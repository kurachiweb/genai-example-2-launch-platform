import type { Logger } from '@logtape/logtape';

import type { DataExportFailureKind } from '../../../common-lib/data-export/data-export-rules.ts';
import type {
  DataExportNotifier,
  DataExportRecord,
  DataExportStore,
  DataExportTerminator,
  ExportArchiveStorage,
} from '../../core/data-export/ports.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

type FailOutcome = Awaited<ReturnType<DataExportTerminator['fail']>>;

const UNFINISHED_STATUSES: ReadonlySet<DataExportRecord['status']> = new Set([
  'queued',
  'generating',
]);

export class StoreDataExportTerminator implements DataExportTerminator {
  private readonly logger: Logger;

  constructor(
    private readonly store: DataExportStore,
    private readonly storage: ExportArchiveStorage,
    private readonly notifier: DataExportNotifier,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'infrastructure', 'data-export']);
  }

  async fail(input: {
    readonly exportId: string;
    readonly kind: DataExportFailureKind;
    readonly now: Date;
    readonly notify: boolean;
  }): Promise<FailOutcome> {
    const record = await this.store.find(input.exportId);
    if (record === undefined || !UNFINISHED_STATUSES.has(record.status)) {
      return 'already_finished';
    }
    await this.abortUpload(record);
    const failed = await this.store.markFailed({
      id: input.exportId,
      kind: input.kind,
      failedAt: input.now,
      notice: input.notify ? 'pending' : 'skipped',
    });
    if (failed === undefined) {
      return 'already_finished';
    }
    if (input.notify) {
      await this.tryNotify(input.exportId);
    }
    return 'failed';
  }

  // 破棄に失敗しても失敗の確定を止めない。アップロードの記録は失敗した要求に残り、日次の後片付けが破棄し直す
  private async abortUpload(record: DataExportRecord): Promise<void> {
    if (record.uploadId === null || record.objectKey === null) {
      return;
    }
    try {
      await this.storage.abortUpload(record.objectKey, record.uploadId);
    } catch (error) {
      this.logger.warn('未完了のアップロードを破棄できませんでした', {
        exportId: record.id,
        error,
      });
    }
  }

  // 通知の状態は依頼待ちのまま残るため、日次の送り直しが再び依頼する
  private async tryNotify(exportId: string): Promise<void> {
    try {
      await this.notifier.notify(exportId);
    } catch (error) {
      this.logger.warn('失敗の通知を依頼できませんでした', {
        exportId,
        error,
      });
    }
  }
}
