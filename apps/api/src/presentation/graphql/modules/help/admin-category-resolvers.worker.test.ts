import { describe, expect, test } from 'vitest';

import { HELP_REORDER_MAX } from '../../../../../common-lib/help/help-input-rules.ts';
import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/help/help-category-constants.ts';
import {
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpCategory,
} from '../../../../../lib/workers/help/testing/help-fixtures.ts';
import {
  ADMIN_HELP_CATEGORIES,
  asHelpAdmin,
  codesOf,
  CREATE_HELP_CATEGORY,
  createHelpCategory,
  DELETE_HELP_CATEGORY,
  deleteHelpCategory,
  detailsOf,
  fetchAdminHelpCategories,
  HELP_ADMINS,
  helpAdminGateway,
  helpAdminIdOf,
  installHelpAdminGraphQLTest,
  readHelpArticleCategories,
  readHelpCategoryRows,
  RENAME_HELP_CATEGORY,
  renameHelpCategory,
  REORDER_HELP_CATEGORIES,
  reorderHelpCategories,
} from '../../../../../test/support/help-graphql-operations.ts';
import {
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

installHelpAdminGraphQLTest();

const { superAdmin, moderator, viewer } = HELP_ADMINS;

const ORDER_OUTDATED_MESSAGE =
  '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。';

const OTHER_CATEGORY = {
  id: HELP_CATEGORY_OTHER_ID,
  name: HELP_CATEGORY_OTHER_NAME,
  systemDefault: true,
  sortOrder: 1,
  articleCount: 0,
};

// 標準カテゴリ(並び順1)・カテゴリ2(並び順2)・カテゴリ1(並び順3)の順に並ぶ
async function seedTwoCategories(): Promise<void> {
  await insertHelpCategory(1, { name: '使い方', sortOrder: 3 });
  await insertHelpCategory(2, { name: 'Billing', sortOrder: 2 });
}

describe('adminHelpCategories', () => {
  test('閲覧のみの管理者に、下書きを含む記事の件数とともに並び順の順で返す', async () => {
    await seedTwoCategories();
    await insertHelpArticle(1, { categoryId: helpCategoryIdOf(1) });
    await insertHelpArticle(2, {
      categoryId: helpCategoryIdOf(1),
      status: 'draft',
    });

    const response = await fetchAdminHelpCategories(asHelpAdmin(viewer));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminHelpCategories).toEqual([
      OTHER_CATEGORY,
      {
        id: helpCategoryIdOf(2),
        name: 'Billing',
        systemDefault: false,
        sortOrder: 2,
        articleCount: 0,
      },
      {
        id: helpCategoryIdOf(1),
        name: '使い方',
        systemDefault: false,
        sortOrder: 3,
        articleCount: 2,
      },
    ]);
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchAdminHelpCategories({ caller: 'admin' });

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.data?.adminHelpCategories ?? null).toBeNull();
  });
});

describe('createHelpCategory', () => {
  test('最上位管理者とモデレーターは、前後の空白を除いた名前のカテゴリを並び順の末尾に追加でき、監査ログに記録される', async () => {
    await seedTwoCategories();

    const bySuperAdmin = await createHelpCategory(
      { name: ' 料金 ' },
      asHelpAdmin(superAdmin),
    );
    const byModerator = await createHelpCategory(
      { name: 'アカウント' },
      asHelpAdmin(moderator),
    );

    expect(bySuperAdmin.errors).toBeUndefined();
    expect(bySuperAdmin.data?.createHelpCategory).toEqual({
      id: expect.any(String) as string,
      name: '料金',
      systemDefault: false,
      sortOrder: 4,
      articleCount: 0,
    });
    expect(byModerator.errors).toBeUndefined();
    expect(byModerator.data?.createHelpCategory).toEqual(
      expect.objectContaining({ name: 'アカウント', sortOrder: 5 }),
    );
    expect(
      (await readAuditLogSummaries()).map(({ action, operatorAdminId }) => ({
        action,
        operatorAdminId,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          action: 'help-category.create',
          operatorAdminId: helpAdminIdOf(superAdmin),
        },
        {
          action: 'help-category.create',
          operatorAdminId: helpAdminIdOf(moderator),
        },
      ]),
    );
  });

  test('閲覧のみの管理者の追加をforbiddenで拒否し、追加しない', async () => {
    const response = await createHelpCategory(
      { name: '料金' },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpCategoryRows()).toHaveLength(1);
    expect(await readAuditLogSummaries()).toEqual([]);
  });

  test.each([
    {
      label: '空白だけの名前',
      name: '  ',
      code: 'empty',
      message: 'カテゴリ名を入力してください。',
    },
    {
      label: '31文字の名前',
      name: 'あ'.repeat(31),
      code: 'too-long',
      message: 'カテゴリ名は30文字以内で入力してください。',
    },
  ])(
    '$labelを名前の欄の検証のエラーで拒否する',
    async ({ name, code, message }) => {
      const response = await createHelpCategory(
        { name },
        asHelpAdmin(moderator),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([{ field: 'name', code, message }]);
      expect(await readHelpCategoryRows()).toHaveLength(1);
    },
  );

  test('30文字の名前を受け付ける', async () => {
    const response = await createHelpCategory(
      { name: 'あ'.repeat(30) },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.createHelpCategory?.name).toBe('あ'.repeat(30));
  });

  test('前後の空白と大文字小文字だけが異なる名前を、名前の欄の詳細を付けたhelp_category_name_takenで拒否する', async () => {
    await seedTwoCategories();

    const response = await createHelpCategory(
      { name: ' billing ' },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_category_name_taken']);
    expect(response.errors?.[0]?.message).toBe(
      '同じ名前のカテゴリが既にあります。',
    );
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'name', code: 'name-taken' }),
    ]);
    expect(await readHelpCategoryRows()).toHaveLength(3);
  });
});

describe('renameHelpCategory', () => {
  test('モデレーターがカテゴリの名前を変えると、変えた後のカテゴリを返し監査ログに記録される', async () => {
    await seedTwoCategories();

    const response = await renameHelpCategory(
      { id: helpCategoryIdOf(1), name: ' 基本の使い方 ' },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.renameHelpCategory).toEqual({
      id: helpCategoryIdOf(1),
      name: '基本の使い方',
      systemDefault: false,
      sortOrder: 3,
      articleCount: 0,
    });
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({ action: 'help-category.rename' }),
    ]);
    expect(await readAuditLogTargetIds()).toEqual([helpCategoryIdOf(1)]);
  });

  test('閲覧のみの管理者の名前の変更をforbiddenで拒否する', async () => {
    await seedTwoCategories();

    const response = await renameHelpCategory(
      { id: helpCategoryIdOf(1), name: '請求' },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpCategoryRows()).toContainEqual(
      expect.objectContaining({ id: helpCategoryIdOf(1), name: '使い方' }),
    );
  });

  test('他のカテゴリと同じ名前への変更をhelp_category_name_takenで拒否する', async () => {
    await seedTwoCategories();

    const response = await renameHelpCategory(
      { id: helpCategoryIdOf(1), name: 'BILLING' },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_category_name_taken']);
  });

  test('空の名前を名前の欄の検証のエラーで拒否する', async () => {
    await seedTwoCategories();

    const response = await renameHelpCategory(
      { id: helpCategoryIdOf(1), name: '' },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'name', code: 'empty' }),
    ]);
  });

  test('標準カテゴリの名前の変更をhelp_category_protectedで拒否する', async () => {
    const response = await renameHelpCategory(
      { id: HELP_CATEGORY_OTHER_ID, name: '雑談' },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_category_protected']);
    expect(response.errors?.[0]?.message).toBe(
      '標準カテゴリ「その他」は変更・削除できません。',
    );
    expect(await readHelpCategoryRows()).toEqual([
      expect.objectContaining({ name: HELP_CATEGORY_OTHER_NAME }),
    ]);
  });

  test('存在しないカテゴリの名前の変更をhelp_category_not_foundで拒否する', async () => {
    const response = await renameHelpCategory(
      { id: helpCategoryIdOf(99), name: '請求' },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_category_not_found']);
    expect(response.errors?.[0]?.message).toBe(
      'このカテゴリは削除されています。',
    );
  });
});

describe('カテゴリのIDの文字数', () => {
  test.each([
    {
      name: 'renameHelpCategory',
      call: () =>
        renameHelpCategory(
          { id: 'x'.repeat(65), name: '請求' },
          asHelpAdmin(moderator),
        ),
    },
    {
      name: 'deleteHelpCategory',
      call: () =>
        deleteHelpCategory({ id: 'x'.repeat(65) }, asHelpAdmin(moderator)),
    },
  ])('$nameは65文字のIDをIDの欄の検証のエラーで拒否する', async ({ call }) => {
    const response = await call();

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'id',
        code: 'too_big',
        message: 'このカテゴリは削除されています。',
      },
    ]);
    expect(await readAuditLogSummaries()).toEqual([]);
  });
});

describe('deleteHelpCategory', () => {
  test('モデレーターがカテゴリを削除すると、下書きを含む記事を標準カテゴリの末尾へ付け替え、付け替えた件数を返す', async () => {
    await seedTwoCategories();
    await insertHelpArticle(1, { sortOrder: 1 });
    await insertHelpArticle(2, {
      categoryId: helpCategoryIdOf(1),
      sortOrder: 2,
    });
    await insertHelpArticle(3, {
      categoryId: helpCategoryIdOf(1),
      status: 'draft',
      sortOrder: 1,
    });

    const response = await deleteHelpCategory(
      { id: helpCategoryIdOf(1) },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteHelpCategory).toEqual({
      id: helpCategoryIdOf(1),
      reassignedCount: 2,
    });
    expect(await readHelpArticleCategories()).toEqual([
      {
        id: helpArticleIdOf(1),
        categoryId: HELP_CATEGORY_OTHER_ID,
        sortOrder: 1,
      },
      {
        id: helpArticleIdOf(2),
        categoryId: HELP_CATEGORY_OTHER_ID,
        sortOrder: 3,
      },
      {
        id: helpArticleIdOf(3),
        categoryId: HELP_CATEGORY_OTHER_ID,
        sortOrder: 2,
      },
    ]);
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        action: 'help-category.delete',
        detail: { reassignedCount: '2' },
      }),
    ]);
  });

  test('閲覧のみの管理者の削除をforbiddenで拒否し、削除しない', async () => {
    await seedTwoCategories();

    const response = await deleteHelpCategory(
      { id: helpCategoryIdOf(1) },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpCategoryRows()).toHaveLength(3);
  });

  test('標準カテゴリの削除をhelp_category_protected、存在しないカテゴリの削除をhelp_category_not_foundで拒否する', async () => {
    const protectedDeletion = await deleteHelpCategory(
      { id: HELP_CATEGORY_OTHER_ID },
      asHelpAdmin(moderator),
    );
    const missingDeletion = await deleteHelpCategory(
      { id: helpCategoryIdOf(99) },
      asHelpAdmin(moderator),
    );

    expect(codesOf(protectedDeletion)).toEqual(['help_category_protected']);
    expect(codesOf(missingDeletion)).toEqual(['help_category_not_found']);
    expect(await readHelpCategoryRows()).toHaveLength(1);
  });
});

describe('reorderHelpCategories', () => {
  test('モデレーターは標準カテゴリを含む全カテゴリを並べ替えられ、並べ替えた後の一覧を返し監査ログに件数を記録する', async () => {
    await seedTwoCategories();

    const response = await reorderHelpCategories(
      {
        orderedIds: [
          helpCategoryIdOf(1),
          HELP_CATEGORY_OTHER_ID,
          helpCategoryIdOf(2),
        ],
      },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.reorderHelpCategories?.map(({ id, sortOrder }) => ({
        id,
        sortOrder,
      })),
    ).toEqual([
      { id: helpCategoryIdOf(1), sortOrder: 1 },
      { id: HELP_CATEGORY_OTHER_ID, sortOrder: 2 },
      { id: helpCategoryIdOf(2), sortOrder: 3 },
    ]);
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        action: 'help-category.reorder',
        detail: { count: '3' },
      }),
    ]);
  });

  test('閲覧のみの管理者の並べ替えをforbiddenで拒否し、並びを変えない', async () => {
    await seedTwoCategories();
    const before = await readHelpCategoryRows();

    const response = await reorderHelpCategories(
      {
        orderedIds: [
          helpCategoryIdOf(1),
          HELP_CATEGORY_OTHER_ID,
          helpCategoryIdOf(2),
        ],
      },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpCategoryRows()).toEqual(before);
  });

  test.each([
    {
      label: '並べ替えを始めた後に追加されたカテゴリを含まない並び',
      orderedIds: [helpCategoryIdOf(1), HELP_CATEGORY_OTHER_ID],
    },
    {
      label: '並べ替えを始めた後に削除されたカテゴリを含む並び',
      orderedIds: [
        helpCategoryIdOf(1),
        HELP_CATEGORY_OTHER_ID,
        helpCategoryIdOf(2),
        helpCategoryIdOf(3),
      ],
    },
  ])(
    '$labelの保存をhelp_order_outdatedで拒否し、並びを変えない',
    async ({ orderedIds }) => {
      await seedTwoCategories();
      const before = await readHelpCategoryRows();

      const response = await reorderHelpCategories(
        { orderedIds },
        asHelpAdmin(moderator),
      );

      expect(codesOf(response)).toEqual(['help_order_outdated']);
      expect(response.errors?.[0]?.message).toBe(ORDER_OUTDATED_MESSAGE);
      expect(await readHelpCategoryRows()).toEqual(before);
      expect(await readAuditLogSummaries()).toEqual([]);
    },
  );

  test.each([
    { label: '空の並び', orderedIds: [], code: 'too_small' },
    {
      label: '同じIDを2回含む並び',
      orderedIds: [HELP_CATEGORY_OTHER_ID, HELP_CATEGORY_OTHER_ID],
      code: 'custom',
    },
    {
      label: `${String(HELP_REORDER_MAX + 1)}件の並び`,
      orderedIds: Array.from({ length: HELP_REORDER_MAX + 1 }, (_, index) =>
        helpCategoryIdOf(index + 1),
      ),
      code: 'too_big',
    },
  ])(
    '$labelを並びの欄の検証のエラーで拒否する',
    async ({ orderedIds, code }) => {
      const response = await reorderHelpCategories(
        { orderedIds },
        asHelpAdmin(moderator),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        { field: 'orderedIds', code, message: ORDER_OUTDATED_MESSAGE },
      ]);
      expect(await readAuditLogSummaries()).toEqual([]);
    },
  );

  test('65文字のIDを含む並びを、その要素の欄の検証のエラーで拒否する', async () => {
    const response = await reorderHelpCategories(
      { orderedIds: [HELP_CATEGORY_OTHER_ID, 'x'.repeat(65)] },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'orderedIds.1',
        code: 'too_big',
        message: ORDER_OUTDATED_MESSAGE,
      },
    ]);
  });
});

// 入力の検証が先に走れば`validation_error`になる不正な入力で、呼び出し元の確認が先に拒否することを確かめる
const OPERATIONS = [
  {
    name: 'adminHelpCategories',
    document: ADMIN_HELP_CATEGORIES,
    variables: {},
  },
  {
    name: 'createHelpCategory',
    document: CREATE_HELP_CATEGORY,
    variables: { name: '' },
  },
  {
    name: 'renameHelpCategory',
    document: RENAME_HELP_CATEGORY,
    variables: { id: HELP_CATEGORY_OTHER_ID, name: '' },
  },
  {
    name: 'deleteHelpCategory',
    document: DELETE_HELP_CATEGORY,
    variables: { id: 'x'.repeat(65) },
  },
  {
    name: 'reorderHelpCategories',
    document: REORDER_HELP_CATEGORIES,
    variables: { orderedIds: [] },
  },
] as const;

describe('カテゴリの照会と変更の呼び出し元', () => {
  test.each(OPERATIONS)(
    '$nameは、モデレーターのセッションでも利用者側の呼び出し元からなら入力の検証より前にforbiddenで拒否する',
    async ({ name, document, variables }) => {
      const response = await helpAdminGateway.call(document, variables, {
        ...asHelpAdmin(moderator),
        caller: 'client',
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data?.[name] ?? null).toBeNull();
      expect(await readHelpCategoryRows()).toHaveLength(1);
      expect(await readAuditLogSummaries()).toEqual([]);
    },
  );
});
