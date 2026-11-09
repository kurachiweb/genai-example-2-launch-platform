import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { resolveHandle } from '../../../lib/workers/handles/handle-queries.ts';
import { PRODUCT_HANDLE_NAMESPACE } from '../../../lib/workers/product/product-handle-namespaces.ts';
import {
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertScreenshot,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import type { ProductSaveInput } from '../../application/product/ports.ts';
import {
  businessAt,
  businessDate,
  createTestStore,
  fieldsOf,
  fileIdOf,
  HOOK_MARK,
  newIdOf,
  NOW,
  planOf,
  readAllProductRows,
  readLaunchRows,
  readPreviousHandles,
  readProductRow,
  readScreenshotFileIds,
  saveInputOf,
} from './testing/product-store-fixtures.ts';

const OWNER = 1;

const OTHER = 2;

const PRODUCT = 1;

function handleChangeOf(
  index: number,
  next: string,
  previous = `product${String(index)}`,
): ProductSaveInput {
  return saveInputOf(index, {
    fields: fieldsOf(index, { handle: next }),
    plan: planOf({ handle: { kind: 'changed', next, previous } }),
  });
}

function categoryChangeAt(now: Date): ProductSaveInput {
  return saveInputOf(PRODUCT, {
    fields: fieldsOf(PRODUCT, { categoryId: categoryIdOf(1) }),
    plan: planOf({ categoryChanged: true }),
    now,
  });
}

function rescheduleAt(now: Date, date = '2026-11-27'): ProductSaveInput {
  return saveInputOf(PRODUCT, {
    plan: planOf({
      launch: {
        kind: 'reschedule',
        launchId: launchIdOf(1),
        date: businessDate(date),
      },
    }),
    now,
  });
}

function reserveOf(date: string, now = NOW): ProductSaveInput {
  return saveInputOf(PRODUCT, {
    plan: planOf({ launch: { kind: 'reserve', date: businessDate(date) } }),
    now,
  });
}

async function finishOpenLaunch(): Promise<void> {
  await insertLaunch(9, PRODUCT, {
    launchDate: '2026-11-01',
    outcome: 'won',
    decidedAt: T0,
  });
}

async function expectAborted(
  input: ProductSaveInput,
  expected: string,
): Promise<void> {
  const { store, calls } = createTestStore();
  const before = await readAllProductRows();

  const result = await store.save(input);

  expect(result).toBe(expected);
  expect(await readAllProductRows()).toStrictEqual(before);
  expect(calls.map(({ phase }) => phase)).not.toContain('after-commit');
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(OTHER, { emailVerifiedAt: T0 });
  await insertCategory(1);
  await insertProduct(PRODUCT, OWNER, { latestLaunchDate: '2026-11-20' });
  await insertLaunch(1, PRODUCT, { launchDate: '2026-11-20' });
});

describe('D1ProductStore.save', () => {
  test('内容を書き換えて版を1増やし、登録した処理の文を同じ一括の書き込みで確定し、確定の後の処理を呼ぶ', async () => {
    const { store, calls } = createTestStore();

    const result = await store.save(
      saveInputOf(PRODUCT, {
        fields: fieldsOf(PRODUCT, {
          name: '新しい名称',
          tagline: '新しいタグライン',
          websiteUrl: 'https://new.example/',
          descriptionMarkdown: '新しい説明文',
          logoFileId: fileIdOf(99),
        }),
        plan: planOf({
          logo: { kind: 'replace', fileId: fileIdOf(99), replaced: 'old' },
        }),
      }),
    );

    expect(result).toBe('saved');
    expect(await readProductRow(PRODUCT)).toMatchObject({
      name: `新しい名称${HOOK_MARK}`,
      tagline: '新しいタグライン',
      websiteUrl: 'https://new.example/',
      descriptionMarkdown: '新しい説明文',
      logoFileId: fileIdOf(99),
      userId: userIdOf(OWNER),
      latestLaunchDate: '2026-11-20',
      version: 1,
      updatedAt: NOW,
    });
    expect(calls).toStrictEqual([
      { phase: 'statements', productId: productIdOf(PRODUCT) },
      { phase: 'after-commit', productId: productIdOf(PRODUCT) },
    ]);
  });

  test('版が違えば取り消してconflictを返す', async () => {
    await expectAborted(
      saveInputOf(PRODUCT, {
        expectedVersion: 1,
        fields: fieldsOf(PRODUCT, { name: '別の名称' }),
      }),
      'conflict',
    );
  });

  test('論理削除したプロダクトと不在のプロダクトはnot-foundを返す', async () => {
    await db
      .update(products)
      .set({ deletedAt: T0 })
      .where(eq(products.id, productIdOf(PRODUCT)));

    await expectAborted(saveInputOf(PRODUCT), 'not-found');
    await expectAborted(saveInputOf(50), 'not-found');
  });

  test.each([
    ['停止中', { status: 'suspended' as const }],
    ['退会済み', { deletedAt: T0 }],
  ])('投稿者が%sならaccount-unavailableを返す', async (_case, columns) => {
    await db
      .update(users)
      .set(columns)
      .where(eq(users.id, userIdOf(OWNER)));

    await expectAborted(saveInputOf(PRODUCT), 'account-unavailable');
  });

  test.each([
    ['他のプロダクトの現在のハンドル', {}],
    ['論理削除したプロダクトの現在のハンドル', { deletedAt: T0 }],
  ])(
    '%sに変えると取り消してhandle-unavailableを返す',
    async (_case, columns) => {
      await insertProduct(2, OTHER, columns);

      await expectAborted(
        handleChangeOf(PRODUCT, 'PRODUCT2'),
        'handle-unavailable',
      );
    },
  );

  test('ハンドルを別の文字列に変えると変更前のハンドルで保持中の旧ハンドルを置き換える', async () => {
    await insertProductPreviousHandle(1, PRODUCT, 'legacy');
    const { store } = createTestStore();

    const result = await store.save(handleChangeOf(PRODUCT, 'fresh'));

    expect(result).toBe('saved');
    expect(await readProductRow(PRODUCT)).toMatchObject({ handle: 'fresh' });
    expect(await readPreviousHandles()).toStrictEqual([
      { ownerId: productIdOf(PRODUCT), handle: 'product1', deletedAt: null },
    ]);
  });

  test('大文字小文字の表記だけの変更では保持中の旧ハンドルを変えない', async () => {
    await insertProductPreviousHandle(1, PRODUCT, 'legacy');
    const { store } = createTestStore();

    const result = await store.save(
      saveInputOf(PRODUCT, {
        fields: fieldsOf(PRODUCT, { handle: 'Product1' }),
        plan: planOf({ handle: { kind: 'case-only', next: 'Product1' } }),
      }),
    );

    expect(result).toBe('saved');
    expect(await readProductRow(PRODUCT)).toMatchObject({ handle: 'Product1' });
    expect(await readPreviousHandles()).toStrictEqual([
      { ownerId: productIdOf(PRODUCT), handle: 'legacy', deletedAt: null },
    ]);
  });

  test.each([
    ['他のプロダクト', { deletedAt: null }],
    ['論理削除したプロダクト', { deletedAt: T0 }],
  ])(
    '%sの旧ハンドルに変えると元の保持者の旧ハンドルの行が消え、解決が保存したプロダクトに移る',
    async (_case, columns) => {
      await insertProduct(2, OTHER, columns);
      await insertProductPreviousHandle(2, 2, 'legacy', {
        deletedAt: columns.deletedAt ?? null,
      });
      const { store } = createTestStore();

      const result = await store.save(handleChangeOf(PRODUCT, 'Legacy'));

      expect(result).toBe('saved');
      expect(await readPreviousHandles()).toStrictEqual([
        { ownerId: productIdOf(PRODUCT), handle: 'product1', deletedAt: null },
      ]);
      await expect(
        resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'legacy'),
      ).resolves.toMatchObject({
        kind: 'current',
        ownerId: productIdOf(PRODUCT),
      });
    },
  );

  test('同じハンドルへの同時の2つの保存は一方だけが成功する', async () => {
    await insertProduct(2, OTHER);
    const { store } = createTestStore();

    const results = await Promise.all([
      store.save(handleChangeOf(PRODUCT, 'same-handle')),
      store.save(handleChangeOf(2, 'Same-Handle')),
    ]);

    expect(results.toSorted()).toStrictEqual(['handle-unavailable', 'saved']);
    const { productRows } = await readAllProductRows();
    expect(
      productRows.filter((row) => row.handle.toLowerCase() === 'same-handle'),
    ).toHaveLength(1);
  });

  test('他のプロダクトの同じ旧ハンドルへの同時の2つの保存は一方だけが成功し、元の保持者の行が消え、解決は成功した方へ移る', async () => {
    await insertProduct(2, OTHER);
    await insertProduct(3, OTHER, { deletedAt: T0 });
    await insertProductPreviousHandle(3, 3, 'legacy');
    const { store } = createTestStore();

    const results = await Promise.all([
      store.save(handleChangeOf(PRODUCT, 'legacy')),
      store.save(handleChangeOf(2, 'LEGACY')),
    ]);

    expect(results.toSorted()).toStrictEqual(['handle-unavailable', 'saved']);
    const winner = results[0] === 'saved' ? PRODUCT : 2;
    const previous = await readPreviousHandles();
    expect(previous).toStrictEqual([
      {
        ownerId: productIdOf(winner),
        handle: `product${String(winner)}`,
        deletedAt: null,
      },
    ]);
    await expect(
      resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'legacy'),
    ).resolves.toMatchObject({ kind: 'current', ownerId: productIdOf(winner) });
  });

  test('スクリーンショットを全件置き換え、選んだ順に保存する', async () => {
    await insertScreenshot(1, PRODUCT, 0, fileIdOf(1));
    await insertScreenshot(2, PRODUCT, 1, fileIdOf(2));
    await insertScreenshot(3, PRODUCT, 2, fileIdOf(3));
    const order = [fileIdOf(3), fileIdOf(4), fileIdOf(1)];
    const { store } = createTestStore();

    const result = await store.save(
      saveInputOf(PRODUCT, {
        fields: fieldsOf(PRODUCT, { screenshotFileIds: order }),
        plan: planOf({
          screenshots: {
            added: [fileIdOf(4)],
            removed: [fileIdOf(2)],
            order,
          },
        }),
      }),
    );

    expect(result).toBe('saved');
    expect(await readScreenshotFileIds(PRODUCT)).toStrictEqual(order);
    expect(
      (await readAllProductRows()).screenshotRows
        .map((row) => row.id)
        .toSorted(),
    ).toStrictEqual(
      [0, 1, 2].map((position) => newIdOf('NSCR', PRODUCT * 100 + position)),
    );
  });

  test.each([
    [
      '予選の結果が記録された',
      { outcome: 'won' as const, decidedAt: businessAt('2026-11-10', 12, 1) },
    ],
    [
      '版を上げずに取り消された',
      { cancelledAt: businessAt('2026-11-10', 12, 1) },
    ],
  ])(
    '読み取りの後に予定のローンチが%sら、ローンチ日の変更は取り消してconflictを返す',
    async (_case, columns) => {
      const { store } = createTestStore();
      const read = await store.findForOwner(userIdOf(OWNER), 'product1', NOW);
      expect(read?.launches[0]?.status).toBe('scheduled');
      await db
        .update(productLaunches)
        .set(columns)
        .where(eq(productLaunches.id, launchIdOf(1)));

      await expectAborted(rescheduleAt(NOW), 'conflict');
    },
  );

  test('ローンチ日の変更は予定のローンチの日付と最新のローンチ日を書き換える', async () => {
    const { store } = createTestStore();

    const result = await store.save(rescheduleAt(NOW));

    expect(result).toBe('saved');
    expect(await readLaunchRows(PRODUCT)).toMatchObject([
      { id: launchIdOf(1), launchDate: '2026-11-27' },
    ]);
    expect(await readProductRow(PRODUCT)).toMatchObject({
      latestLaunchDate: '2026-11-27',
    });
  });

  const lockCases = [
    ['カテゴリの変更', categoryChangeAt],
    ['ローンチ日の変更', (now: Date) => rescheduleAt(now)],
  ] as const;

  test.each(lockCases)(
    '翌日に予定のローンチがあるプロダクトの%sは、23:44なら保存する',
    async (_case, inputAt) => {
      const { store } = createTestStore();

      await expect(
        store.save(inputAt(businessAt('2026-11-19', 23, 44))),
      ).resolves.toBe('saved');
    },
  );

  test.each(lockCases)(
    '翌日に予定のローンチがあるプロダクトの%sは、時計が23:45へ進むと固定の期間として取り消す',
    async (_case, inputAt) => {
      const { store } = createTestStore();
      const read = await store.findForOwner(
        userIdOf(OWNER),
        'product1',
        businessAt('2026-11-19', 23, 44),
      );
      expect(read?.launches[0]?.status).toBe('scheduled');

      await expectAborted(inputAt(businessAt('2026-11-19', 23, 45)), 'locked');
    },
  );

  test('固定の期間でもカテゴリとローンチ日以外の項目は保存する', async () => {
    const { store } = createTestStore();

    const result = await store.save(
      saveInputOf(PRODUCT, {
        fields: fieldsOf(PRODUCT, { name: '固定中の名称' }),
        now: businessAt('2026-11-20', 10, 0),
      }),
    );

    expect(result).toBe('saved');
  });

  test('次回の予約はローンチを加え、最新のローンチ日を取消を含む最新の日にする', async () => {
    await db
      .update(products)
      .set({ latestLaunchDate: '2026-12-10' })
      .where(eq(products.id, productIdOf(PRODUCT)));
    await db
      .update(productLaunches)
      .set({ launchDate: '2026-12-10', cancelledAt: T0 })
      .where(eq(productLaunches.id, launchIdOf(1)));
    await finishOpenLaunch();
    const { store } = createTestStore();

    const result = await store.save(reserveOf('2026-11-25'));

    expect(result).toBe('saved');
    expect(await readLaunchRows(PRODUCT)).toMatchObject([
      { id: launchIdOf(9), launchDate: '2026-11-01', outcome: 'won' },
      {
        id: newIdOf('NLNC', PRODUCT),
        launchDate: '2026-11-25',
        outcome: null,
        cancelledAt: null,
      },
      { id: launchIdOf(1), launchDate: '2026-12-10' },
    ]);
    expect(await readProductRow(PRODUCT)).toMatchObject({
      latestLaunchDate: '2026-12-10',
      version: 1,
    });
  });

  test('非公開化中の次回の予約は取り消してhiddenを返し、予約でない保存は受け付ける', async () => {
    await db
      .update(productLaunches)
      .set({ cancelledAt: T0 })
      .where(eq(productLaunches.id, launchIdOf(1)));
    await db
      .update(products)
      .set({ hiddenAt: T0 })
      .where(eq(products.id, productIdOf(PRODUCT)));

    await expectAborted(reserveOf('2026-11-25'), 'hidden');

    const { store } = createTestStore();
    await expect(
      store.save(
        saveInputOf(PRODUCT, {
          fields: fieldsOf(PRODUCT, { name: '非公開化中の名称' }),
        }),
      ),
    ).resolves.toBe('saved');
  });

  test('終了・取消でないローンチがあるプロダクトへの予約は取り消してconflictを返す', async () => {
    await expectAborted(reserveOf('2026-11-25'), 'conflict');
  });

  describe('取り消しの理由の分類の優先の順', () => {
    test('論理削除と投稿者の停止が重なればnot-found', async () => {
      await db
        .update(products)
        .set({ deletedAt: T0 })
        .where(eq(products.id, productIdOf(PRODUCT)));
      await db
        .update(users)
        .set({ status: 'suspended' })
        .where(eq(users.id, userIdOf(OWNER)));

      await expectAborted(saveInputOf(PRODUCT), 'not-found');
    });

    test('投稿者の停止と版の違いが重なればaccount-unavailable', async () => {
      await db
        .update(users)
        .set({ status: 'suspended' })
        .where(eq(users.id, userIdOf(OWNER)));

      await expectAborted(
        saveInputOf(PRODUCT, { expectedVersion: 5 }),
        'account-unavailable',
      );
    });

    test('版の違いと固定の期間が重なればconflict', async () => {
      await expectAborted(
        {
          ...categoryChangeAt(businessAt('2026-11-20', 1, 0)),
          expectedVersion: 5,
        },
        'conflict',
      );
    });

    test('固定の期間と使用中のハンドルが重なればlocked', async () => {
      await insertProduct(2, OTHER);

      await expectAborted(
        {
          ...categoryChangeAt(businessAt('2026-11-20', 1, 0)),
          fields: fieldsOf(PRODUCT, {
            categoryId: categoryIdOf(1),
            handle: 'product2',
          }),
          plan: planOf({
            categoryChanged: true,
            handle: { kind: 'changed', next: 'product2', previous: 'product1' },
          }),
        },
        'locked',
      );
    });

    test('非公開化中の予約と使用中のハンドルが重なればhidden', async () => {
      await insertProduct(2, OTHER);
      await db
        .update(products)
        .set({ hiddenAt: T0 })
        .where(eq(products.id, productIdOf(PRODUCT)));

      await expectAborted(
        {
          ...reserveOf('2026-11-25'),
          fields: fieldsOf(PRODUCT, { handle: 'product2' }),
          plan: planOf({
            launch: { kind: 'reserve', date: businessDate('2026-11-25') },
            handle: { kind: 'changed', next: 'product2', previous: 'product1' },
          }),
        },
        'hidden',
      );
    });
  });

  describe('保存の処理', () => {
    test('同時の文を返す処理の例外では何も書き込まず、例外を呼び出し元へ伝える', async () => {
      const failure = new Error('同時の文の失敗');
      const { store, calls } = createTestStore({ statementsError: failure });
      const before = await readAllProductRows();

      await expect(store.save(handleChangeOf(PRODUCT, 'fresh'))).rejects.toBe(
        failure,
      );
      expect(await readAllProductRows()).toStrictEqual(before);
      expect(calls.map(({ phase }) => phase)).toStrictEqual(['statements']);
    });

    test('登録した文が実行時に制約に違反すると一括の書き込み全体が取り消され、例外を伝える', async () => {
      await insertProductPreviousHandle(1, PRODUCT, 'legacy');
      await insertScreenshot(1, PRODUCT, 0, fileIdOf(1));
      const { store, calls } = createTestStore({ violating: true });
      const before = await readAllProductRows();

      await expect(
        store.save({
          ...handleChangeOf(PRODUCT, 'fresh'),
          fields: fieldsOf(PRODUCT, {
            handle: 'fresh',
            screenshotFileIds: [fileIdOf(2)],
          }),
          screenshotIds: [newIdOf('NSCR', 500)],
        }),
      ).rejects.toThrow(/NOT NULL constraint failed: products\.website_url/u);
      expect(await readAllProductRows()).toStrictEqual(before);
      expect(calls.map(({ phase }) => phase)).toStrictEqual(['statements']);
    });

    test('確定の後の処理の例外は保存の結果を変えない', async () => {
      const { store, calls } = createTestStore({
        afterCommitError: new Error('確定の後の失敗'),
      });

      await expect(store.save(saveInputOf(PRODUCT))).resolves.toBe('saved');
      expect(calls.map(({ phase }) => phase)).toStrictEqual([
        'statements',
        'after-commit',
      ]);
    });
  });
});
