import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { HELP_CATEGORY_OTHER_ID } from '../../common-lib/help/help-category-constants.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminHelpCategoriesQueryOptions,
  invalidateHelpCategoryQueries,
  toHelpCategories,
  toHelpCategoryEntries,
} from './admin-help-categories.ts';
import {
  AdminHelpArticleDocument,
  AdminHelpArticlesDocument,
  AdminHelpCategoriesDocument,
  type AdminHelpCategoriesQuery,
  AdminViewerDocument,
} from './generated/graphql.ts';

const USAGE_ID = '01JD0HCAT00000000000000001';
const PRICING_ID = '01JD0HCAT00000000000000002';

const CATEGORIES: AdminHelpCategoriesQuery = {
  adminHelpCategories: [
    {
      id: PRICING_ID,
      name: '料金',
      systemDefault: false,
      sortOrder: 1,
      articleCount: 2,
    },
    {
      id: HELP_CATEGORY_OTHER_ID,
      name: 'その他',
      systemDefault: true,
      sortOrder: 2,
      articleCount: 0,
    },
    {
      id: USAGE_ID,
      name: '使い方',
      systemDefault: false,
      sortOrder: 3,
      articleCount: 5,
    },
  ],
};

describe('toHelpCategories', () => {
  test('APIが返した管理者の指定の並び順のまま表示用の値にする', () => {
    expect(toHelpCategories(CATEGORIES)).toStrictEqual([
      {
        id: PRICING_ID,
        name: '料金',
        systemDefault: false,
        sortOrder: 1,
        articleCount: 2,
      },
      {
        id: HELP_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
        sortOrder: 2,
        articleCount: 0,
      },
      {
        id: USAGE_ID,
        name: '使い方',
        systemDefault: false,
        sortOrder: 3,
        articleCount: 5,
      },
    ]);
  });
});

describe('toHelpCategoryEntries', () => {
  test('APIの順のままCategoryMasterEditorの項目にし、紐付く記事の件数をIDごとに引けるようにする', () => {
    const entries = toHelpCategoryEntries(CATEGORIES);

    expect(entries.items).toStrictEqual([
      { id: PRICING_ID, name: '料金', systemDefault: false },
      { id: HELP_CATEGORY_OTHER_ID, name: 'その他', systemDefault: true },
      { id: USAGE_ID, name: '使い方', systemDefault: false },
    ]);
    expect(entries.articleCounts.get(PRICING_ID)).toBe(2);
    expect(entries.articleCounts.get(HELP_CATEGORY_OTHER_ID)).toBe(0);
    expect(entries.articleCounts.get(USAGE_ID)).toBe(5);
  });
});

describe('invalidateHelpCategoryQueries', () => {
  test('カテゴリの一覧と、カテゴリ名と紐付けを表す記事の一覧・1件の取得を無効にし、他の取得は残す', async () => {
    const queryClient = new QueryClient();
    const keys = [
      adminHelpCategoriesQueryOptions().queryKey,
      [documentIdOf(AdminHelpArticlesDocument), {}],
      [documentIdOf(AdminHelpArticleDocument), { id: 'article' }],
    ];
    const viewerKey = [documentIdOf(AdminViewerDocument), {}];
    for (const key of [...keys, viewerKey]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateHelpCategoryQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(viewerKey)?.isInvalidated).toBe(false);
    expect(adminHelpCategoriesQueryOptions().queryKey[0]).toBe(
      documentIdOf(AdminHelpCategoriesDocument),
    );
  });
});
