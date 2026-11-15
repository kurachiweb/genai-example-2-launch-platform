import { describe, expect, test } from 'vitest';

import { HELP_CATEGORY_OTHER_ID } from '../../../../../common-lib/help/help-category-constants.ts';
import { HELP_REORDER_MAX } from '../../../../../common-lib/help/help-input-rules.ts';
import {
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpCategory,
} from '../../../../../lib/workers/help/testing/help-fixtures.ts';
import {
  ADMIN_HELP_ARTICLE,
  ADMIN_HELP_ARTICLES,
  CREATE_HELP_ARTICLE,
  DELETE_HELP_ARTICLE,
  HELP_ARTICLE_HANDLE_AVAILABILITY,
  REORDER_HELP_ARTICLES,
  UPDATE_HELP_ARTICLE,
} from '../../../../../test/support/help-article-graphql-documents.ts';
import {
  helpArticleFieldsOf,
  readHelpArticleRows,
  reorderHelpArticles,
} from '../../../../../test/support/help-article-graphql-operations.ts';
import {
  asHelpAdmin,
  codesOf,
  CREATE_HELP_CATEGORY,
  DELETE_HELP_CATEGORY,
  detailsOf,
  HELP_ADMINS,
  helpAdminGateway,
  installHelpAdminGraphQLTest,
  readHelpCategoryRows,
  RENAME_HELP_CATEGORY,
  REORDER_HELP_CATEGORIES,
} from '../../../../../test/support/help-graphql-operations.ts';
import { readAuditLogSummaries } from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

installHelpAdminGraphQLTest();

const { moderator, viewer } = HELP_ADMINS;

const ORDER_OUTDATED_MESSAGE =
  '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。';

// カテゴリ1に、ピン留めの記事1と、ピン留めでない記事2・3を並び順の順に置く
async function seedCategoryArticles(): Promise<void> {
  await insertHelpCategory(1, { name: '使い方' });
  await insertHelpArticle(1, {
    categoryId: helpCategoryIdOf(1),
    pinned: true,
    sortOrder: 1,
  });
  await insertHelpArticle(2, { categoryId: helpCategoryIdOf(1), sortOrder: 2 });
  await insertHelpArticle(3, { categoryId: helpCategoryIdOf(1), sortOrder: 3 });
  await insertHelpArticle(4, { sortOrder: 1 });
}

describe('reorderHelpArticles', () => {
  test('モデレーターがカテゴリの全記事を並べ替えると、並べ替えた後のカテゴリの記事をピン留めの群から順に返し、版を変えない', async () => {
    await seedCategoryArticles();

    const response = await reorderHelpArticles(
      {
        categoryId: helpCategoryIdOf(1),
        orderedIds: [
          helpArticleIdOf(1),
          helpArticleIdOf(3),
          helpArticleIdOf(2),
        ],
      },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.reorderHelpArticles?.map(
        ({ id, sortOrder, pinned, creator }) => ({
          id,
          sortOrder,
          pinned,
          creator,
        }),
      ),
    ).toEqual([
      { id: helpArticleIdOf(1), sortOrder: 1, pinned: true, creator: null },
      { id: helpArticleIdOf(3), sortOrder: 2, pinned: false, creator: null },
      { id: helpArticleIdOf(2), sortOrder: 3, pinned: false, creator: null },
    ]);
    expect(
      (await readHelpArticleRows()).map(({ id, sortOrder, revision }) => ({
        id,
        sortOrder,
        revision,
      })),
    ).toEqual([
      { id: helpArticleIdOf(1), sortOrder: 1, revision: 1 },
      { id: helpArticleIdOf(2), sortOrder: 3, revision: 1 },
      { id: helpArticleIdOf(3), sortOrder: 2, revision: 1 },
      { id: helpArticleIdOf(4), sortOrder: 1, revision: 1 },
    ]);
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        action: 'help-article.reorder',
        detail: { count: '3' },
      }),
    ]);
  });

  test('閲覧のみの管理者の並べ替えをforbiddenで拒否し、並びを変えない', async () => {
    await seedCategoryArticles();
    const before = await readHelpArticleRows();

    const response = await reorderHelpArticles(
      {
        categoryId: helpCategoryIdOf(1),
        orderedIds: [
          helpArticleIdOf(1),
          helpArticleIdOf(3),
          helpArticleIdOf(2),
        ],
      },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpArticleRows()).toEqual(before);
  });

  test.each([
    {
      label: '並びを表示した後に追加された記事を含まない並び',
      categoryId: helpCategoryIdOf(1),
      orderedIds: [helpArticleIdOf(1), helpArticleIdOf(2)],
    },
    {
      label: '他のカテゴリへ移動した記事を含む並び',
      categoryId: helpCategoryIdOf(1),
      orderedIds: [
        helpArticleIdOf(1),
        helpArticleIdOf(2),
        helpArticleIdOf(3),
        helpArticleIdOf(4),
      ],
    },
    {
      label: '削除されたカテゴリの並び',
      categoryId: helpCategoryIdOf(99),
      orderedIds: [helpArticleIdOf(1)],
    },
  ])(
    '$labelの保存をhelp_order_outdatedで拒否し、並びを変えない',
    async ({ categoryId, orderedIds }) => {
      await seedCategoryArticles();
      const before = await readHelpArticleRows();

      const response = await reorderHelpArticles(
        { categoryId, orderedIds },
        asHelpAdmin(moderator),
      );

      expect(codesOf(response)).toEqual(['help_order_outdated']);
      expect(response.errors?.[0]?.message).toBe(ORDER_OUTDATED_MESSAGE);
      expect(await readHelpArticleRows()).toEqual(before);
      expect(await readAuditLogSummaries()).toEqual([]);
    },
  );

  test.each([
    {
      label: '空の並び',
      orderedIds: [],
      field: 'orderedIds',
      code: 'too_small',
    },
    {
      label: '同じIDを2回含む並び',
      orderedIds: [helpArticleIdOf(1), helpArticleIdOf(1)],
      field: 'orderedIds',
      code: 'custom',
    },
    {
      label: `${String(HELP_REORDER_MAX + 1)}件の並び`,
      orderedIds: Array.from({ length: HELP_REORDER_MAX + 1 }, (_, index) =>
        helpArticleIdOf(index + 1),
      ),
      field: 'orderedIds',
      code: 'too_big',
    },
    {
      label: '65文字のIDを含む並び',
      orderedIds: [helpArticleIdOf(1), 'x'.repeat(65)],
      field: 'orderedIds.1',
      code: 'too_big',
    },
  ])(
    '$labelを並びの欄の検証のエラーで拒否する',
    async ({ orderedIds, field, code }) => {
      const response = await reorderHelpArticles(
        { categoryId: helpCategoryIdOf(1), orderedIds },
        asHelpAdmin(moderator),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        { field, code, message: ORDER_OUTDATED_MESSAGE },
      ]);
      expect(await readAuditLogSummaries()).toEqual([]);
    },
  );

  test('65文字のカテゴリのIDをカテゴリの欄の検証のエラーで拒否する', async () => {
    const response = await reorderHelpArticles(
      { categoryId: 'x'.repeat(65), orderedIds: [helpArticleIdOf(1)] },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      { field: 'categoryId', code: 'too_big', message: ORDER_OUTDATED_MESSAGE },
    ]);
  });
});

// 入力の検証が先に走れば`validation_error`になる不正な入力で、呼び出し元とログインの確認が先に拒否することを確かめる
const INVALID_FIELDS = helpArticleFieldsOf({ title: '' });

const ARTICLE_QUERIES = [
  { name: 'adminHelpArticles', document: ADMIN_HELP_ARTICLES, variables: {} },
  {
    name: 'adminHelpArticle',
    document: ADMIN_HELP_ARTICLE,
    variables: { id: 'x'.repeat(65) },
  },
  {
    name: 'helpArticleHandleAvailability',
    document: HELP_ARTICLE_HANDLE_AVAILABILITY,
    variables: { handle: 'a'.repeat(51) },
  },
] as const;

const ARTICLE_MUTATIONS = [
  {
    name: 'createHelpArticle',
    document: CREATE_HELP_ARTICLE,
    variables: { input: { fields: INVALID_FIELDS } },
  },
  {
    name: 'updateHelpArticle',
    document: UPDATE_HELP_ARTICLE,
    variables: {
      input: {
        id: helpArticleIdOf(1),
        expectedRevision: 1,
        fields: INVALID_FIELDS,
      },
    },
  },
  {
    name: 'deleteHelpArticle',
    document: DELETE_HELP_ARTICLE,
    variables: { id: 'x'.repeat(65) },
  },
  {
    name: 'reorderHelpArticles',
    document: REORDER_HELP_ARTICLES,
    variables: { categoryId: helpCategoryIdOf(1), orderedIds: [] },
  },
] as const;

describe('記事の照会と変更の呼び出し元', () => {
  test.each([...ARTICLE_QUERIES, ...ARTICLE_MUTATIONS])(
    '$nameは、モデレーターのセッションでも利用者側の呼び出し元からなら入力の検証より前にforbiddenで拒否する',
    async ({ name, document, variables }) => {
      await insertHelpArticle(1);

      const response = await helpAdminGateway.call(document, variables, {
        ...asHelpAdmin(moderator),
        caller: 'client',
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data?.[name] ?? null).toBeNull();
      expect(await readHelpArticleRows()).toHaveLength(1);
      expect(await readAuditLogSummaries()).toEqual([]);
    },
  );
});

// 入力の検証を通る入力で、ログインの確認がユースケースより前に拒否することを確かめる
const VALID_MUTATIONS = [
  {
    name: 'createHelpArticle',
    document: CREATE_HELP_ARTICLE,
    variables: { input: { fields: helpArticleFieldsOf() } },
  },
  {
    name: 'updateHelpArticle',
    document: UPDATE_HELP_ARTICLE,
    variables: {
      input: {
        id: helpArticleIdOf(1),
        expectedRevision: 1,
        fields: helpArticleFieldsOf(),
      },
    },
  },
  {
    name: 'deleteHelpArticle',
    document: DELETE_HELP_ARTICLE,
    variables: { id: helpArticleIdOf(1) },
  },
  {
    name: 'reorderHelpArticles',
    document: REORDER_HELP_ARTICLES,
    variables: {
      categoryId: HELP_CATEGORY_OTHER_ID,
      orderedIds: [helpArticleIdOf(1)],
    },
  },
  {
    name: 'createHelpCategory',
    document: CREATE_HELP_CATEGORY,
    variables: { name: '料金' },
  },
  {
    name: 'renameHelpCategory',
    document: RENAME_HELP_CATEGORY,
    variables: { id: HELP_CATEGORY_OTHER_ID, name: '料金' },
  },
  {
    name: 'deleteHelpCategory',
    document: DELETE_HELP_CATEGORY,
    variables: { id: HELP_CATEGORY_OTHER_ID },
  },
  {
    name: 'reorderHelpCategories',
    document: REORDER_HELP_CATEGORIES,
    variables: { orderedIds: [HELP_CATEGORY_OTHER_ID] },
  },
] as const;

describe('記事とカテゴリの変更のログイン', () => {
  test.each(VALID_MUTATIONS)(
    '$nameは、管理者のセッションが無ければunauthenticatedで拒否する',
    async ({ name, document, variables }) => {
      await insertHelpArticle(1);
      const before = await readHelpArticleRows();

      const response = await helpAdminGateway.call(document, variables, {
        caller: 'admin',
      });

      expect(codesOf(response)).toEqual(['unauthenticated']);
      expect(response.data?.[name] ?? null).toBeNull();
      expect(await readHelpArticleRows()).toEqual(before);
      expect(await readHelpCategoryRows()).toEqual([
        expect.objectContaining({ id: HELP_CATEGORY_OTHER_ID, name: 'その他' }),
      ]);
      expect(await readAuditLogSummaries()).toEqual([]);
    },
  );
});
