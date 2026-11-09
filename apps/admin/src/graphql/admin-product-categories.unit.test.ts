import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminProductCategoriesQueryOptions,
  invalidateProductCategoryQueries,
  toAdminProductCategoryItems,
  toCategoryFormError,
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

describe('toCategoryFormError', () => {
  test('入力の引数の下の欄の詳細を、カテゴリの編集部品の入力欄の名前へ写し、コードと文言と元の例外を保つ', () => {
    const original = new GraphQLClientError({
      code: 'product_category_name_taken',
      message: 'このカテゴリ名は既に使われています。',
      status: 409,
      details: [
        {
          field: 'input.name',
          code: 'unavailable',
          message: 'このカテゴリ名は既に使われています。',
        },
        { field: 'reason', code: 'too_long', message: '理由が長すぎます。' },
      ],
    });

    const mapped = toCategoryFormError(original);

    expect(mapped).toBeInstanceOf(GraphQLClientError);
    expect(mapped).toMatchObject({
      code: 'product_category_name_taken',
      message: 'このカテゴリ名は既に使われています。',
      status: 409,
      expected: true,
      cause: original,
      details: [
        {
          field: 'name',
          code: 'unavailable',
          message: 'このカテゴリ名は既に使われています。',
        },
        { field: 'reason', code: 'too_long', message: '理由が長すぎます。' },
      ],
    });
  });

  test('欄の詳細の無いGraphQLの失敗とGraphQLの失敗でない例外は、そのまま返す', () => {
    const rejected = new GraphQLClientError({
      code: 'product_category_in_use',
      message: '紐付いています。',
      status: 409,
    });
    const unexpected = new TypeError('壊れた応答');

    expect(toCategoryFormError(rejected)).toBe(rejected);
    expect(toCategoryFormError(unexpected)).toBe(unexpected);
  });
});
