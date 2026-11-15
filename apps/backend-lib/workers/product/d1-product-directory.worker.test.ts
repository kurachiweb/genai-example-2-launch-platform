import { beforeEach, describe, expect, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import type { ProductLookupScope } from '../../core/product/ports.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1ProductDirectory } from './d1-product-directory.ts';
import {
  after,
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertLaunch,
  insertLaunches,
  insertProduct,
  insertProductPreviousHandle,
  insertProducts,
  insertScreenshot,
  insertUser,
  launchIdOf,
  logoFileIdOf,
  productIdOf,
  T0,
  userIdOf,
} from './testing/product-fixtures.ts';

const BULK_PRODUCT_COUNT = 200;

// 業務時刻(UTC-8)で2026-11-09 23:50。組み合わせの確定(23:45)の後のため、翌日のローンチは組み合わせ済みになる
const NOW = new Date('2026-11-10T07:50:00.000Z');

const directory = new D1ProductDirectory(db);

beforeEach(async () => {
  await clearProductTables();
  await insertUser(1, { handle: 'alice' });
  await insertUser(2, {
    handle: 'bob',
    status: 'suspended',
    suspendedAt: after(1),
  });
  await insertUser(3, { handle: 'carol', deletedAt: after(2) });
  await insertCategory(1, { name: '開発ツール', handle: 'Dev-Tools' });
});

describe('findSummaries', () => {
  beforeEach(async () => {
    await insertProduct(1, 1, {
      handle: 'My-App',
      categoryId: categoryIdOf(1),
    });
    await insertLaunch(1, 1, {
      launchDate: '2026-10-01',
      outcome: 'won',
      decidedAt: after(10),
    });
    await insertProduct(2, 1, { hiddenAt: after(3) });
    await insertLaunch(2, 2, {
      launchDate: '2026-10-01',
      outcome: 'won',
      decidedAt: after(10),
    });
    await insertProduct(3, 2);
    await insertLaunch(3, 3, {
      launchDate: '2026-10-01',
      outcome: 'won',
      decidedAt: after(10),
    });
    await insertProduct(4, 1, { deletedAt: after(4) });
    await insertProduct(5, 3);
    await insertProduct(6, 1);
    await insertLaunch(6, 6, {
      launchDate: '2026-10-01',
      outcome: 'won',
      decidedAt: after(10),
      cancelledAt: after(11),
    });
    await insertLaunch(7, 6, {
      launchDate: '2026-10-02',
      outcome: 'lost',
      decidedAt: after(12),
    });
  });

  test('可視の範囲では、非公開化・論理削除したプロダクトと停止中・退会済みの投稿者のプロダクトを返さない', async () => {
    const found = await directory.findSummaries(
      [1, 2, 3, 4, 5, 6].map(productIdOf),
      'visible',
    );

    expect([...found.keys()].toSorted()).toEqual([
      productIdOf(1),
      productIdOf(6),
    ]);
    expect(found.get(productIdOf(1))).toEqual({
      productId: productIdOf(1),
      ownerUserId: userIdOf(1),
      handle: 'My-App',
      name: 'プロダクト1',
      tagline: 'タグライン1',
      category: {
        id: categoryIdOf(1),
        name: '開発ツール',
        handle: 'Dev-Tools',
      },
      websiteUrl: 'https://product1.example/',
      logoFileId: logoFileIdOf(1),
      hidden: false,
      visible: true,
      listed: true,
      createdAt: T0,
    });
  });

  test('取消でない勝利のローンチが無い可視のプロダクトは掲載済みにならない', async () => {
    const found = await directory.findSummaries([productIdOf(6)], 'visible');

    expect(found.get(productIdOf(6))).toMatchObject({
      visible: true,
      listed: false,
      category: {
        id: PRODUCT_CATEGORY_OTHER_ID,
        name: 'その他',
        handle: 'other',
      },
    });
  });

  test('論理削除済みを除く範囲では、非公開化と停止中・退会済みの投稿者のプロダクトを不可視の印付きで返し、論理削除済みは返さない', async () => {
    const found = await directory.findSummaries(
      [1, 2, 3, 4, 5, 6].map(productIdOf),
      'not-deleted',
    );

    expect([...found.keys()].toSorted()).toEqual(
      [1, 2, 3, 5, 6].map(productIdOf),
    );
    expect(found.get(productIdOf(2))).toMatchObject({
      hidden: true,
      visible: false,
      listed: false,
    });
    expect(found.get(productIdOf(3))).toMatchObject({
      ownerUserId: userIdOf(2),
      hidden: false,
      visible: false,
      listed: false,
    });
    expect(found.get(productIdOf(5))).toMatchObject({
      visible: false,
      listed: false,
    });
  });

  test.each<ProductLookupScope>(['visible', 'not-deleted'])(
    '範囲%sでも存在しないIDは返さず、空の一覧では問い合わせずに空の結果を返す',
    async (scope) => {
      const recording = createRecordingDatabase();
      const recordingDirectory = new D1ProductDirectory(recording.database);

      const found = await directory.findSummaries(
        [productIdOf(1), productIdOf(999)],
        scope,
      );
      const empty = await recordingDirectory.findSummaries([], scope);

      expect([...found.keys()]).toEqual([productIdOf(1)]);
      expect(empty.size).toBe(0);
      expect(recording.placeholderCounts).toEqual([]);
    },
  );

  test('重複したIDは1件にまとめ、90件を超えるIDもバインド変数の上限に収まる文に分けて1件も落とさず引く', async () => {
    const indexes = Array.from(
      { length: BULK_PRODUCT_COUNT },
      (_, offset) => offset + 100,
    );
    await insertProducts(indexes, 1);
    const ids = indexes.flatMap((index) => [
      productIdOf(index),
      productIdOf(index),
    ]);
    const recording = createRecordingDatabase();

    const found = await new D1ProductDirectory(
      recording.database,
    ).findSummaries(ids, 'visible');

    expect(found.size).toBe(BULK_PRODUCT_COUNT);
    expect(found.get(productIdOf(299))?.handle).toBe('product299');
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('resolveHandle', () => {
  test('現在のハンドルは大文字小文字を区別せず、保存されている綴りのプロダクトを返す', async () => {
    await insertProduct(1, 1, { handle: 'My-App' });

    const resolution = await directory.resolveHandle('my-APP');

    expect(resolution).toMatchObject({
      kind: 'current',
      product: { productId: productIdOf(1), handle: 'My-App', visible: true },
    });
  });

  test('旧ハンドルは大文字小文字を区別せず、現在のハンドルを持つプロダクトを返す', async () => {
    await insertProduct(1, 1, { handle: 'new-app' });
    await insertProductPreviousHandle(1, 1, 'Old-App');

    const resolution = await directory.resolveHandle('OLD-app');

    expect(resolution).toMatchObject({
      kind: 'previous',
      product: { productId: productIdOf(1), handle: 'new-app' },
    });
  });

  test('非公開化したプロダクトと停止中の投稿者のプロダクトは不可視の印付きで解決し、可視かどうかを呼び出し元に任せる', async () => {
    await insertProduct(1, 1, { handle: 'hidden-app', hiddenAt: after(1) });
    await insertProduct(2, 2, { handle: 'suspended-app' });

    expect(await directory.resolveHandle('hidden-app')).toMatchObject({
      kind: 'current',
      product: { productId: productIdOf(1), hidden: true, visible: false },
    });
    expect(await directory.resolveHandle('suspended-app')).toMatchObject({
      kind: 'current',
      product: { productId: productIdOf(2), hidden: false, visible: false },
    });
  });

  test('論理削除したプロダクトは、現在のハンドルでも、論理削除されずに残る旧ハンドルでも解決しない', async () => {
    await insertProduct(1, 1, { handle: 'gone-app', deletedAt: after(1) });
    await insertProductPreviousHandle(1, 1, 'gone-old');

    expect(await directory.resolveHandle('gone-app')).toEqual({ kind: 'none' });
    expect(await directory.resolveHandle('gone-old')).toEqual({ kind: 'none' });
  });

  test('論理削除済みの旧ハンドルと存在しないハンドルは解決しない', async () => {
    await insertProduct(1, 1, { handle: 'live-app' });
    await insertProductPreviousHandle(1, 1, 'released', {
      deletedAt: after(1),
    });

    expect(await directory.resolveHandle('released')).toEqual({ kind: 'none' });
    expect(await directory.resolveHandle('nothing')).toEqual({ kind: 'none' });
  });
});

describe('findDetail', () => {
  test('説明文と、スクリーンショットのファイルのIDを位置の順に返す', async () => {
    await insertProduct(1, 1, { descriptionMarkdown: '# 見出し\n\n本文' });
    await insertScreenshot(1, 1, 2, 'file-c');
    await insertScreenshot(2, 1, 0, 'file-a');
    await insertScreenshot(3, 1, 1, 'file-b');

    expect(await directory.findDetail(productIdOf(1))).toEqual({
      productId: productIdOf(1),
      descriptionMarkdown: '# 見出し\n\n本文',
      screenshotFileIds: ['file-a', 'file-b', 'file-c'],
    });
  });

  test('スクリーンショットの無いプロダクトと非公開化したプロダクトも返す', async () => {
    await insertProduct(1, 1, { hiddenAt: after(1) });

    expect(await directory.findDetail(productIdOf(1))).toEqual({
      productId: productIdOf(1),
      descriptionMarkdown: '説明文1',
      screenshotFileIds: [],
    });
  });

  test('論理削除したプロダクトと存在しないプロダクトは返さない', async () => {
    await insertProduct(1, 1, { deletedAt: after(1) });
    await insertScreenshot(1, 1, 0, 'file-a');

    expect(await directory.findDetail(productIdOf(1))).toBeUndefined();
    expect(await directory.findDetail(productIdOf(999))).toBeUndefined();
  });
});

describe('listLaunches', () => {
  test('ローンチ日の新しい順に取消を含めて返し、番号は取消を除いて古い順に数え、状態を照会の時点で導く', async () => {
    await insertProduct(1, 1);
    await insertLaunches([
      {
        index: 1,
        productIndex: 1,
        columns: {
          launchDate: '2026-10-01',
          outcome: 'lost',
          decidedAt: after(1),
        },
      },
      {
        index: 2,
        productIndex: 1,
        columns: { launchDate: '2026-10-05', cancelledAt: after(2) },
      },
      {
        index: 3,
        productIndex: 1,
        columns: {
          launchDate: '2026-10-08',
          outcome: 'won',
          decidedAt: after(3),
        },
      },
      { index: 4, productIndex: 1, columns: { launchDate: '2026-11-10' } },
    ]);

    const launches = await directory.listLaunches([productIdOf(1)], NOW);

    expect(launches.get(productIdOf(1))).toEqual([
      {
        launchId: launchIdOf(4),
        productId: productIdOf(1),
        number: 3,
        launchDate: '2026-11-10',
        status: 'paired',
        outcome: null,
        decidedAt: null,
      },
      {
        launchId: launchIdOf(3),
        productId: productIdOf(1),
        number: 2,
        launchDate: '2026-10-08',
        status: 'finished',
        outcome: 'won',
        decidedAt: after(3),
      },
      {
        launchId: launchIdOf(2),
        productId: productIdOf(1),
        number: 0,
        launchDate: '2026-10-05',
        status: 'canceled',
        outcome: null,
        decidedAt: null,
      },
      {
        launchId: launchIdOf(1),
        productId: productIdOf(1),
        number: 1,
        launchDate: '2026-10-01',
        status: 'finished',
        outcome: 'lost',
        decidedAt: after(1),
      },
    ]);
  });

  test('今日のローンチは進行中、組み合わせの確定の後でも明後日以降のローンチは予定になる', async () => {
    await insertProduct(1, 1);
    await insertProduct(2, 1);
    await insertLaunch(1, 1, { launchDate: '2026-11-09' });
    await insertLaunch(2, 2, { launchDate: '2026-11-11' });

    const launches = await directory.listLaunches(
      [productIdOf(1), productIdOf(2)],
      NOW,
    );

    expect(
      launches.get(productIdOf(1))?.map((launch) => launch.status),
    ).toEqual(['in_progress']);
    expect(
      launches.get(productIdOf(2))?.map((launch) => launch.status),
    ).toEqual(['scheduled']);
  });

  test('論理削除したプロダクトのローンチは返さず、ローンチの無いプロダクトと存在しないIDは結果に含めない', async () => {
    await insertProduct(1, 1, { deletedAt: after(1) });
    await insertLaunch(1, 1, { launchDate: '2026-10-01' });
    await insertProduct(2, 1, { hiddenAt: after(1) });
    await insertLaunch(2, 2, { launchDate: '2026-10-02' });
    await insertProduct(3, 1);

    const launches = await directory.listLaunches(
      [1, 2, 3, 999].map(productIdOf),
      NOW,
    );

    expect([...launches.keys()]).toEqual([productIdOf(2)]);
  });

  test('空の一覧では問い合わせず、90件を超えるIDもバインド変数の上限に収まる文に分けて1件も落とさず引く', async () => {
    const indexes = Array.from(
      { length: BULK_PRODUCT_COUNT },
      (_, offset) => offset + 100,
    );
    await insertProducts(indexes, 1);
    await insertLaunches(
      indexes.map((index) => ({
        index,
        productIndex: index,
        columns: { launchDate: '2026-10-01' },
      })),
    );
    const recording = createRecordingDatabase();
    const recordingDirectory = new D1ProductDirectory(recording.database);

    expect((await recordingDirectory.listLaunches([], NOW)).size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);

    const launches = await recordingDirectory.listLaunches(
      indexes.flatMap((index) => [productIdOf(index), productIdOf(index)]),
      NOW,
    );

    expect(launches.size).toBe(BULK_PRODUCT_COUNT);
    expect(launches.get(productIdOf(299))).toMatchObject([
      { launchId: launchIdOf(299), number: 1 },
    ]);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
