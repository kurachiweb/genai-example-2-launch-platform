import { inject, injectable } from 'inversify';

import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaQuarantine } from '../../../lib/core/media/ports.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import { EVENT_PRODUCT_TYPES } from './event-product-types.ts';
import type { ProductPurgeStore } from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'product', 'lifecycle']);

// 画像を呼び出しのたびにD1から求め直し、理由の追加・取り除きは既にある状態に対して何も変えないため、再試行・送り直しで同じイベントを何度処理しても結果が変わらない。ユーザー停止などの他の理由を持つ画像は非公開化の理由だけを外すので隔離のまま残る。移動の依頼の送信の失敗は捕まえずに投げ、メッセージの再試行に任せる
@injectable()
export class ProductImageQuarantineHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_PRODUCT_TYPES.ProductPurgeStore)
    private readonly purgeStore: ProductPurgeStore,
    @inject(MEDIA_TYPES.MediaQuarantine)
    private readonly quarantine: MediaQuarantine,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    if (event.type !== 'hidden' && event.type !== 'unhidden') {
      logger.warn(
        '非公開化・復元以外のプロダクトライフサイクルイベントのため画像の隔離を変えずに終えました',
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
    if (event.type === 'hidden') {
      await this.quarantine.addReason(fileIds, 'product_hidden');
    } else {
      await this.quarantine.removeReason(fileIds, 'product_hidden');
    }
    return DONE;
  }
}
