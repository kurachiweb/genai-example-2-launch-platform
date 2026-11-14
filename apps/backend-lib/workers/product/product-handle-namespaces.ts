import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { productPreviousHandles } from '../../../db/schema/product/product-previous-handles.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  PRODUCT_CATEGORY_HANDLE_RULE,
  PRODUCT_HANDLE_RULE,
} from '../../../common-lib/product/product-input-rules.ts';
import {
  defineHandleNamespace,
  type HandleNamespace,
} from '../handles/handle-namespace.ts';

export const PRODUCT_HANDLE_NAMESPACE: HandleNamespace = defineHandleNamespace({
  name: 'product',
  rule: PRODUCT_HANDLE_RULE,
  current: {
    table: products,
    ownerId: products.id,
    handle: products.handle,
    activeCondition: notDeleted(products.deletedAt),
  },
  previous: {
    table: productPreviousHandles,
    ownerId: productPreviousHandles.ownerId,
    handle: productPreviousHandles.handle,
    deletedAt: productPreviousHandles.deletedAt,
  },
});

export const PRODUCT_CATEGORY_HANDLE_NAMESPACE: HandleNamespace =
  defineHandleNamespace({
    name: 'product-category',
    rule: PRODUCT_CATEGORY_HANDLE_RULE,
    current: {
      table: productCategories,
      ownerId: productCategories.id,
      handle: productCategories.handle,
    },
  });
