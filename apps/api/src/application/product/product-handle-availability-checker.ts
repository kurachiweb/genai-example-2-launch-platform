import { inject, injectable } from 'inversify';

import {
  checkHandleFormat,
  isReservedHandle,
  isSameHandle,
} from '../../../common-lib/handles/handle-rules.ts';
import { PRODUCT_HANDLE_RULE } from '../../../common-lib/product/product-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { ProductStore } from './ports.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export type ProductHandleAvailability = 'available' | 'unavailable' | 'invalid';

export interface ProductHandleAvailabilityChecker {
  // productHandleは編集中のプロダクトの現在のハンドルで、登録ではundefined
  check(
    user: CurrentUser,
    handle: string,
    productHandle: string | undefined,
  ): Promise<ProductHandleAvailability>;
}

// 他のプロダクトの旧ハンドルは、保存の一括の書き込みで元の保持者から解放するため使用中に数えない
@injectable()
export class StoreProductHandleAvailabilityChecker implements ProductHandleAvailabilityChecker {
  constructor(
    @inject(PRODUCT_TYPES.ProductStore) private readonly store: ProductStore,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async check(
    user: CurrentUser,
    handle: string,
    productHandle: string | undefined,
  ): Promise<ProductHandleAvailability> {
    if (checkHandleFormat(handle, PRODUCT_HANDLE_RULE) !== 'ok') {
      return 'invalid';
    }
    const editing =
      productHandle === undefined
        ? undefined
        : await this.store.findForOwner(
            user.user.id,
            productHandle,
            this.clock.now(),
          );
    if (
      editing !== undefined &&
      [editing.handle, editing.previousHandle].some(
        (own) => own !== null && isSameHandle(own, handle),
      )
    ) {
      return 'available';
    }
    if (isReservedHandle(handle, PRODUCT_HANDLE_RULE)) {
      return 'unavailable';
    }
    const occupied = await this.store.isHandleOccupied(
      handle,
      editing?.productId,
    );
    return occupied ? 'unavailable' : 'available';
  }
}
