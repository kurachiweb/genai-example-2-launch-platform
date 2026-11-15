import { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../core/directory/identifiers.ts';
import type { DirectoryEntryStore } from '../../core/directory/ports.ts';
import {
  createUlidGenerator,
  type IdGenerator,
} from '../../core/ids/id-generator.ts';
import {
  after,
  db,
  insertProducts,
  insertUsers,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1DirectoryEntryStore } from './d1-directory-entry-store.ts';
import {
  createStatementRecordingDatabase,
  insertIndexDocuments,
  readDirectoryEntries,
  readIndexedProductIds,
} from './testing/directory-entry-fixtures.ts';
import { clearDirectoryTables } from './testing/directory-listing-fixtures.ts';

const OWNER = 1;
const OTHER_OWNER = 2;

const FIRST_WON_AT = after(1_000);
const LATER_WON_AT = after(2_000);

// D1の1文あたりのバインド変数の上限
const MAX_BOUND_PARAMETERS = 100;
// 1行が6個のバインド変数を使うため、40行は1文に収まらず15行ずつの3文になる
const ENTRIES_OVER_BIND_LIMIT = 40;
const STATEMENTS_FOR_OVER_BIND_LIMIT = 3;

function storeOf(database: Database): DirectoryEntryStore {
  const container = new Container();
  container.bind<Database>(PLATFORM_TYPES.Database).toConstantValue(database);
  container
    .bind<IdGenerator>(PLATFORM_TYPES.IdGenerator)
    .toConstantValue(createUlidGenerator({ now: () => T0 }));
  container
    .bind<DirectoryEntryStore>(DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore)
    .to(D1DirectoryEntryStore);
  return container.get<DirectoryEntryStore>(
    DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore,
  );
}

const store = storeOf(db);

function entryOf(product: number, owner = OWNER) {
  return { productId: productIdOf(product), ownerUserId: userIdOf(owner) };
}

beforeEach(async () => {
  await clearDirectoryTables();
  await insertUsers([OWNER, OTHER_OWNER]);
});

describe('record', () => {
  beforeEach(async () => {
    await insertProducts([1, 2], OWNER);
  });

  test('プロダクトと投稿者の記録を、記録の時刻を最初の勝利の日時として作る', async () => {
    await store.record([entryOf(1), entryOf(2)], FIRST_WON_AT);

    expect(await readDirectoryEntries()).toEqual([
      {
        ...entryOf(1),
        firstWonAt: FIRST_WON_AT,
        createdAt: FIRST_WON_AT,
        updatedAt: FIRST_WON_AT,
      },
      {
        ...entryOf(2),
        firstWonAt: FIRST_WON_AT,
        createdAt: FIRST_WON_AT,
        updatedAt: FIRST_WON_AT,
      },
    ]);
  });

  test('記録済みのプロダクトは、重複配信や2回目の勝利でも最初の勝利の日時のまま無視し、残りを記録する', async () => {
    await store.record([entryOf(1)], FIRST_WON_AT);

    await store.record([entryOf(1), entryOf(2)], LATER_WON_AT);

    expect(
      (await readDirectoryEntries()).map(({ productId, firstWonAt }) => ({
        productId,
        firstWonAt,
      })),
    ).toEqual([
      { productId: productIdOf(1), firstWonAt: FIRST_WON_AT },
      { productId: productIdOf(2), firstWonAt: LATER_WON_AT },
    ]);
  });

  test('同じ呼び出しの中で同じプロダクトが重なっても1行だけ記録する', async () => {
    await store.record([entryOf(1), entryOf(1)], FIRST_WON_AT);

    expect(await readDirectoryEntries()).toHaveLength(1);
  });

  test('空の一覧では何も書き込まない', async () => {
    const recording = createStatementRecordingDatabase();

    await storeOf(recording.db).record([], FIRST_WON_AT);

    expect(recording.batchSizes).toEqual([]);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('バインド変数の上限を超える件数も、上限に収まる文に分けて1回の一括の書き込みで全て記録する', async () => {
    const many = Array.from(
      { length: ENTRIES_OVER_BIND_LIMIT },
      (_, index) => index + 10,
    );
    await insertProducts(many, OWNER);
    const recording = createStatementRecordingDatabase();

    await storeOf(recording.db).record(
      many.map((product) => entryOf(product)),
      FIRST_WON_AT,
    );

    expect(recording.batchSizes).toEqual([STATEMENTS_FOR_OVER_BIND_LIMIT]);
    expect(recording.placeholderCounts).toHaveLength(
      STATEMENTS_FOR_OVER_BIND_LIMIT,
    );
    expect(Math.max(...recording.placeholderCounts)).toBeLessThanOrEqual(
      MAX_BOUND_PARAMETERS,
    );
    expect(await readDirectoryEntries()).toHaveLength(many.length);
  });
});

describe('exists', () => {
  test('記録のあるプロダクトだけ真を返す', async () => {
    await insertProducts([1, 2], OWNER);
    await store.record([entryOf(1)], FIRST_WON_AT);

    await expect(store.exists(productIdOf(1))).resolves.toBe(true);
    await expect(store.exists(productIdOf(2))).resolves.toBe(false);
  });
});

describe('listProductIdsByOwner', () => {
  beforeEach(async () => {
    await insertProducts([3, 1, 2], OWNER);
    await insertProducts([4], OTHER_OWNER);
    await store.record(
      [entryOf(3), entryOf(1), entryOf(4, OTHER_OWNER), entryOf(2)],
      FIRST_WON_AT,
    );
  });

  test('投稿者の記録のプロダクトのIDだけを昇順に上限の件数まで返す', async () => {
    await expect(
      store.listProductIdsByOwner(userIdOf(OWNER), undefined, 2),
    ).resolves.toEqual([productIdOf(1), productIdOf(2)]);
  });

  test('指定したIDより後から続きを返し、最後の後は空を返す', async () => {
    await expect(
      store.listProductIdsByOwner(userIdOf(OWNER), productIdOf(2), 2),
    ).resolves.toEqual([productIdOf(3)]);
    await expect(
      store.listProductIdsByOwner(userIdOf(OWNER), productIdOf(3), 2),
    ).resolves.toEqual([]);
  });

  test('記録の無い投稿者には空を返す', async () => {
    await expect(
      store.listProductIdsByOwner(userIdOf(99), undefined, 10),
    ).resolves.toEqual([]);
  });
});

describe('erase', () => {
  beforeEach(async () => {
    await insertProducts([1, 2], OWNER);
    await store.record([entryOf(1), entryOf(2)], FIRST_WON_AT);
    await insertIndexDocuments([productIdOf(1), productIdOf(2)]);
  });

  test('プロダクトの索引文書と記録を1つの一括の書き込みで消し、他のプロダクトは残す', async () => {
    const recording = createStatementRecordingDatabase();

    await storeOf(recording.db).erase(productIdOf(1));

    expect(recording.batchSizes).toEqual([2]);
    expect(recording.placeholderCounts).toHaveLength(2);
    expect(await readIndexedProductIds()).toEqual([productIdOf(2)]);
    expect(
      (await readDirectoryEntries()).map(({ productId }) => productId),
    ).toEqual([productIdOf(2)]);
  });

  test('消した後に同じプロダクトを再び消しても失敗しない', async () => {
    await store.erase(productIdOf(1));

    await expect(store.erase(productIdOf(1))).resolves.toBeUndefined();
    expect(await readIndexedProductIds()).toEqual([productIdOf(2)]);
  });
});
