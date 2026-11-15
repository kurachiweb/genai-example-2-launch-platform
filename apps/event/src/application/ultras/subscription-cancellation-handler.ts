import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type { StripeGateway } from '../../../lib/core/payments/ports.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type {
  SubscriptionRow,
  SubscriptionStore,
} from '../../../lib/core/ultras/ports.ts';

interface CancellationPlan {
  readonly source: 'withdrawal' | 'suspension';
  readonly atPeriodEnd: boolean;
  // 課金期間の末日に終わるよう予約済みの加入をそのまま保つか
  readonly keepScheduled: boolean;
}

// 退会は停止で予約済みの加入も含めて即時に解約し、停止は予約の無い加入だけ課金期間の末日に解約する。停止の解除は登録しないため持たない
const PLANS: Partial<Record<UserLifecycleEventType, CancellationPlan>> =
  Object.freeze({
    withdrawn: {
      source: 'withdrawal',
      atPeriodEnd: false,
      keepScheduled: false,
    },
    suspended: { source: 'suspension', atPeriodEnd: true, keepScheduled: true },
  });

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'ultras', 'cancellation']);

// 出どころの記録をStripeの呼び出しの前に書くため、Stripeの失敗の再試行でも記録が残る。Stripe上で解約済みの加入は成功として扱うため、再試行で同じ結果になる。Stripeの例外は捕まえずに投げ、波及処理の再試行に任せる
@injectable()
export class SubscriptionCancellationHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(ULTRAS_TYPES.SubscriptionStore)
    private readonly subscriptions: SubscriptionStore,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const plan = PLANS[event.type];
    if (plan === undefined) {
      logger.warn(
        '退会・停止以外のライフサイクルイベントのため解約せずに終えました',
        {
          eventId: event.id,
          userId: event.userId,
          type: event.type,
          outcome: 'ignored',
        },
      );
      return DONE;
    }
    const rows = await this.subscriptions.findCancellable(event.userId);
    const targets = plan.keepScheduled
      ? rows.filter((row) => !row.cancelScheduled)
      : rows;
    for (const row of targets) {
      await this.cancel(event, row, plan);
    }
    logger.info('退会・停止に伴う定期課金の解約を終えました', {
      eventId: event.id,
      userId: event.userId,
      type: event.type,
      canceled: targets.length,
      kept: rows.length - targets.length,
      outcome: 'completed',
    });
    return DONE;
  }

  private async cancel(
    event: UserLifecycleEvent,
    row: SubscriptionRow,
    plan: CancellationPlan,
  ): Promise<void> {
    await this.subscriptions.markPendingCancellation({
      id: row.id,
      source: plan.source,
    });
    const result = await this.gateway.cancelSubscription(
      row.stripeSubscriptionId,
      { atPeriodEnd: plan.atPeriodEnd },
    );
    logger.info('退会・停止に伴い定期課金を解約しました', {
      eventId: event.id,
      userId: event.userId,
      subscriptionId: row.id,
      stripeSubscriptionId: row.stripeSubscriptionId,
      source: plan.source,
      atPeriodEnd: plan.atPeriodEnd,
      result,
    });
  }
}
