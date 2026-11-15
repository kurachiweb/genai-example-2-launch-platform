import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import type {
  StoredLifecycleEvent,
  UserLifecycleStore,
} from '../../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../../lib/core/messaging/contracts/identity.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { AUTH_TYPES } from '../../auth/auth-types.ts';
import type { AuthIncidentReporter } from '../../auth/ports.ts';
import { IDENTITY_TYPES } from '../identity-types.ts';
import type { IdentityMessagePublisher } from '../ports.ts';
import {
  atLeastOneHourBefore,
  limitedBatch,
  throwIfFailed,
} from './daily-job-support.ts';

export const REDISPATCH_LIMIT = 100;

// 送信の回数は最初の送信を1と数えるため、送り直す前の回数がそのまま今回の送り直しが何回目かを表す
export const STUCK_REDISPATCH_ORDINAL = 3;

const logger = getAppLogger(['api', 'identity', 'lifecycle-redispatch']);

@injectable()
export class LifecycleRedispatchJob implements ScheduledJobHandler {
  constructor(
    @inject(IDENTITY_TYPES.UserLifecycleStore)
    private readonly lifecycle: UserLifecycleStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: IdentityMessagePublisher,
    @inject(AUTH_TYPES.AuthIncidentReporter)
    private readonly reporter: AuthIncidentReporter,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const { targets, hasMore } = await limitedBatch(REDISPATCH_LIMIT, (limit) =>
      this.lifecycle.listStalePending(
        atLeastOneHourBefore(scheduledTime),
        limit,
      ),
    );
    const errors: unknown[] = [];
    const redispatched: StoredLifecycleEvent[] = [];
    for (const event of targets) {
      if (await this.#publish(event, errors)) {
        redispatched.push(event);
      }
    }
    const stuckEventIds = redispatched
      .filter(({ dispatchCount }) => dispatchCount >= STUCK_REDISPATCH_ORDINAL)
      .map(({ id }) => id);
    if (stuckEventIds.length > 0) {
      this.reporter.report({
        kind: 'lifecycle-events-redispatched',
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
    logger.info('未完了のユーザーライフサイクルイベントを送り直しました', {
      found: targets.length,
      redispatched: redispatched.length,
      failed: errors.length,
      stuck: stuckEventIds.length,
      hasMore,
    });
    throwIfFailed(
      errors,
      `ライフサイクルイベントの送り直しで${String(errors.length)}件の送信に失敗しました`,
    );
  }

  // 送信に失敗したイベントは回数を増やさず、最後の送信日時も変えないため、翌日の起動が再び拾う
  async #publish(
    event: StoredLifecycleEvent,
    errors: unknown[],
  ): Promise<boolean> {
    try {
      await this.publisher.publish(RUN_USER_LIFECYCLE_MESSAGE, {
        eventId: event.id,
      });
      return true;
    } catch (error: unknown) {
      logger.error('ユーザーライフサイクルイベントを送り直せませんでした', {
        error,
        eventId: event.id,
        userId: event.userId,
      });
      errors.push(error);
      return false;
    }
  }
}
