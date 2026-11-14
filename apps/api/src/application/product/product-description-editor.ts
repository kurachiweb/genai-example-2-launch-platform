import { inject, injectable } from 'inversify';

import { PRODUCT_DESCRIPTION_RULE } from '../../../common-lib/product/product-input-rules.ts';
import { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AppError } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { ProductDescriptionUpdateResult, ProductStore } from './ports.ts';
import {
  productDescriptionRejectedError,
  productError,
} from './product-errors.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export interface ProductDescriptionUpdateRequest {
  readonly productHandle: string;
  readonly descriptionMarkdown: string;
}

export interface ProductDescriptionEditor {
  update(
    user: CurrentUser,
    input: ProductDescriptionUpdateRequest,
  ): Promise<void>;
}

const UPDATE_FAILURES: Readonly<
  Record<Exclude<ProductDescriptionUpdateResult, 'saved'>, () => AppError>
> = Object.freeze({
  hidden: () => productError('product_hidden'),
  'not-found': () => productError('product_not_found'),
  'account-unavailable': () => productError('account_unavailable'),
});

// 公開APIの経路から呼ばれる。bot対策と利用者の状態の事前の確認は経路が行い、非公開化は書き込みの時点のストアの条件で拒否する
@injectable()
export class StoreProductDescriptionEditor implements ProductDescriptionEditor {
  constructor(
    @inject(PRODUCT_TYPES.ProductStore) private readonly store: ProductStore,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async update(
    user: CurrentUser,
    input: ProductDescriptionUpdateRequest,
  ): Promise<void> {
    const now = this.clock.now();
    const snapshot = await this.store.findForOwner(
      user.user.id,
      input.productHandle,
      now,
    );
    if (snapshot === undefined) {
      throw productError('product_not_found');
    }
    const checked = markdownTextSchema(PRODUCT_DESCRIPTION_RULE).safeParse(
      input.descriptionMarkdown,
    );
    if (!checked.success) {
      const [issue] = checked.error.issues;
      throw productDescriptionRejectedError(issue?.message ?? '');
    }
    const result = await this.store.updateDescription({
      productId: snapshot.productId,
      descriptionMarkdown: checked.data,
      now,
    });
    if (result !== 'saved') {
      throw UPDATE_FAILURES[result]();
    }
  }
}
