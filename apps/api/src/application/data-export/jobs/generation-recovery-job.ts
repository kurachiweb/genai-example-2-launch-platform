import { inject, injectable } from 'inversify';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../../../lib/core/data-export/identifiers.ts';
import { GENERATION_STALL_SECONDS } from '../../../../lib/core/data-export/data-export-messages.ts';
import type {
  DataExportIncidentReporter,
  DataExportNotifier,
  DataExportRecord,
  DataExportStore,
  DataExportTerminator,
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

export const GENERATION_RECOVERY_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'data-export.generation-recovery',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 2110,
    handler: DATA_EXPORT_TYPES.GenerationRecoveryJob,
  });

// 確定の直後の通知の依頼と重ならないよう、確定から1時間以上経った依頼待ちだけを送り直す
const REDISPATCH_AFTER_MS = 60 * 60 * 1000;

const TERMINATION_FAILED_MESSAGE = '失敗として確定できなかった要求があります';

const logger = getAppLogger(['api', 'application', 'data-export']);

interface RecoverySummary {
  readonly found: number;
  readonly failed: number;
  readonly limitReached: boolean;
}

const toRecoverySummary = ({
  handled,
  retained,
  limitReached,
}: DrainSummary): RecoverySummary => ({
  found: handled,
  failed: retained,
  limitReached,
});

@injectable()
export class GenerationRecoveryJob implements ScheduledJobHandler {
  constructor(
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: DataExportStore,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportTerminator)
    private readonly terminator: DataExportTerminator,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportNotifier)
    private readonly notifier: DataExportNotifier,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter)
    private readonly reporter: DataExportIncidentReporter,
  ) {}

  // 失敗として確定した要求は作成中の一覧から外れ、依頼した通知は依頼待ちの一覧から外れるため、2回実行しても結果は変わらない
  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const terminated = await this.terminateStalled(scheduledTime);
    const redispatched = await this.redispatchNotices(scheduledTime);
    // 送り直しに失敗した通知は依頼待ちのまま残り翌日の起動が再び拾うため、ジョブは失敗にせず件数だけを運用者へ知らせる
    if (redispatched.failed > 0) {
      this.reporter.report({
        kind: 'notice-redispatch-failed',
        count: redispatched.failed,
      });
    }
    logger.info('生成の受け皿の処理を終えました', {
      terminated,
      redispatched,
    });
    // 確定できなかった要求は想定外の失敗のため、後続の処理を終えた後に例外としてエラートラッキングへ届ける
    if (terminated.failed > 0) {
      throw new Error(TERMINATION_FAILED_MESSAGE);
    }
  }

  private async terminateStalled(now: Date): Promise<RecoverySummary> {
    const requestedBefore = new Date(
      now.getTime() - GENERATION_STALL_SECONDS * 1000,
    );
    const summary = await drainInBatches({
      batchSize: DATA_EXPORT_JOB_BATCH_SIZE,
      maxBatches: DATA_EXPORT_JOB_MAX_BATCHES,
      list: (limit) => this.store.listStalled({ requestedBefore, limit }),
      handle: async (record) =>
        (await this.terminate(record, now)) ? 'resolved' : 'retained',
    });
    return toRecoverySummary(summary);
  }

  private async terminate(
    record: DataExportRecord,
    now: Date,
  ): Promise<boolean> {
    try {
      const outcome = await this.terminator.fail({
        exportId: record.id,
        kind: 'error',
        now,
        notify: true,
      });
      if (outcome === 'failed') {
        this.reporter.report({
          kind: 'generation-abandoned',
          exportId: record.id,
          by: 'recovery',
        });
      }
      return true;
    } catch (error: unknown) {
      logger.warning(
        '進んでいないデータエクスポートの要求を失敗として確定できませんでした',
        {
          exportId: record.id,
          error,
        },
      );
      return false;
    }
  }

  private async redispatchNotices(now: Date): Promise<RecoverySummary> {
    const updatedBefore = new Date(now.getTime() - REDISPATCH_AFTER_MS);
    const summary = await drainInBatches({
      batchSize: DATA_EXPORT_JOB_BATCH_SIZE,
      maxBatches: DATA_EXPORT_JOB_MAX_BATCHES,
      list: (limit) => this.store.listPendingNotices({ updatedBefore, limit }),
      handle: async (record) => {
        try {
          await this.notifier.notify(record.id);
          return 'resolved';
        } catch (error: unknown) {
          logger.warning('データエクスポートの通知を送り直せませんでした', {
            exportId: record.id,
            error,
          });
          return 'retained';
        }
      },
    });
    return toRecoverySummary(summary);
  }
}
