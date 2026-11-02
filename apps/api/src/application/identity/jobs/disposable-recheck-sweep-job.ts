import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { RECHECK_DISPOSABLE_EMAIL_MESSAGE } from '../../../../lib/core/messaging/contracts/identity.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { IDENTITY_TYPES } from '../identity-types.ts';
import type { IdentityMessagePublisher, UserAccountStore } from '../ports.ts';
import {
  atLeastOneHourBefore,
  limitedBatch,
  throwIfFailed,
} from './daily-job-support.ts';

export const DISPOSABLE_RECHECK_LIMIT = 50;

const logger = getAppLogger(['api', 'identity', 'disposable-recheck-sweep']);

@injectable()
export class DisposableRecheckSweepJob implements ScheduledJobHandler {
  constructor(
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: IdentityMessagePublisher,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const { targets, hasMore } = await limitedBatch(
      DISPOSABLE_RECHECK_LIMIT,
      (limit) =>
        this.users.listUndetermined(atLeastOneHourBefore(scheduledTime), limit),
    );
    const errors: unknown[] = [];
    for (const userId of targets) {
      try {
        await this.publisher.publish(RECHECK_DISPOSABLE_EMAIL_MESSAGE, {
          userId,
        });
      } catch (error: unknown) {
        // 判定は「未判定」のまま残るため、翌日の起動が再び依頼する
        logger.error('使い捨て判定の判定し直しを依頼できませんでした', {
          error,
          userId,
        });
        errors.push(error);
      }
    }
    logger.info('未判定の利用者の使い捨て判定の判定し直しを依頼しました', {
      found: targets.length,
      requested: targets.length - errors.length,
      failed: errors.length,
      hasMore,
    });
    throwIfFailed(
      errors,
      `使い捨て判定の判定し直しで${String(errors.length)}件の送信に失敗しました`,
    );
  }
}
