import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  clearProductTables,
  db,
  insertProduct,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  createTestStore,
  HOOK_MARK,
  NOW,
  readAllProductRows,
  readProductRow,
} from './testing/product-store-fixtures.ts';

const OWNER = 1;

const PRODUCT = 1;

const INPUT = {
  productId: productIdOf(PRODUCT),
  descriptionMarkdown: '新しい説明文',
  now: NOW,
};

async function setProduct(columns: Partial<typeof products.$inferInsert>) {
  await db
    .update(products)
    .set(columns)
    .where(eq(products.id, productIdOf(PRODUCT)));
}

async function suspendOwner(): Promise<void> {
  await db
    .update(users)
    .set({ status: 'suspended' })
    .where(eq(users.id, userIdOf(OWNER)));
}

async function expectAborted(
  input: typeof INPUT,
  expected: string,
): Promise<void> {
  const { store, calls } = createTestStore();
  const before = await readAllProductRows();

  const result = await store.updateDescription(input);

  expect(result).toBe(expected);
  expect(await readAllProductRows()).toStrictEqual(before);
  expect(calls.map(({ phase }) => phase)).not.toContain('after-commit');
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertProduct(PRODUCT, OWNER, { version: 2 });
});

describe('D1ProductStore.updateDescription', () => {
  test('説明文を書き換えて版を1増やし、登録した処理の文を同じ一括の書き込みで確定し、確定の後の処理を呼ぶ', async () => {
    const { store, calls } = createTestStore();

    const result = await store.updateDescription(INPUT);

    expect(result).toBe('saved');
    expect(await readProductRow(PRODUCT)).toMatchObject({
      descriptionMarkdown: '新しい説明文',
      name: `プロダクト1${HOOK_MARK}`,
      version: 3,
      updatedAt: NOW,
      userId: userIdOf(OWNER),
    });
    expect(calls).toStrictEqual([
      { phase: 'statements', productId: productIdOf(PRODUCT) },
      { phase: 'after-commit', productId: productIdOf(PRODUCT) },
    ]);
  });

  test('非公開化中のプロダクトではhiddenを返し、説明文・版・登録した処理の文のどれも変えない', async () => {
    await setProduct({ hiddenAt: T0 });

    await expectAborted(INPUT, 'hidden');
  });

  test('非公開化されていない状態を読んだ後に非公開化されても、書き込みの時点で判定してhiddenを返す', async () => {
    const { store } = createTestStore();
    const read = await store.findForOwner(userIdOf(OWNER), 'product1', NOW);
    expect(read?.hidden).toBe(false);
    await setProduct({ hiddenAt: NOW });

    await expectAborted(INPUT, 'hidden');
  });

  test('論理削除したプロダクトと不在のプロダクトはnot-foundを返す', async () => {
    await setProduct({ deletedAt: T0 });

    await expectAborted(INPUT, 'not-found');
    await expectAborted({ ...INPUT, productId: productIdOf(50) }, 'not-found');
  });

  test('投稿者が停止中ならaccount-unavailableを返す', async () => {
    await suspendOwner();

    await expectAborted(INPUT, 'account-unavailable');
  });

  test('非公開化と投稿者の停止が重なればaccount-unavailableを返す', async () => {
    await setProduct({ hiddenAt: T0 });
    await suspendOwner();

    await expectAborted(INPUT, 'account-unavailable');
  });

  test('論理削除と投稿者の停止が重なればnot-foundを返す', async () => {
    await setProduct({ deletedAt: T0, hiddenAt: T0 });
    await suspendOwner();

    await expectAborted(INPUT, 'not-found');
  });

  test('同時の文を返す処理の例外では何も書き込まず、例外を呼び出し元へ伝える', async () => {
    const failure = new Error('同時の文の失敗');
    const { store, calls } = createTestStore({ statementsError: failure });
    const before = await readAllProductRows();

    await expect(store.updateDescription(INPUT)).rejects.toBe(failure);
    expect(await readAllProductRows()).toStrictEqual(before);
    expect(calls.map(({ phase }) => phase)).toStrictEqual(['statements']);
  });

  test('登録した文が実行時に制約に違反すると一括の書き込み全体が取り消され、例外を伝える', async () => {
    const { store, calls } = createTestStore({ violating: true });
    const before = await readAllProductRows();

    await expect(store.updateDescription(INPUT)).rejects.toThrow(
      /NOT NULL constraint failed: products\.website_url/u,
    );
    expect(await readAllProductRows()).toStrictEqual(before);
    expect(calls.map(({ phase }) => phase)).toStrictEqual(['statements']);
  });

  test('確定の後の処理の例外は更新の結果を変えない', async () => {
    const { store, calls } = createTestStore({
      afterCommitError: new Error('確定の後の失敗'),
    });

    await expect(store.updateDescription(INPUT)).resolves.toBe('saved');
    expect(calls.map(({ phase }) => phase)).toStrictEqual([
      'statements',
      'after-commit',
    ]);
  });
});
