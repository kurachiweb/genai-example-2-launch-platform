import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type { OpenCheckoutExpirer } from '../../../lib/core/payments/ports.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearEntryFollowUp,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';

const OPEN_CHECKOUT_EXPIRY_LIMIT = 50;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

function isPendingFollowUp({
  refundStatus,
  refundNoticeStatus,
}: YearEntryRecord): boolean {
  return refundStatus === 'pending' || refundNoticeStatus === 'pending';
}

// 喪失はこの呼び出しで書き換えた枠しか返さず、再試行・続きの呼び出しでは0件になるため、失効と返金待ちの対象は毎回プロダクトの枠のローンチから求め直す。
// 喪失は凍結前の受付中・資格を得た枠だけを書き換え、失効は残りの未完了の決済を毎回選び直し、返金の依頼は枠ごとの依頼キーで重複を除かれるため、
// 再試行・送り直し・続きの再開で同じイベントを何度処理してもよい。凍結の後に届いた削除は喪失が0件になり、組み合わせ決定の分類で喪失にした枠の返金待ちを処理する。
// 失敗は捕まえずに投げ、イベントの再試行に任せる
@injectable()
export class ProductEntryLossHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly store: YearEntryStore,
    @inject(PAYMENTS_TYPES.OpenCheckoutExpirer)
    private readonly expirer: OpenCheckoutExpirer,
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryFollowUp)
    private readonly followUp: YearEntryFollowUp,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const now = this.clock.now();
    await this.store.forfeitByProduct(event.productId, now);
    const launchIds = await this.store.listLaunchIdsByProduct(event.productId);
    const remaining = await this.expireOpenCheckouts(
      event.ownerUserId,
      launchIds,
    );
    await this.followUpPendingEntries(launchIds, now);
    return remaining ? CONTINUE : DONE;
  }

  // 参加費の購入はローンチを対象にするため、枠のローンチごとに失効させ、投稿者の他のプロダクトの決済は残す
  private async expireOpenCheckouts(
    ownerUserId: string,
    launchIds: readonly string[],
  ): Promise<boolean> {
    let remaining = false;
    for (const launchId of launchIds) {
      const result = await this.expirer.expireOpen({
        userId: ownerUserId,
        kinds: ['year_tournament_entry'],
        targetId: launchId,
        limit: OPEN_CHECKOUT_EXPIRY_LIMIT,
      });
      remaining ||= result.remaining;
    }
    return remaining;
  }

  private async followUpPendingEntries(
    launchIds: readonly string[],
    now: Date,
  ): Promise<void> {
    const entries = await this.store.findByLaunches(launchIds);
    const entryIds = [...entries.values()]
      .filter(isPendingFollowUp)
      .map(({ entryId }) => entryId);
    if (entryIds.length > 0) {
      await this.followUp.process(entryIds, now);
    }
  }
}
