import { describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import {
  categoryIdOf,
  db,
  insertCategory,
  insertProduct,
  insertUser,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import { adminAuditLogs } from '../../../../../db/schema/admin/admin-audit-logs.ts';
import { productCategories } from '../../../../../db/schema/product/product-categories.ts';
import {
  asProductAdmin,
  codesOf,
  createProductCategory,
  deleteProductCategory,
  detailsOf,
  fetchAdminProductCategories,
  fetchProductCategories,
  installProductAdminGraphQLTest,
  PRODUCT_ADMINS,
  productAdminIdOf,
  updateProductCategory,
} from '../../../../../test/support/product-graphql-operations.ts';
import {
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

installProductAdminGraphQLTest();

const { superAdmin, moderator, viewer } = PRODUCT_ADMINS;

const OTHER_CATEGORY = {
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
  handle: PRODUCT_CATEGORY_OTHER_HANDLE,
  systemDefault: true,
};

const categoryOf = (index: number) => ({
  id: categoryIdOf(index),
  name: `カテゴリ${String(index)}`,
  handle: `category${String(index)}`,
  systemDefault: false,
});

const TOO_LONG_REASON = 'あ'.repeat(501);

const UNKNOWN_CATEGORY_ID = categoryIdOf(99);

// 追加の順の確認のため、IDの順と作成日時の順を逆にする
async function insertTwoCategories(): Promise<void> {
  await insertCategory(1, { createdAt: new Date('2026-11-02T00:00:00.000Z') });
  await insertCategory(2, { createdAt: new Date('2026-11-01T00:00:00.000Z') });
}

async function readAuditLogReasons(): Promise<(string | null)[]> {
  const rows = await db
    .select({ reason: adminAuditLogs.reason })
    .from(adminAuditLogs);
  return rows.map(({ reason }) => reason);
}

async function readCategoryRows() {
  return db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      handle: productCategories.handle,
    })
    .from(productCategories);
}

describe('productCategories', () => {
  test('ログインせずに、利用者側と管理者側のどちらからも追加の順で標準カテゴリを末尾にして返す', async () => {
    await insertTwoCategories();

    const fromClient = await fetchProductCategories();
    const fromAdmin = await fetchProductCategories({ caller: 'admin' });

    const expected = [categoryOf(2), categoryOf(1), OTHER_CATEGORY];
    expect(fromClient.errors).toBeUndefined();
    expect(fromClient.data?.productCategories).toEqual(expected);
    expect(fromAdmin.errors).toBeUndefined();
    expect(fromAdmin.data?.productCategories).toEqual(expected);
  });
});

describe('adminProductCategories', () => {
  test('閲覧のみの管理者にも同じ順で返す', async () => {
    await insertTwoCategories();

    const response = await fetchAdminProductCategories(asProductAdmin(viewer));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminProductCategories).toEqual([
      categoryOf(2),
      categoryOf(1),
      OTHER_CATEGORY,
    ]);
  });

  test('管理者のセッションが無ければunauthenticated、利用者側の呼び出し元はforbiddenで拒否する', async () => {
    const anonymous = await fetchAdminProductCategories({ caller: 'admin' });
    const fromClient = await fetchAdminProductCategories({
      ...asProductAdmin(viewer),
      caller: 'client',
    });

    expect(codesOf(anonymous)).toEqual(['unauthenticated']);
    expect(codesOf(fromClient)).toEqual(['forbidden']);
  });
});

describe('createProductCategory', () => {
  test.each([
    ['モデレーター', moderator],
    ['最上位管理者', superAdmin],
  ])(
    '%sの追加を前後の空白を除いた名前で保存し、理由とともに監査ログへ記録する',
    async (_label, adminIndex) => {
      const response = await createProductCategory(
        {
          input: { name: '  開発ツール ', handle: 'DevTools' },
          reason: '新設',
        },
        asProductAdmin(adminIndex),
      );

      const created = response.data?.createProductCategory;
      expect(response.errors).toBeUndefined();
      expect(created).toEqual({
        id: expect.any(String) as string,
        name: '開発ツール',
        handle: 'DevTools',
        systemDefault: false,
      });
      expect(await readCategoryRows()).toContainEqual({
        id: created?.id,
        name: '開発ツール',
        handle: 'DevTools',
      });
      expect(await readAuditLogSummaries()).toEqual([
        expect.objectContaining({
          operatorAdminId: productAdminIdOf(adminIndex),
          action: 'product-category.create',
        }),
      ]);
      expect(await readAuditLogTargetIds()).toEqual([created?.id]);
      expect(await readAuditLogReasons()).toEqual(['新設']);
    },
  );

  test('閲覧のみの管理者をforbiddenで拒否し、保存も記録もしない', async () => {
    const response = await createProductCategory(
      { input: { name: '開発ツール', handle: 'devtools' } },
      asProductAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readCategoryRows()).toHaveLength(1);
    expect(await readAuditLogSummaries()).toEqual([]);
  });

  test('利用者側の呼び出し元を入力の検証より前にforbiddenで拒否する', async () => {
    const response = await createProductCategory(
      { input: { name: '', handle: '' }, reason: TOO_LONG_REASON },
      { ...asProductAdmin(moderator), caller: 'client' },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await createProductCategory(
      { input: { name: '開発ツール', handle: 'devtools' } },
      { caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('名前とハンドルの形式の違反を入力の欄ごとの詳細付きのvalidation_errorで拒否する', async () => {
    const response = await createProductCategory(
      { input: { name: '   ', handle: 'dev tools' } },
      asProductAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response).map(({ field }) => field)).toEqual([
      'input.name',
      'input.handle',
    ]);
  });

  test('500文字を超える理由をvalidation_errorで拒否する', async () => {
    const response = await createProductCategory(
      {
        input: { name: '開発ツール', handle: 'devtools' },
        reason: TOO_LONG_REASON,
      },
      asProductAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'reason',
        message: '理由は500文字以内で入力してください。',
      }),
    ]);
  });

  test('大文字小文字を区別せずに同じ名前・ハンドルを入力の欄の詳細付きで拒否する', async () => {
    await insertCategory(1, { name: 'Dev', handle: 'dev' });

    const nameTaken = await createProductCategory(
      { input: { name: 'DEV', handle: 'another' } },
      asProductAdmin(moderator),
    );
    const handleTaken = await createProductCategory(
      { input: { name: '別の名前', handle: 'DEV' } },
      asProductAdmin(moderator),
    );

    expect(codesOf(nameTaken)).toEqual(['product_category_name_taken']);
    expect(detailsOf(nameTaken).map(({ field }) => field)).toEqual([
      'input.name',
    ]);
    expect(codesOf(handleTaken)).toEqual(['product_category_handle_taken']);
    expect(detailsOf(handleTaken).map(({ field }) => field)).toEqual([
      'input.handle',
    ]);
    expect(await readAuditLogSummaries()).toEqual([]);
  });
});

describe('updateProductCategory', () => {
  test('モデレーターの変更を保存し、理由を省いて監査ログへ記録する', async () => {
    await insertCategory(1);

    const response = await updateProductCategory(
      {
        id: categoryIdOf(1),
        input: { name: '開発ツール', handle: 'devtools' },
      },
      asProductAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateProductCategory).toEqual({
      id: categoryIdOf(1),
      name: '開発ツール',
      handle: 'devtools',
      systemDefault: false,
    });
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        operatorAdminId: productAdminIdOf(moderator),
        action: 'product-category.update',
      }),
    ]);
    expect(await readAuditLogTargetIds()).toEqual([categoryIdOf(1)]);
    expect(await readAuditLogReasons()).toEqual([null]);
  });

  test('閲覧のみの管理者をforbiddenで拒否する', async () => {
    await insertCategory(1);

    const response = await updateProductCategory(
      {
        id: categoryIdOf(1),
        input: { name: '開発ツール', handle: 'devtools' },
      },
      asProductAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readCategoryRows()).toContainEqual({
      id: categoryIdOf(1),
      name: 'カテゴリ1',
      handle: 'category1',
    });
  });

  test('標準カテゴリをproduct_category_protected、存在しないカテゴリをnot_foundで拒否する', async () => {
    const protectedResponse = await updateProductCategory(
      {
        id: PRODUCT_CATEGORY_OTHER_ID,
        input: { name: '雑多', handle: 'misc' },
      },
      asProductAdmin(moderator),
    );
    const missing = await updateProductCategory(
      {
        id: UNKNOWN_CATEGORY_ID,
        input: { name: '開発ツール', handle: 'devtools' },
      },
      asProductAdmin(moderator),
    );

    expect(codesOf(protectedResponse)).toEqual(['product_category_protected']);
    expect(codesOf(missing)).toEqual(['not_found']);
    expect(await readCategoryRows()).toEqual([
      {
        id: PRODUCT_CATEGORY_OTHER_ID,
        name: PRODUCT_CATEGORY_OTHER_NAME,
        handle: PRODUCT_CATEGORY_OTHER_HANDLE,
      },
    ]);
  });

  test('他のカテゴリと同じハンドルを入力の欄の詳細付きで拒否する', async () => {
    await insertCategory(1);
    await insertCategory(2);

    const response = await updateProductCategory(
      {
        id: categoryIdOf(1),
        input: { name: 'カテゴリ1', handle: 'Category2' },
      },
      asProductAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['product_category_handle_taken']);
    expect(detailsOf(response).map(({ field }) => field)).toEqual([
      'input.handle',
    ]);
  });

  test('利用者側の呼び出し元をforbiddenで拒否する', async () => {
    await insertCategory(1);

    const response = await updateProductCategory(
      {
        id: categoryIdOf(1),
        input: { name: '開発ツール', handle: 'devtools' },
      },
      { ...asProductAdmin(moderator), caller: 'client' },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});

describe('deleteProductCategory', () => {
  test('モデレーターの削除を行い、理由とともに監査ログへ記録する', async () => {
    await insertCategory(1);

    const response = await deleteProductCategory(
      { id: categoryIdOf(1), reason: '統合' },
      asProductAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteProductCategory).toBe(true);
    expect(await readCategoryRows()).toHaveLength(1);
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        operatorAdminId: productAdminIdOf(moderator),
        action: 'product-category.delete',
      }),
    ]);
    expect(await readAuditLogReasons()).toEqual(['統合']);
  });

  test('閲覧のみの管理者と利用者側の呼び出し元をforbiddenで拒否する', async () => {
    await insertCategory(1);

    const byViewer = await deleteProductCategory(
      { id: categoryIdOf(1) },
      asProductAdmin(viewer),
    );
    const fromClient = await deleteProductCategory(
      { id: categoryIdOf(1) },
      { ...asProductAdmin(moderator), caller: 'client' },
    );

    expect(codesOf(byViewer)).toEqual(['forbidden']);
    expect(codesOf(fromClient)).toEqual(['forbidden']);
    expect(await readCategoryRows()).toHaveLength(2);
  });

  test('プロダクトが紐付くカテゴリをproduct_category_in_use、標準カテゴリをproduct_category_protected、存在しないカテゴリをnot_foundで拒否する', async () => {
    await insertCategory(1);
    await insertUser(1);
    await insertProduct(1, 1, {
      categoryId: categoryIdOf(1),
      deletedAt: new Date('2026-11-05T00:00:00.000Z'),
    });

    const inUse = await deleteProductCategory(
      { id: categoryIdOf(1) },
      asProductAdmin(moderator),
    );
    const protectedResponse = await deleteProductCategory(
      { id: PRODUCT_CATEGORY_OTHER_ID },
      asProductAdmin(moderator),
    );
    const missing = await deleteProductCategory(
      { id: UNKNOWN_CATEGORY_ID },
      asProductAdmin(moderator),
    );

    expect(codesOf(inUse)).toEqual(['product_category_in_use']);
    expect(codesOf(protectedResponse)).toEqual(['product_category_protected']);
    expect(codesOf(missing)).toEqual(['not_found']);
    expect(await readCategoryRows()).toHaveLength(2);
    expect(await readAuditLogSummaries()).toEqual([]);
  });

  test('64文字を超えるIDを不在の文言のvalidation_errorで拒否する', async () => {
    const response = await deleteProductCategory(
      { id: 'x'.repeat(65) },
      asProductAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'id',
        message: 'カテゴリが見つかりません。',
      }),
    ]);
  });
});
