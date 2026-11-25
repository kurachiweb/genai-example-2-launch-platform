import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type {
  MyProductsPage,
  MyProductsReader,
} from '../product/my-products-reader.ts';
import type { MyProductView } from '../product/ports.ts';
import type { ProductDescriptionEditor } from '../product/product-description-editor.ts';
import { productError } from '../product/product-errors.ts';
import { PRODUCT_TYPES } from '../product/product-types.ts';

export const OWN_PRODUCT_PAGE_SIZE = 20;

export interface OwnProductDescriptionUpdate {
  readonly productHandle: string;
  readonly descriptionMarkdown: string;
}

export interface OwnProductDescriptionService {
  // 並びは上流の取り消しを含む最新のローンチ日の降順のまま。不正なカーソルは上流のinvalid_cursorのまま返す
  list(
    user: CurrentUser,
    page: { readonly after: string | undefined },
  ): Promise<MyProductsPage>;
  update(
    user: CurrentUser,
    input: OwnProductDescriptionUpdate,
  ): Promise<MyProductView>;
}

// 本人のプロダクトだけを引くため、旧ハンドルは公開範囲の判定なしに現在のハンドルで読み直せる
async function findOwnProduct(
  reader: MyProductsReader,
  user: CurrentUser,
  handle: string,
): Promise<MyProductView> {
  const lookup = await reader.find(user, handle);
  const resolved =
    lookup.kind === 'redirect'
      ? await reader.find(user, lookup.handle)
      : lookup;
  if (resolved.kind !== 'product') {
    throw productError('product_not_found');
  }
  return resolved.product;
}

// 説明文の保存は書き込みの時点でも非公開化・削除・停止を拒否するため、事前の判定の後の変化はその誤りを変えずに返す
@injectable()
export class EditorOwnProductDescriptionService implements OwnProductDescriptionService {
  constructor(
    @inject(PRODUCT_TYPES.MyProductsReader)
    private readonly reader: MyProductsReader,
    @inject(PRODUCT_TYPES.ProductDescriptionEditor)
    private readonly editor: ProductDescriptionEditor,
  ) {}

  list(
    user: CurrentUser,
    page: { readonly after: string | undefined },
  ): Promise<MyProductsPage> {
    return this.reader.list(user, {
      first: OWN_PRODUCT_PAGE_SIZE,
      after: page.after,
    });
  }

  async update(
    user: CurrentUser,
    input: OwnProductDescriptionUpdate,
  ): Promise<MyProductView> {
    const product = await findOwnProduct(
      this.reader,
      user,
      input.productHandle,
    );
    if (product.hidden) {
      throw productError('product_hidden');
    }
    // 説明文の保存は現在のハンドルでだけ引くため、旧ハンドルを解決した後のハンドルを渡す
    await this.editor.update(user, {
      productHandle: product.handle,
      descriptionMarkdown: input.descriptionMarkdown,
    });
    return findOwnProduct(this.reader, user, product.handle);
  }
}
