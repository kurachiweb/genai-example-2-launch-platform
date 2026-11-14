import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import type { UserLifecycleStore } from '../../../../lib/core/identity/ports.ts';
import type { UserLifecycleEvent } from '../../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../../lib/core/messaging/contracts/identity.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
} from '../../../../lib/core/time/business-time.ts';
import { AUTH_TYPES } from '../../auth/auth-types.ts';
import type { AuthIncidentReporter } from '../../auth/ports.ts';
import { IDENTITY_TYPES } from '../identity-types.ts';
import type { IdentityMessagePublisher } from '../ports.ts';
import { DAY_MS, limitedBatch, throwIfFailed } from './daily-job-support.ts';

export const PURGE_CANDIDATE_LIMIT = 50;

// 退会の業務日付が実行日の13日前以前の利用者を対象にし、14日の期限まで再試行の余地を残す
export const PURGE_START_AFTER_BUSINESS_DAYS = 13;

export const PURGE_DEADLINE_MS = 14 * DAY_MS;

const MIDNIGHT = { hour: 0, minute: 0 } as const;

const logger = getAppLogger(['api', 'identity', 'purge-orchestrator']);

interface PurgeStartSummary {
  readonly found: number;
  readonly created: number;
  readonly published: number;
  readonly failed: number;
  readonly hasMore: boolean;
}

// 業務時刻は固定のオフセットのため、業務日付の0:00から日数分のミリ秒を引けば前の業務日付の0:00になる
function purgeBoundaryOf(date: BusinessDate): Date {
  const midnight = fromBusinessDateTime(date, MIDNIGHT);
  return new Date(
    midnight.getTime() - (PURGE_START_AFTER_BUSINESS_DAYS - 1) * DAY_MS,
  );
}

@injectable()
export class PurgeOrchestratorJob implements ScheduledJobHandler {
  constructor(
    @inject(IDENTITY_TYPES.UserLifecycleStore)
    private readonly lifecycle: UserLifecycleStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: IdentityMessagePublisher,
    @inject(AUTH_TYPES.AuthIncidentReporter)
    private readonly reporter: AuthIncidentReporter,
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
    logger.info('退会ユーザーの物理削除を開始しました', {
      ...summary,
      overdue,
    });
    throwIfFailed(
      publishErrors,
      `物理削除の開始で${String(publishErrors.length)}件の送信に失敗しました`,
    );
  }

  async #reportOverdue(scheduledTime: Date): Promise<number> {
    const overdue = await this.lifecycle.countOverduePurges(
      new Date(scheduledTime.getTime() - PURGE_DEADLINE_MS),
    );
    if (overdue > 0) {
      this.reporter.report({ kind: 'purge-overdue', count: overdue });
    }
    return overdue;
  }

  async #startPurges(
    deletedBefore: Date,
    at: Date,
    errors: unknown[],
  ): Promise<PurgeStartSummary> {
    const { targets, hasMore } = await limitedBatch(
      PURGE_CANDIDATE_LIMIT,
      (limit) => this.lifecycle.listPurgeCandidates(deletedBefore, limit),
    );
    const events =
      targets.length === 0
        ? []
        : await this.lifecycle.createPurgeDueEvents(targets, at);
    for (const event of events) {
      await this.#publish(event, errors);
    }
    return {
      found: targets.length,
      created: events.length,
      published: events.length - errors.length,
      failed: errors.length,
      hasMore,
    };
  }

  // 送信に失敗したイベントは未完了のまま残り、業務時刻16:21の送り直しのジョブが送る
  async #publish(event: UserLifecycleEvent, errors: unknown[]): Promise<void> {
    try {
      await this.publisher.publish(RUN_USER_LIFECYCLE_MESSAGE, {
        eventId: event.id,
      });
    } catch (error: unknown) {
      logger.error('物理削除の開始のイベントの送信を要求できませんでした', {
        error,
        eventId: event.id,
        userId: event.userId,
      });
      errors.push(error);
    }
  }
}
