import { describe, expect, test } from 'bun:test';

import {
  checkHandleFormat,
  isReservedHandle,
} from '../handles/handle-rules.ts';
import { checkCategoryName } from '../admin/admin-input-rules.ts';
import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from './product-category-constants.ts';
import { PRODUCT_CATEGORY_HANDLE_RULE } from './product-input-rules.ts';

describe('標準カテゴリ', () => {
  test('初期データの固定のULID・名前「その他」・ハンドルotherを持つ', () => {
    expect({
      PRODUCT_CATEGORY_OTHER_ID,
      PRODUCT_CATEGORY_OTHER_NAME,
      PRODUCT_CATEGORY_OTHER_HANDLE,
    }).toEqual({
      PRODUCT_CATEGORY_OTHER_ID: '01JD0000000000000000000000',
      PRODUCT_CATEGORY_OTHER_NAME: 'その他',
      PRODUCT_CATEGORY_OTHER_HANDLE: 'other',
    });
  });

  test('名前とハンドルはカテゴリの入力規則を満たす', () => {
    expect(checkCategoryName(PRODUCT_CATEGORY_OTHER_NAME)).toBeUndefined();
    expect(
      checkHandleFormat(
        PRODUCT_CATEGORY_OTHER_HANDLE,
        PRODUCT_CATEGORY_HANDLE_RULE,
      ),
    ).toBe('ok');
    expect(
      isReservedHandle(
        PRODUCT_CATEGORY_OTHER_HANDLE,
        PRODUCT_CATEGORY_HANDLE_RULE,
      ),
    ).toBe(false);
  });
});
