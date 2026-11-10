import { inject, injectable } from 'inversify';

import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import type { DirectoryEntryStore } from '../../../lib/core/directory/ports.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// directory_entriesのproduct_idがproductsを外部キーで参照するため、実行器がプロダクトの行を物理削除する前に記録を消す。
// 外部キーを持たない索引文書も同じ一括の書き込みで消し、プロダクトの物理削除の後に残さない。残る行だけを消すため、再試行・送り直しで同じイベントを何度処理しても結果が変わらない
@injectable()
export class EntryErasureHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore)
    private readonly entries: DirectoryEntryStore,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    await this.entries.erase(event.productId);
    return DONE;
  }
}
