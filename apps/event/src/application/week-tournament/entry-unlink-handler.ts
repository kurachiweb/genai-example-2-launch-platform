import { inject, injectable } from 'inversify';

import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type { WeekTournamentStore } from '../../../lib/core/week-tournament/ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// 枠と参加者のproduct_id・launch_id・owner_user_idがプロダクト・ローンチ・利用者を外部キーで参照するため、プロダクトの物理削除より前に紐付けを外す。
// 紐付けの残る行だけを書き換え・削除するため、再試行・送り直しで同じイベントを何度処理しても結果が変わらない
@injectable()
export class EntryUnlinkHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    await this.store.unlinkOrDeleteByProduct(event.productId);
    await this.brackets.unlinkProduct(event.productId);
    return DONE;
  }
}
