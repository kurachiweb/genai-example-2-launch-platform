import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { MODERATION_PLATFORM_TYPES } from '../../../../lib/core/moderation/identifiers.ts';
import type { ModerationRecordStore } from '../../../../lib/core/moderation/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import type { ModerationNotifier } from '../moderation-notifier.ts';
import { MODERATION_TYPES } from '../moderation-types.ts';
import type { ModerationIncidentReporter } from '../ports.ts';

export const MODERATION_MAINTENANCE_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'ugc-moderation.maintenance',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 1910,
    handler: MODERATION_TYPES.ModerationMaintenanceJob,
  });

export const MODERATION_NOTICE_REDISPATCH_LIMIT = 100;

// 4:21の起動の時間の予算とD1の負荷に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const MODERATION_RECORD_ERASE_BATCH_SIZE = 500;

export const MODERATION_RECORD_ERASE_MAX_BATCHES = 10;

const MODERATION_RECORD_RETENTION_YEARS = 3;

// 措置の確定の直後の通知の依頼と重ならないよう、1時間以上前の依頼待ちだけを送り直す
const REDISPATCH_AFTER_MS = 60 * 60 * 1000;

const logger = getAppLogger(['api', 'application', 'moderation']);

// UTCの暦で3年前の同じ時刻。同じ日が無い2月29日は月末へ寄せ、3年に満たない記録を消さない
export function moderationRecordRetentionCutoff(scheduledTime: Date): Date {
  const year =
    scheduledTime.getUTCFullYear() - MODERATION_RECORD_RETENTION_YEARS;
  const month = scheduledTime.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(scheduledTime.getUTCDate(), lastDayOfMonth),
      scheduledTime.getUTCHours(),
      scheduledTime.getUTCMinutes(),
      scheduledTime.getUTCSeconds(),
      scheduledTime.getUTCMilliseconds(),
    ),
  );
}

interface RedispatchSummary {
  readonly found: number;
  readonly requested: number;
  readonly skipped: number;
  readonly notPending: number;
  readonly failed: number;
}

interface ErasureSummary {
  readonly erased: number;
  readonly batches: number;
  readonly limitReached: boolean;
}

@injectable()
export class ModerationMaintenanceJob implements ScheduledJobHandler {
  constructor(
    @inject(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
    private readonly records: ModerationRecordStore,
    @inject(MODERATION_TYPES.ModerationNotifier)
    private readonly notifier: ModerationNotifier,
    @inject(MODERATION_TYPES.ModerationIncidentReporter)
    private readonly reporter: ModerationIncidentReporter,
  ) {}

  // 通知は依頼待ちの記録だけを送り、記録の削除は日時の条件で消すため、2回実行しても結果は変わらない
  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    // 保持期間の削除は送り直しの成否に関わらず行う
    let redispatch: RedispatchSummary;
    let erasure: ErasureSummary;
    try {
      redispatch = await this.#redispatch(
        new Date(scheduledTime.getTime() - REDISPATCH_AFTER_MS),
      );
    } finally {
      erasure = await this.#erase(
        moderationRecordRetentionCutoff(scheduledTime),
      );
    }
    logger.info(
      '措置の通知を送り直し、保持期間を過ぎた措置の記録を削除しました',
      { ...redispatch, ...erasure },
    );
  }

  async #redispatch(occurredBefore: Date): Promise<RedispatchSummary> {
    const pending = await this.records.listPendingNotices({
      occurredBefore,
      limit: MODERATION_NOTICE_REDISPATCH_LIMIT,
    });
    let requested = 0;
    let skipped = 0;
    let notPending = 0;
    let failed = 0;
    for (const { id } of pending) {
      try {
        const outcome = await this.notifier.dispatch(id);
        if (outcome === 'requested') {
          requested += 1;
        } else if (outcome === 'skipped') {
          skipped += 1;
        } else {
          notPending += 1;
        }
      } catch (error: unknown) {
        failed += 1;
        logger.warning('措置の通知を送り直せませんでした', {
          actionId: id,
          error,
        });
      }
    }
    // 失敗した通知は依頼待ちのまま残り翌日の起動が再び拾うため、ジョブは失敗にせず件数だけを運用者へ知らせる
    if (failed > 0) {
      this.reporter.report('notice-redispatch-failed', {
        job: MODERATION_MAINTENANCE_JOB_DEFINITION.name,
        count: failed,
      });
    }
    return { found: pending.length, requested, skipped, notPending, failed };
  }

  async #erase(threshold: Date): Promise<ErasureSummary> {
    let erased = 0;
    let batches = 0;
    let lastCount: number;
    do {
      lastCount = await this.records.eraseOccurredBefore(
        threshold,
        MODERATION_RECORD_ERASE_BATCH_SIZE,
      );
      erased += lastCount;
      batches += 1;
    } while (
      lastCount === MODERATION_RECORD_ERASE_BATCH_SIZE &&
      batches < MODERATION_RECORD_ERASE_MAX_BATCHES
    );
    return {
      erased,
      batches,
      limitReached: lastCount === MODERATION_RECORD_ERASE_BATCH_SIZE,
    };
  }
}
