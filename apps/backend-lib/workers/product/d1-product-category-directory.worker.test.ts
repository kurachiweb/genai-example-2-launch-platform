import { beforeEach, describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/product/product-category-constants.ts';
import { D1ProductCategoryDirectory } from './d1-product-category-directory.ts';
import {
  after,
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
} from './testing/product-fixtures.ts';

// 初期データのマイグレーションが標準カテゴリに入れる作成日時(IDのULIDの時刻部)
const OTHER_CREATED_AT = new Date(1_731_945_562_112);

const directory = new D1ProductCategoryDirectory(db);

beforeEach(async () => {
  await clearProductTables();
});

describe('list', () => {
  test('追加の順に並べ、作成日時が同じならIDの順にし、標準カテゴリは作成日時によらず末尾に置く', async () => {
    await insertCategory(3, {
      name: 'ゲーム',
      handle: 'games',
      createdAt: after(2),
    });
    await insertCategory(1, {
      name: '開発ツール',
      handle: 'Dev-Tools',
      createdAt: after(1),
    });
    await insertCategory(2, {
      name: 'デザイン',
      handle: 'design',
      createdAt: after(2),
    });

    const categories = await directory.list();

    expect(categories).toEqual([
      {
        id: categoryIdOf(1),
        name: '開発ツール',
        handle: 'Dev-Tools',
        systemDefault: false,
        createdAt: after(1),
      },
      {
        id: categoryIdOf(2),
        name: 'デザイン',
        handle: 'design',
        systemDefault: false,
        createdAt: after(2),
      },
      {
        id: categoryIdOf(3),
        name: 'ゲーム',
        handle: 'games',
        systemDefault: false,
        createdAt: after(2),
      },
      {
        id: PRODUCT_CATEGORY_OTHER_ID,
        name: PRODUCT_CATEGORY_OTHER_NAME,
        handle: PRODUCT_CATEGORY_OTHER_HANDLE,
        systemDefault: true,
        createdAt: OTHER_CREATED_AT,
      },
    ]);
  });

  test('追加したカテゴリが無ければ標準カテゴリだけを返す', async () => {
    expect((await directory.list()).map((category) => category.id)).toEqual([
      PRODUCT_CATEGORY_OTHER_ID,
    ]);
  });
});

describe('findByHandle', () => {
  test('ハンドルを大文字小文字を区別せずに解決し、保存されている綴りのカテゴリを返す', async () => {
    await insertCategory(1, {
      name: '開発ツール',
      handle: 'Dev-Tools',
      createdAt: after(1),
    });

    expect(await directory.findByHandle('dev-TOOLS')).toEqual({
      id: categoryIdOf(1),
      name: '開発ツール',
      handle: 'Dev-Tools',
      systemDefault: false,
      createdAt: after(1),
    });
  });

  test('標準カテゴリも大文字小文字を区別せずに解決する', async () => {
    expect(await directory.findByHandle('OTHER')).toMatchObject({
      id: PRODUCT_CATEGORY_OTHER_ID,
      systemDefault: true,
    });
  });

  test('存在しないハンドルとカテゴリ名ではundefinedを返す', async () => {
    await insertCategory(1, { name: 'tools-name', handle: 'tools' });

    expect(await directory.findByHandle('nothing')).toBeUndefined();
    expect(await directory.findByHandle('tools-name')).toBeUndefined();
  });
});
