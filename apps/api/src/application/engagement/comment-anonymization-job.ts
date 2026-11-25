import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { EngagementErasureStore } from '../../../lib/core/engagement/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import {
  addBusinessDays,
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { ENGAGEMENT_TYPES } from './engagement-types.ts';
import type { EngagementIncidentReporter } from './ports.ts';

export const COMMENT_ANONYMIZATION_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'engagement.comment-anonymization',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 1400,
    handler: ENGAGEMENT_TYPES.CommentAnonymizationJob,
  });

// 4:21の起動の時間の予算とD1の負荷に収めるため1回の起動で匿名化する件数を区切り、残りは翌日の起動に任せる
export const COMMENT_ANONYMIZATION_BATCH_SIZE = 500;

export const COMMENT_ANONYMIZATION_MAX_BATCHES = 10;

// 削除の業務日付から13日目の4:21に匿名化し、削除から14日の期限の前に終える
const ANONYMIZE_BEFORE_BUSINESS_DAYS = 12;

// 前日の実行で匿名化されるはずだった行が残っていれば、期限までに匿名化できないおそれがある
const OVERDUE_BEFORE_BUSINESS_DAYS = ANONYMIZE_BEFORE_BUSINESS_DAYS + 1;

const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });

const logger = getAppLogger(['api', 'application', 'engagement']);

function startOfBusinessDaysBefore(date: BusinessDate, days: number): Date {
  return fromBusinessDateTime(addBusinessDays(date, -days), START_OF_DAY);
}

interface AnonymizationSummary {
  readonly anonymized: number;
  readonly batches: number;
  readonly limitReached: boolean;
}

@injectable()
export class CommentAnonymizationJob implements ScheduledJobHandler {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.EngagementErasureStore)
    private readonly erasure: EngagementErasureStore,
    @inject(ENGAGEMENT_TYPES.EngagementIncidentReporter)
    private readonly reporter: EngagementIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async run({ business }: ScheduledJobContext): Promise<void> {
    // 期限超過の検知は匿名化が失敗した場合の安全網のため、匿名化の成否によらず行う
    let summary: AnonymizationSummary;
    let overdue: number;
    try {
      summary = await this.#anonymize(
        startOfBusinessDaysBefore(
          business.date,
          ANONYMIZE_BEFORE_BUSINESS_DAYS,
        ),
      );
    } finally {
      overdue = await this.#reportOverdue(
        startOfBusinessDaysBefore(business.date, OVERDUE_BEFORE_BUSINESS_DAYS),
      );
    }
    logger.info('削除したコメントを匿名化しました', { ...summary, overdue });
  }

  async #anonymize(threshold: Date): Promise<AnonymizationSummary> {
    const at = this.clock.now();
    let anonymized = 0;
    let batches = 0;
    let lastCount: number;
    do {
      lastCount = await this.erasure.anonymizeDeletedBefore({
        threshold,
        at,
        limit: COMMENT_ANONYMIZATION_BATCH_SIZE,
      });
      anonymized += lastCount;
      batches += 1;
    } while (
      lastCount === COMMENT_ANONYMIZATION_BATCH_SIZE &&
      batches < COMMENT_ANONYMIZATION_MAX_BATCHES
    );
    return {
      anonymized,
      batches,
      limitReached: lastCount === COMMENT_ANONYMIZATION_BATCH_SIZE,
    };
  }

  async #reportOverdue(threshold: Date): Promise<number> {
    const overdue = await this.erasure.countOverdue(threshold);
    if (overdue > 0) {
      this.reporter.report({
        kind: 'comment-anonymization-overdue',
        count: overdue,
      });
    }
    return overdue;
  }
}
