import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../../lib/core/product/identifiers.ts';
import type { ProductLifecycleStore } from '../../../../lib/core/product/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
} from '../../../../lib/core/time/business-time.ts';
import { addBusinessDays } from '../../../domain/product/launch-date-rules.ts';
import type {
  ProductIncidentReporter,
  ProductMessagePublisher,
} from '../ports.ts';
import { PRODUCT_TYPES } from '../product-types.ts';
import {
  DAY_MS,
  jobLogger,
  limitedBatch,
  publishLifecycleEvent,
  throwIfFailed,
} from './product-job-support.ts';

export const PRODUCT_PURGE_ORCHESTRATOR_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'product-launch.purge-orchestrator',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 1000,
    handler: PRODUCT_TYPES.ProductPurgeOrchestratorJob,
  });

export const PRODUCT_PURGE_CANDIDATE_LIMIT = 200;

// 論理削除の業務日付が実行日の13日前以前のプロダクトを対象にし、14日の期限まで再試行の余地を残す
export const PRODUCT_PURGE_START_AFTER_BUSINESS_DAYS = 13;

export const PRODUCT_PURGE_DEADLINE_MS = 14 * DAY_MS;

const MIDNIGHT = Object.freeze({ hour: 0, minute: 0 });

interface PurgeStartSummary {
  readonly found: number;
  readonly created: number;
  readonly published: number;
  readonly failed: number;
  readonly hasMore: boolean;
}

// 実行日の12日前の業務日付の0:00より前に論理削除したものが、業務日付で13日以上前の論理削除になる
function purgeBoundaryOf(date: BusinessDate): Date {
  return fromBusinessDateTime(
    addBusinessDays(date, -(PRODUCT_PURGE_START_AFTER_BUSINESS_DAYS - 1)),
    MIDNIGHT,
  );
}

@injectable()
export class ProductPurgeOrchestratorJob implements ScheduledJobHandler {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductLifecycleStore)
    private readonly lifecycle: ProductLifecycleStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: ProductMessagePublisher,
    @inject(PRODUCT_TYPES.ProductIncidentReporter)
    private readonly reporter: ProductIncidentReporter,
  ) {}

  async run({ scheduledTime, business }: ScheduledJobContext): Promise<void> {
    // 期限超過の検知は物理削除の開始が失敗した場合の安全網のため、開始の成否によらず行う
    let summary: PurgeStartSummary;
    let overdue: number;
    const publishErrors: unknown[] = [];
    try {
      summary = await this.#startPurges(
        purgeBoundaryOf(business.date),
        scheduledTime,
        publishErrors,
      );
    } finally {
      overdue = await this.#reportOverdue(scheduledTime);
    }
    jobLogger.info('論理削除したプロダクトの物理削除を開始しました', {
      ...summary,
      overdue,
    });
    throwIfFailed(
      publishErrors,
      `プロダクトの物理削除の開始で${String(publishErrors.length)}件の送信に失敗しました`,
    );
  }

  async #reportOverdue(scheduledTime: Date): Promise<number> {
    const overdue = await this.lifecycle.countOverduePurges(
      new Date(scheduledTime.getTime() - PRODUCT_PURGE_DEADLINE_MS),
    );
    if (overdue > 0) {
      this.reporter.report({ kind: 'product-purge-overdue', count: overdue });
    }
    return overdue;
  }

  async #startPurges(
    deletedBefore: Date,
    at: Date,
    errors: unknown[],
  ): Promise<PurgeStartSummary> {
    const { targets, hasMore } = await limitedBatch(
      PRODUCT_PURGE_CANDIDATE_LIMIT,
      (limit) => this.lifecycle.listPurgeCandidates(deletedBefore, limit),
    );
    const events =
      targets.length === 0
        ? []
        : await this.lifecycle.createPurgeDueEvents(targets, at);
    for (const event of events) {
      await publishLifecycleEvent(
        this.publisher,
        event,
        '物理削除の時期の到来のイベントの送信を要求できませんでした',
        errors,
      );
    }
    return {
      found: targets.length,
      created: events.length,
      published: events.length - errors.length,
      failed: errors.length,
      hasMore,
    };
  }
}
