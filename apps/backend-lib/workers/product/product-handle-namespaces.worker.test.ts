import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { productPreviousHandles } from '../../../db/schema/product/product-previous-handles.ts';
import { products } from '../../../db/schema/product/products.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import {
  PRODUCT_CATEGORY_HANDLE_RULE,
  PRODUCT_HANDLE_RULE,
} from '../../../common-lib/product/product-input-rules.ts';
import {
  handleOccupiedCondition,
  isHandleOccupied,
  resolveHandle,
} from '../handles/handle-queries.ts';
import {
  previousHandleRelease,
  previousHandleUpsert,
} from '../handles/previous-handle-statements.ts';
import type { HandleNamespace } from '../handles/handle-namespace.ts';
import {
  PRODUCT_CATEGORY_HANDLE_NAMESPACE,
  PRODUCT_HANDLE_NAMESPACE,
} from './product-handle-namespaces.ts';
import {
  after,
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  previousHandleIdOf,
  productIdOf,
} from './testing/product-fixtures.ts';

async function occupiedInStatement(
  ns: HandleNamespace,
  handle: string,
  exceptOwnerId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      occupied: sql<number>`${handleOccupiedCondition(ns, handle, { exceptOwnerId })}`,
    })
    .from(sql`(SELECT 1)`);
  return row?.occupied === 1;
}

async function readPreviousHandles() {
  return db
    .select({
      ownerId: productPreviousHandles.ownerId,
      handle: productPreviousHandles.handle,
    })
    .from(productPreviousHandles)
    .orderBy(asc(productPreviousHandles.id));
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(1);
});

describe('PRODUCT_HANDLE_NAMESPACE', () => {
  test('名前はproductで、共用部品のプロダクトのハンドルの規則を使う', () => {
    expect(PRODUCT_HANDLE_NAMESPACE.name).toBe('product');
    expect(PRODUCT_HANDLE_NAMESPACE.rule).toBe(PRODUCT_HANDLE_RULE);
    expect(PRODUCT_HANDLE_NAMESPACE.previous?.table).toBe(
      productPreviousHandles,
    );
  });

  test('現在のハンドルは大文字小文字を区別せずに解決し、保存されている綴りを返す', async () => {
    await insertProduct(1, 1, { handle: 'My-App' });

    expect(await resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'my-APP')).toEqual(
      { kind: 'current', ownerId: productIdOf(1), handle: 'My-App' },
    );
  });

  test('旧ハンドルは大文字小文字を区別せずに保有者のプロダクトへ解決する', async () => {
    await insertProduct(1, 1, { handle: 'my-app' });
    await insertProductPreviousHandle(1, 1, 'Old-App');

    expect(
      await resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'OLD-app'),
    ).toEqual({ kind: 'previous', ownerId: productIdOf(1) });
  });

  test('論理削除したプロダクトの現在のハンドルは解決しないが、物理削除まで他のプロダクトの使用中に数える', async () => {
    await insertProduct(1, 1, { handle: 'Gone-App', deletedAt: after(1) });
    await insertProduct(2, 1, { handle: 'other-app' });

    expect(
      await resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'gone-app'),
    ).toEqual({ kind: 'none' });
    expect(
      await isHandleOccupied(db, PRODUCT_HANDLE_NAMESPACE, 'GONE-APP', {
        exceptOwnerId: productIdOf(2),
      }),
    ).toBe(true);
    expect(
      await occupiedInStatement(
        PRODUCT_HANDLE_NAMESPACE,
        'gone-app',
        productIdOf(2),
      ),
    ).toBe(true);
  });

  test('他のプロダクトの旧ハンドルは、論理削除したプロダクトのものや論理削除済みの行を含めて使用中に数えない', async () => {
    await insertProduct(1, 1, { handle: 'live-app' });
    await insertProduct(2, 1, { handle: 'deleted-app', deletedAt: after(1) });
    await insertProduct(3, 1, { handle: 'setter-app' });
    await insertProductPreviousHandle(1, 1, 'kept-old');
    await insertProductPreviousHandle(2, 2, 'deleted-old', {
      deletedAt: after(1),
    });

    for (const handle of ['kept-old', 'DELETED-OLD']) {
      expect(
        await isHandleOccupied(db, PRODUCT_HANDLE_NAMESPACE, handle, {
          exceptOwnerId: productIdOf(3),
        }),
      ).toBe(false);
      expect(
        await occupiedInStatement(
          PRODUCT_HANDLE_NAMESPACE,
          handle,
          productIdOf(3),
        ),
      ).toBe(false);
    }
  });

  test('他のプロダクトが旧ハンドルを現在のハンドルに設定した一括の書き込みで、元の保持者の旧ハンドルの行を消し、設定したプロダクトへ解決する', async () => {
    await insertProduct(1, 1, { handle: 'live-app' });
    await insertProduct(2, 1, { handle: 'deleted-app', deletedAt: after(1) });
    await insertProduct(3, 1, { handle: 'setter-app' });
    await insertProductPreviousHandle(1, 1, 'Kept-Old');
    await insertProductPreviousHandle(2, 2, 'deleted-old', {
      deletedAt: after(1),
    });

    await db.batch([
      db
        .update(products)
        .set({ handle: 'kept-old' })
        .where(eq(products.id, productIdOf(3))),
      previousHandleRelease(db, PRODUCT_HANDLE_NAMESPACE, {
        handle: 'kept-old',
        exceptOwnerId: productIdOf(3),
      }),
      previousHandleUpsert(db, PRODUCT_HANDLE_NAMESPACE, {
        id: previousHandleIdOf(3),
        ownerId: productIdOf(3),
        handle: 'setter-app',
        now: after(2),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      { ownerId: productIdOf(2), handle: 'deleted-old' },
      { ownerId: productIdOf(3), handle: 'setter-app' },
    ]);
    expect(
      await resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'KEPT-OLD'),
    ).toEqual({ kind: 'current', ownerId: productIdOf(3), handle: 'kept-old' });
  });
});

describe('PRODUCT_CATEGORY_HANDLE_NAMESPACE', () => {
  test('名前はproduct-categoryで、共用部品のカテゴリのハンドルの規則を使い、旧ハンドルを持たない', () => {
    expect(PRODUCT_CATEGORY_HANDLE_NAMESPACE.name).toBe('product-category');
    expect(PRODUCT_CATEGORY_HANDLE_NAMESPACE.rule).toBe(
      PRODUCT_CATEGORY_HANDLE_RULE,
    );
    expect(PRODUCT_CATEGORY_HANDLE_NAMESPACE.previous).toBeUndefined();
  });

  test('カテゴリのハンドルは大文字小文字を区別せずに解決し、初期データの標準カテゴリも解決する', async () => {
    await insertCategory(1, { handle: 'Dev-Tools' });

    expect(
      await resolveHandle(db, PRODUCT_CATEGORY_HANDLE_NAMESPACE, 'dev-TOOLS'),
    ).toEqual({
      kind: 'current',
      ownerId: categoryIdOf(1),
      handle: 'Dev-Tools',
    });
    expect(
      await resolveHandle(db, PRODUCT_CATEGORY_HANDLE_NAMESPACE, 'OTHER'),
    ).toEqual({
      kind: 'current',
      ownerId: PRODUCT_CATEGORY_OTHER_ID,
      handle: 'other',
    });
    expect(
      await resolveHandle(db, PRODUCT_CATEGORY_HANDLE_NAMESPACE, 'nothing'),
    ).toEqual({ kind: 'none' });
  });

  test('他のカテゴリのハンドルを使用中に数え、自分のハンドルは除き、旧ハンドルの解放は何も変えない', async () => {
    await insertCategory(1, { handle: 'dev-tools' });
    await insertCategory(2, { handle: 'games' });

    expect(
      await isHandleOccupied(
        db,
        PRODUCT_CATEGORY_HANDLE_NAMESPACE,
        'DEV-TOOLS',
        {
          exceptOwnerId: categoryIdOf(2),
        },
      ),
    ).toBe(true);
    expect(
      await isHandleOccupied(
        db,
        PRODUCT_CATEGORY_HANDLE_NAMESPACE,
        'dev-tools',
        {
          exceptOwnerId: categoryIdOf(1),
        },
      ),
    ).toBe(false);

    await db.batch([
      previousHandleRelease(db, PRODUCT_CATEGORY_HANDLE_NAMESPACE, {
        handle: 'dev-tools',
        exceptOwnerId: categoryIdOf(2),
      }),
    ]);

    const rows = await db
      .select({ handle: productCategories.handle })
      .from(productCategories)
      .orderBy(asc(productCategories.id));
    expect(rows.map((row) => row.handle)).toEqual([
      'other',
      'dev-tools',
      'games',
    ]);
  });
});
