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
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekEntryFollowUp,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { followUpPendingEntries } from './follow-up-pending-entries.ts';

const OPEN_CHECKOUT_EXPIRY_LIMIT = 50;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 喪失はこの呼び出しで書き換えた枠しか返さず、再試行・続きの呼び出しでは0件になるため、失効の対象のローンチは毎回プロダクトの枠から求め直す。
// 喪失は凍結前の受付中・資格を得た枠だけを書き換え、失効は残りの未完了の決済を毎回選び直し、返金の依頼は枠ごとの依頼キーで重複を除かれるため、
// 再試行・送り直し・続きの再開で同じイベントを何度処理してもよい。凍結の後に届いた削除は喪失が0件になり、組み合わせ決定の分類で喪失にした枠の返金待ちを処理する。
// 失敗は捕まえずに投げ、イベントの再試行に任せる
@injectable()
export class ProductEntryLossHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(PAYMENTS_TYPES.OpenCheckoutExpirer)
    private readonly expirer: OpenCheckoutExpirer,
    @inject(WEEK_TOURNAMENT_TYPES.WeekEntryFollowUp)
    private readonly followUp: WeekEntryFollowUp,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const now = this.clock.now();
    await this.store.forfeitByProduct(event.productId, 'deleted', now);
    const remaining = await this.expireOpenCheckouts(event);
    await followUpPendingEntries(
      this.store,
      this.followUp,
      { productId: event.productId },
      now,
    );
    return remaining ? CONTINUE : DONE;
  }

  // 参加費の購入はローンチを対象にするため、プロダクトのローンチごとに失効させ、投稿者の他のプロダクトの決済は残す
  private async expireOpenCheckouts({
    productId,
    ownerUserId,
  }: ProductLifecycleEvent): Promise<boolean> {
    let remaining = false;
    for (const launchId of await this.store.listLaunchIdsByProduct(productId)) {
      const result = await this.expirer.expireOpen({
        userId: ownerUserId,
        kinds: ['week_tournament_entry'],
        targetId: launchId,
        limit: OPEN_CHECKOUT_EXPIRY_LIMIT,
      });
      remaining ||= result.remaining;
    }
    return remaining;
  }
}
