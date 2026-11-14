import { inject, injectable } from 'inversify';

import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import { EVENT_PRODUCT_TYPES } from './event-product-types.ts';
import type { ProductPurgeStore } from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'product', 'lifecycle']);

// 画像を呼び出しのたびにD1から求め直すため、再試行で同じイベントを何度処理しても結果が変わらない。退会者の画像は利用者の物理削除の波及処理で先に消えていることがあり、存在しないIDは削除の件数に数えずに成功する
@injectable()
export class ProductImageErasureHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_PRODUCT_TYPES.ProductPurgeStore)
    private readonly purgeStore: ProductPurgeStore,
    @inject(MEDIA_TYPES.MediaFiles) private readonly files: MediaFiles,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    if (event.type !== 'purge_due') {
      logger.warn(
        '物理削除の時期の到来以外のプロダクトライフサイクルイベントのため画像を削除せずに終えました',
        {
          eventId: event.id,
          productId: event.productId,
          type: event.type,
          outcome: 'ignored',
        },
      );
      return DONE;
    }
    const fileIds = await this.purgeStore.imageFileIds(event.productId);
    if (fileIds === undefined) {
      return DONE;
    }
    await this.files.eraseNow(fileIds);
    return DONE;
  }
}
