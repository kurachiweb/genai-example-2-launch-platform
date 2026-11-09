import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/product.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { ProductMessagePublisher } from './ports.ts';

const logger = getAppLogger(['api', 'application', 'product']);

// 送信の失敗はイベントがpendingのまま残り日次の送り直しが送るため、確定済みの操作を失敗させない
export async function dispatchProductLifecycleEvent(
  publisher: ProductMessagePublisher,
  event: ProductLifecycleEvent,
): Promise<void> {
  try {
    await publisher.publish(RUN_PRODUCT_LIFECYCLE_MESSAGE, {
      eventId: event.id,
    });
  } catch (error: unknown) {
    logger.error(
      'プロダクトライフサイクルイベントの送信を要求できませんでした',
      { error, eventId: event.id, productId: event.productId },
    );
  }
}
