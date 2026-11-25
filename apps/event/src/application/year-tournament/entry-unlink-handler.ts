import { inject, injectable } from 'inversify';

import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type { YearEntryStore } from '../../../lib/core/year-tournament/ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// 枠のproduct_id・launch_id・owner_user_idがプロダクト・ローンチ・利用者を外部キーで参照するため、プロダクトの物理削除より前に紐付けを外す。
// ブラケットの参加者の紐付けはWeekトーナメントの物理削除の処理が種類によらず外す。
// 紐付けの残る行だけを書き換え・削除するため、再試行・送り直しで同じイベントを何度処理しても結果が変わらない
@injectable()
export class EntryUnlinkHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly store: YearEntryStore,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    await this.store.unlinkOrDeleteByProduct(event.productId);
    return DONE;
  }
}
