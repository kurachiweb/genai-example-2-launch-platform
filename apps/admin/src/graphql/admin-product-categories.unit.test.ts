import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminProductCategoriesQueryOptions,
  invalidateProductCategoryQueries,
  toAdminProductCategoryItems,
} from './admin-product-categories.ts';
import {
  AdminInquiryCategoriesDocument,
  AdminProductCategoriesDocument,
  AdminViewerDocument,
} from './generated/graphql.ts';

const TOOLS_ID = '01JD0CATEGRY0000000000000A';
const OTHER_ID = '01JD0000000000000000000000';

describe('toAdminProductCategoryItems', () => {
  test('APIの順のままハンドルと標準カテゴリの印を持つCategoryMasterEditorの項目にする', () => {
    expect(
      toAdminProductCategoryItems({
        adminProductCategories: [
          {
            id: TOOLS_ID,
            name: '開発ツール',
            handle: 'dev-tools',
            systemDefault: false,
          },
          {
            id: OTHER_ID,
            name: 'その他',
            handle: 'other',
            systemDefault: true,
          },
        ],
      }),
    ).toStrictEqual([
      {
        id: TOOLS_ID,
        name: '開発ツール',
        handle: 'dev-tools',
        systemDefault: false,
      },
      { id: OTHER_ID, name: 'その他', handle: 'other', systemDefault: true },
    ]);
  });
});

describe('invalidateProductCategoryQueries', () => {
  test('プロダクトカテゴリの一覧の取得を無効にし、他の取得は残す', async () => {
    const queryClient = new QueryClient();
    const categoriesKey = adminProductCategoriesQueryOptions().queryKey;
    const otherKeys = [
      [documentIdOf(AdminInquiryCategoriesDocument), {}],
      [documentIdOf(AdminViewerDocument), {}],
    ];
    for (const key of [categoriesKey, ...otherKeys]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateProductCategoryQueries(queryClient);

    expect(queryClient.getQueryState(categoriesKey)?.isInvalidated).toBe(true);
    for (const key of otherKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
    expect(categoriesKey[0]).toBe(documentIdOf(AdminProductCategoriesDocument));
  });
});
