import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../../lib/core/messaging/contracts/product.ts';
import type { ProductLifecycleEvent } from '../../../../lib/core/product/product-lifecycle.ts';
import type { ProductMessagePublisher } from '../ports.ts';

export const HOUR_MS = 3_600_000;

export const DAY_MS = 24 * HOUR_MS;

export const jobLogger = getAppLogger(['api', 'application', 'product']);

export class ProductDailyJobError extends Error {
  override readonly name = 'ProductDailyJobError';
}

export interface LimitedBatch<T> {
  readonly targets: readonly T[];
  readonly hasMore: boolean;
}

// 残りの有無を知るために上限より1件多く照会し、先頭の上限件数だけを扱う
export async function limitedBatch<T>(
  limit: number,
  find: (limit: number) => Promise<readonly T[]>,
): Promise<LimitedBatch<T>> {
  const candidates = await find(limit + 1);
  return {
    targets: candidates.slice(0, limit),
    hasMore: candidates.length > limit,
  };
}

// 1件の失敗で残りを止めず、失敗を記録してfalseを返す。失敗したイベントはpendingのまま残り翌日の送り直しが拾う
export async function publishLifecycleEvent(
  publisher: ProductMessagePublisher,
  event: ProductLifecycleEvent,
  failureMessage: string,
  errors: unknown[],
): Promise<boolean> {
  try {
    await publisher.publish(RUN_PRODUCT_LIFECYCLE_MESSAGE, {
      eventId: event.id,
    });
    return true;
  } catch (error: unknown) {
    jobLogger.error(failureMessage, {
      error,
      eventId: event.id,
      productId: event.productId,
    });
    errors.push(error);
    return false;
  }
}

// 失敗はまとめて1件の例外にし、ディスパッチャからエラートラッキングへ送らせる
export function throwIfFailed(
  errors: readonly unknown[],
  message: string,
): void {
  if (errors.length > 0) {
    throw new ProductDailyJobError(message, { cause: errors[0] });
  }
}
