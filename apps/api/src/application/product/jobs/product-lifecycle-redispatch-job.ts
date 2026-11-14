import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../../lib/core/product/identifiers.ts';
import type {
  ProductLifecycleStore,
  StoredProductLifecycleEvent,
} from '../../../../lib/core/product/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import type {
  ProductIncidentReporter,
  ProductMessagePublisher,
} from '../ports.ts';
import { PRODUCT_TYPES } from '../product-types.ts';
import {
  HOUR_MS,
  jobLogger,
  limitedBatch,
  publishLifecycleEvent,
  throwIfFailed,
} from './product-job-support.ts';

export const PRODUCT_LIFECYCLE_REDISPATCH_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'product-launch.lifecycle-redispatch',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 1010,
    handler: PRODUCT_TYPES.ProductLifecycleRedispatchJob,
  });

export const PRODUCT_REDISPATCH_LIMIT = 100;

// 送信の回数は最初の送信を1と数えるため、送り直す前の回数がそのまま今回の送り直しが何回目かを表す。
// 処理の例外はデッドレターで知らされるが、届いても完了しないまま送り直しが続くイベントは他に知る手段が無いため、3回目から運用者へ報告する
export const PRODUCT_STUCK_REDISPATCH_ORDINAL = 3;

// ストアは期限を「より前」で比べるため、ちょうど1時間前の記録も含めるよう1ミリ秒後を渡す
function atLeastOneHourBefore(scheduledTime: Date): Date {
  return new Date(scheduledTime.getTime() - HOUR_MS + 1);
}

@injectable()
export class ProductLifecycleRedispatchJob implements ScheduledJobHandler {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductLifecycleStore)
    private readonly lifecycle: ProductLifecycleStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: ProductMessagePublisher,
    @inject(PRODUCT_TYPES.ProductIncidentReporter)
    private readonly reporter: ProductIncidentReporter,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const { targets, hasMore } = await limitedBatch(
      PRODUCT_REDISPATCH_LIMIT,
      (limit) =>
        this.lifecycle.listStalePending(
          atLeastOneHourBefore(scheduledTime),
          limit,
        ),
    );
    const errors: unknown[] = [];
    const redispatched: StoredProductLifecycleEvent[] = [];
    // 送信に失敗したイベントは回数と最後の送信日時を変えないため、翌日の起動が再び拾う
    for (const event of targets) {
      if (
        await publishLifecycleEvent(
          this.publisher,
          event,
          'プロダクトライフサイクルイベントを送り直せませんでした',
          errors,
        )
      ) {
        redispatched.push(event);
      }
    }
    const stuckEventIds = redispatched
      .filter(
        ({ dispatchCount }) =>
          dispatchCount >= PRODUCT_STUCK_REDISPATCH_ORDINAL,
      )
      .map(({ id }) => id);
    if (stuckEventIds.length > 0) {
      this.reporter.report({
        kind: 'product-lifecycle-events-redispatched',
        count: redispatched.length,
        stuckEventIds,
      });
    }
    if (redispatched.length > 0) {
      await this.lifecycle.markRedispatched(
        redispatched.map(({ id }) => id),
        scheduledTime,
      );
    }
    jobLogger.info('未完了のプロダクトライフサイクルイベントを送り直しました', {
      found: targets.length,
      redispatched: redispatched.length,
      failed: errors.length,
      stuck: stuckEventIds.length,
      hasMore,
    });
    throwIfFailed(
      errors,
      `プロダクトライフサイクルイベントの送り直しで${String(errors.length)}件の送信に失敗しました`,
    );
  }
}
