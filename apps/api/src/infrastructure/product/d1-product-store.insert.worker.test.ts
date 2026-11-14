import { resetSync } from '@logtape/logtape';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { resolveHandle } from '../../../lib/workers/handles/handle-queries.ts';
import { PRODUCT_HANDLE_NAMESPACE } from '../../../lib/workers/product/product-handle-namespaces.ts';
import {
  clearProductTables,
  db,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { configureRecordingLogs } from '../../../test/support/observability-recording.ts';
import {
  businessDate,
  createTestStore,
  fieldsOf,
  fileIdOf,
  HOOK_MARK,
  insertInputOf,
  newIdOf,
  NOW,
  readAllProductRows,
  readLaunchRows,
  readPreviousHandles,
  readProductRow,
  readScreenshotFileIds,
} from './testing/product-store-fixtures.ts';

const OWNER = 1;

const OTHER = 2;

const NEW_PRODUCT = 10;

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(OTHER, { emailVerifiedAt: T0 });
});

afterEach(() => {
  resetSync();
});

describe('D1ProductStore.insert', () => {
  test('プロダクト・最初のローンチ・選んだ順のスクリーンショットと登録した処理の文を1つの一括の書き込みで確定し、確定の後の処理を呼ぶ', async () => {
    const screenshotFileIds = Array.from({ length: 20 }, (_, index) =>
      fileIdOf(index + 1),
    ).toReversed();
    const { store, calls } = createTestStore();

    const result = await store.insert(
      insertInputOf(NEW_PRODUCT, userIdOf(OWNER), {
        fields: fieldsOf(NEW_PRODUCT, { screenshotFileIds }),
        launchDate: businessDate('2026-11-25'),
      }),
    );

    expect(result).toBe('saved');
    expect(await readProductRow(NEW_PRODUCT)).toStrictEqual({
      id: productIdOf(NEW_PRODUCT),
      userId: userIdOf(OWNER),
      categoryId: fieldsOf(NEW_PRODUCT).categoryId,
      handle: 'product10',
      name: `プロダクト10${HOOK_MARK}`,
      tagline: 'タグライン10',
      websiteUrl: 'https://product10.example/',
      descriptionMarkdown: '説明文10',
      logoFileId: fieldsOf(NEW_PRODUCT).logoFileId,
      latestLaunchDate: '2026-11-25',
      version: 0,
      hiddenAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(await readLaunchRows(NEW_PRODUCT)).toStrictEqual([
      {
        id: newIdOf('NLNC', NEW_PRODUCT),
        launchDate: '2026-11-25',
        outcome: null,
        cancelledAt: null,
      },
    ]);
    expect(await readScreenshotFileIds(NEW_PRODUCT)).toStrictEqual(
      screenshotFileIds,
    );
    expect(calls).toStrictEqual([
      { phase: 'statements', productId: productIdOf(NEW_PRODUCT) },
      { phase: 'after-commit', productId: productIdOf(NEW_PRODUCT) },
    ]);
  });

  test.each([
    ['メールアドレスが未確認', { emailVerifiedAt: null }],
    ['停止中', { status: 'suspended' as const }],
    ['退会済み', { deletedAt: T0 }],
  ])(
    '投稿者が%sなら取り消してaccount-unavailableを返し、確定の後の処理を呼ばない',
    async (_case, columns) => {
      await insertUser(3, { emailVerifiedAt: T0, ...columns });
      const { store, calls } = createTestStore();

      const result = await store.insert(
        insertInputOf(NEW_PRODUCT, userIdOf(3)),
      );

      expect(result).toBe('account-unavailable');
      expect(await readAllProductRows()).toStrictEqual({
        productRows: [],
        launchRows: [],
        screenshotRows: [],
        previousRows: [],
      });
      expect(calls.map(({ phase }) => phase)).not.toContain('after-commit');
    },
  );

  test('同じハンドル(大文字小文字の違いを含む)の同時の2つの登録は一方だけが成功する', async () => {
    const { store } = createTestStore();

    const results = await Promise.all([
      store.insert(
        insertInputOf(11, userIdOf(OWNER), {
          fields: fieldsOf(11, { handle: 'same-handle' }),
        }),
      ),
      store.insert(
        insertInputOf(12, userIdOf(OTHER), {
          fields: fieldsOf(12, { handle: 'Same-Handle' }),
        }),
      ),
    ]);

    expect(results.toSorted()).toStrictEqual(['handle-unavailable', 'saved']);
    const { productRows, launchRows } = await readAllProductRows();
    expect(productRows).toHaveLength(1);
    expect(launchRows.map((row) => row.productId)).toStrictEqual(
      productRows.map((row) => row.id),
    );
  });

  test('論理削除したプロダクトの現在のハンドルとの衝突は取り消してhandle-unavailableを返す', async () => {
    await insertProduct(1, OTHER, { deletedAt: T0 });
    const { store, calls } = createTestStore();
    const before = await readAllProductRows();

    const result = await store.insert(
      insertInputOf(NEW_PRODUCT, userIdOf(OWNER), {
        fields: fieldsOf(NEW_PRODUCT, { handle: 'PRODUCT1' }),
      }),
    );

    expect(result).toBe('handle-unavailable');
    expect(await readAllProductRows()).toStrictEqual(before);
    expect(calls.map(({ phase }) => phase)).not.toContain('after-commit');
  });

  test.each([
    ['他のプロダクト', { deletedAt: null }],
    ['論理削除したプロダクト', { deletedAt: T0 }],
  ])(
    '%sの旧ハンドルを設定すると、同じ一括の書き込みで元の保持者の旧ハンドルの行が消え、解決が新しいプロダクトに移る',
    async (_case, columns) => {
      await insertProduct(1, OTHER, columns);
      await insertProductPreviousHandle(1, 1, 'legacy', {
        deletedAt: columns.deletedAt ?? null,
      });
      await insertProduct(2, OTHER);
      await insertProductPreviousHandle(2, 2, 'kept');
      const { store } = createTestStore();

      const result = await store.insert(
        insertInputOf(NEW_PRODUCT, userIdOf(OWNER), {
          fields: fieldsOf(NEW_PRODUCT, { handle: 'Legacy' }),
        }),
      );

      expect(result).toBe('saved');
      expect(await readPreviousHandles()).toStrictEqual([
        { ownerId: productIdOf(2), handle: 'kept', deletedAt: null },
      ]);
      await expect(
        resolveHandle(db, PRODUCT_HANDLE_NAMESPACE, 'legacy'),
      ).resolves.toStrictEqual({
        kind: 'current',
        ownerId: productIdOf(NEW_PRODUCT),
        handle: 'Legacy',
      });
    },
  );

  test('同時の文を返す処理の例外では何も書き込まず、例外を呼び出し元へ伝える', async () => {
    const failure = new Error('同時の文の失敗');
    const { store, calls } = createTestStore({ statementsError: failure });

    await expect(
      store.insert(insertInputOf(NEW_PRODUCT, userIdOf(OWNER))),
    ).rejects.toBe(failure);
    expect((await readAllProductRows()).productRows).toStrictEqual([]);
    expect(calls.map(({ phase }) => phase)).toStrictEqual(['statements']);
  });

  test('登録した文が実行時に制約に違反すると一括の書き込み全体が取り消され、例外を伝える', async () => {
    const { store, calls } = createTestStore({ violating: true });

    await expect(
      store.insert(
        insertInputOf(NEW_PRODUCT, userIdOf(OWNER), {
          fields: fieldsOf(NEW_PRODUCT, { screenshotFileIds: [fileIdOf(1)] }),
        }),
      ),
    ).rejects.toThrow(/NOT NULL constraint failed: products\.website_url/u);
    expect(await readAllProductRows()).toStrictEqual({
      productRows: [],
      launchRows: [],
      screenshotRows: [],
      previousRows: [],
    });
    expect(calls.map(({ phase }) => phase)).toStrictEqual(['statements']);
  });

  test('確定の後の処理の例外は登録の結果を変えない', async () => {
    const logs = configureRecordingLogs();
    const { store, calls } = createTestStore({
      afterCommitError: new Error('確定の後の失敗'),
    });

    const result = await store.insert(
      insertInputOf(NEW_PRODUCT, userIdOf(OWNER)),
    );

    expect(result).toBe('saved');
    expect(calls.map(({ phase }) => phase)).toStrictEqual([
      'statements',
      'after-commit',
    ]);
    expect(
      logs.filter((log) => log.category === 'api.infrastructure.product'),
    ).toMatchObject([
      {
        level: 'warning',
        message: 'プロダクトの保存の確定の後の処理に失敗しました',
        productId: productIdOf(NEW_PRODUCT),
      },
    ]);
  });

  test('スクリーンショットの行のIDの件数が画像の件数と違えば何も書き込まずに例外にする', async () => {
    const { store } = createTestStore();

    await expect(
      store.insert(
        insertInputOf(NEW_PRODUCT, userIdOf(OWNER), {
          fields: fieldsOf(NEW_PRODUCT, { screenshotFileIds: [fileIdOf(1)] }),
          screenshotIds: [],
        }),
      ),
    ).rejects.toThrow(RangeError);
    expect((await readAllProductRows()).productRows).toStrictEqual([]);
  });
});
