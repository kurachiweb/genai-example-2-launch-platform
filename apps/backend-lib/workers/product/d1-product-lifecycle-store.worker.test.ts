import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import type { ProductLifecycleStore } from '../../core/product/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { createProductLifecycleStore } from './d1-product-lifecycle-store.ts';
import {
  after,
  clearProductTables,
  createSequentialProductEventIds,
  db,
  insertProduct,
  insertProductEvent,
  insertProducts,
  insertUser,
  productEventIdOf,
  productIdOf,
  readProductEvent,
  readProductEventsOf,
  readProductHandlerRuns,
  T0,
  userIdOf,
} from './testing/product-fixtures.ts';

const HANDLER_A = 'product-launch.image-erasure';
const HANDLER_B = 'launch-match.record-unlink';

const DAY = 86_400_000;

// 業務日付2026-11-14の0:00(UTC 8:00)。この時点より前の論理削除だけが対象になる
const BOUNDARY = fromBusinessDateTime(parseBusinessDate('2026-11-14'), {
  hour: 0,
  minute: 0,
});

function beforeBoundary(milliseconds: number): Date {
  return new Date(BOUNDARY.getTime() - milliseconds);
}

function createStore(database: Database = db): ProductLifecycleStore {
  return createProductLifecycleStore(
    database,
    createSequentialProductEventIds(),
  );
}

function indexesUpTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(1);
  await insertUser(2);
  await insertProducts([1, 2, 3], 1);
  await insertProduct(4, 2);
});

describe('createProductLifecycleStoreのイベントの読み取り', () => {
  describe('findEvent', () => {
    test('イベントを投稿者・状態・送信の回数・最後の送信日時とともに返す', async () => {
      await insertProductEvent(1, 4, {
        ownerUserId: userIdOf(2),
        type: 'hidden',
        occurredAt: after(10),
        status: 'completed',
        completedAt: after(30),
        dispatchCount: 3,
        lastDispatchedAt: after(20),
      });

      expect(await createStore().findEvent(productEventIdOf(1))).toEqual({
        id: productEventIdOf(1),
        productId: productIdOf(4),
        ownerUserId: userIdOf(2),
        type: 'hidden',
        occurredAt: after(10),
        status: 'completed',
        dispatchCount: 3,
        lastDispatchedAt: after(20),
      });
    });

    test('無いイベントはundefinedを返す', async () => {
      expect(
        await createStore().findEvent(productEventIdOf(1)),
      ).toBeUndefined();
    });
  });

  describe('findOldestPending', () => {
    test('プロダクトの未完了のイベントのうち発生日時が最も古いものを返し、完了したものと他のプロダクトのものを見ない', async () => {
      await insertProductEvent(1, 1, { occurredAt: T0, status: 'completed' });
      await insertProductEvent(2, 1, { occurredAt: after(20), type: 'hidden' });
      await insertProductEvent(3, 1, {
        occurredAt: after(10),
        type: 'unhidden',
      });
      await insertProductEvent(4, 2, { occurredAt: after(1) });

      expect(
        await createStore().findOldestPending(productIdOf(1)),
      ).toMatchObject({
        id: productEventIdOf(3),
        type: 'unhidden',
        status: 'pending',
      });
    });

    test('発生日時が同じならIDの昇順で最初のものを返す', async () => {
      await insertProductEvent(5, 1, { occurredAt: after(10) });
      await insertProductEvent(4, 1, { occurredAt: after(10) });

      expect(
        await createStore().findOldestPending(productIdOf(1)),
      ).toMatchObject({ id: productEventIdOf(4) });
    });

    test('未完了のイベントが無ければundefinedを返す', async () => {
      await insertProductEvent(1, 1, { status: 'completed' });

      expect(
        await createStore().findOldestPending(productIdOf(1)),
      ).toBeUndefined();
    });
  });
});

describe('createProductLifecycleStoreの完了の記録', () => {
  describe('markHandlerCompleted・completedHandlers', () => {
    test('処理の完了を記録し、イベントごとの完了した処理の名前の集合を返す', async () => {
      await insertProductEvent(1, 1);
      await insertProductEvent(2, 2);
      const store = createStore();

      await store.markHandlerCompleted(
        productEventIdOf(1),
        HANDLER_A,
        after(10),
      );
      await store.markHandlerCompleted(
        productEventIdOf(1),
        HANDLER_B,
        after(20),
      );
      await store.markHandlerCompleted(
        productEventIdOf(2),
        HANDLER_A,
        after(30),
      );

      expect(await store.completedHandlers(productEventIdOf(1))).toEqual(
        new Set([HANDLER_A, HANDLER_B]),
      );
      expect(await store.completedHandlers(productEventIdOf(2))).toEqual(
        new Set([HANDLER_A]),
      );
      expect(await store.completedHandlers(productEventIdOf(3))).toEqual(
        new Set(),
      );
    });

    test('同じ処理の完了の2回目の記録は無視し、最初の完了日時を残す', async () => {
      await insertProductEvent(1, 1);
      const store = createStore();

      await store.markHandlerCompleted(
        productEventIdOf(1),
        HANDLER_A,
        after(10),
      );
      await store.markHandlerCompleted(
        productEventIdOf(1),
        HANDLER_A,
        after(99),
      );

      expect(await readProductHandlerRuns()).toEqual([
        {
          id: productEventIdOf(1000),
          eventId: productEventIdOf(1),
          handlerName: HANDLER_A,
          completedAt: after(10),
        },
      ]);
    });
  });

  describe('markEventCompleted', () => {
    test('未完了のイベントを完了にし、完了日時と更新日時を記録する', async () => {
      await insertProductEvent(1, 1);

      await createStore().markEventCompleted(productEventIdOf(1), after(50));

      expect(await readProductEvent(1)).toMatchObject({
        status: 'completed',
        completedAt: after(50),
        updatedAt: after(50),
        createdAt: T0,
      });
    });

    test('完了済みのイベントの2回目の完了は最初の完了日時を変えない', async () => {
      await insertProductEvent(1, 1);
      const store = createStore();

      await store.markEventCompleted(productEventIdOf(1), after(50));
      await store.markEventCompleted(productEventIdOf(1), after(90));

      expect(await readProductEvent(1)).toMatchObject({
        status: 'completed',
        completedAt: after(50),
        updatedAt: after(50),
      });
    });
  });
});

describe('createProductLifecycleStoreの送り直し', () => {
  describe('listStalePending', () => {
    test('最後の送信が指定の日時より前の未完了のイベントを、最後の送信日時とIDの昇順で上限まで返す', async () => {
      await insertProductEvent(1, 1, { lastDispatchedAt: after(30) });
      await insertProductEvent(2, 4, {
        ownerUserId: userIdOf(2),
        lastDispatchedAt: after(10),
      });
      await insertProductEvent(3, 2, { lastDispatchedAt: after(30) });
      await insertProductEvent(4, 1, {
        lastDispatchedAt: after(5),
        status: 'completed',
      });
      await insertProductEvent(5, 1, { lastDispatchedAt: after(100) });
      await insertProductEvent(6, 3, { lastDispatchedAt: after(31) });

      const stale = await createStore().listStalePending(after(100), 3);

      expect(stale.map((event) => event.id)).toEqual([
        productEventIdOf(2),
        productEventIdOf(1),
        productEventIdOf(3),
      ]);
      expect(stale[0]).toEqual({
        id: productEventIdOf(2),
        productId: productIdOf(4),
        ownerUserId: userIdOf(2),
        type: 'deleted',
        occurredAt: T0,
        status: 'pending',
        dispatchCount: 1,
        lastDispatchedAt: after(10),
      });
    });
  });

  describe('markRedispatched', () => {
    test('指定した未完了のイベントの送信の回数を1増やして最後の送信日時を記録し、完了したものと指定外は変えない', async () => {
      await insertProductEvent(1, 1, { dispatchCount: 2 });
      await insertProductEvent(2, 2, { status: 'completed' });
      await insertProductEvent(3, 3);

      await createStore().markRedispatched(
        [productEventIdOf(1), productEventIdOf(2), productEventIdOf(1)],
        after(DAY),
      );

      expect(await readProductEvent(1)).toMatchObject({
        dispatchCount: 3,
        lastDispatchedAt: after(DAY),
        updatedAt: after(DAY),
      });
      expect(await readProductEvent(2)).toMatchObject({
        dispatchCount: 1,
        lastDispatchedAt: T0,
        updatedAt: T0,
      });
      expect(await readProductEvent(3)).toMatchObject({
        dispatchCount: 1,
        lastDispatchedAt: T0,
      });
    });

    test('空の一覧はD1へ問い合わせない', async () => {
      const { database, placeholderCounts } = createRecordingDatabase();

      await createStore(database).markRedispatched([], after(DAY));

      expect(placeholderCounts).toEqual([]);
    });

    test('91件以上はバインド変数の上限に収まるよう分割し、全件の回数を増やす', async () => {
      const indexes = indexesUpTo(95);
      for (const index of indexes) {
        await insertProductEvent(index, 1);
      }
      const { database, placeholderCounts } = createRecordingDatabase();

      await createStore(database).markRedispatched(
        indexes.map(productEventIdOf),
        after(DAY),
      );

      expectSplitWithinBindLimit(placeholderCounts);
      expect(await readProductEvent(1)).toMatchObject({ dispatchCount: 2 });
      expect(await readProductEvent(95)).toMatchObject({ dispatchCount: 2 });
    });
  });
});

describe('createProductLifecycleStoreの物理削除', () => {
  describe('createPurgeDueEvents', () => {
    test('プロダクトごとに物理削除の時期の到来のイベントを投稿者付き・未完了・送信1回で作り、作ったイベントを返す', async () => {
      const created = await createStore().createPurgeDueEvents(
        [productIdOf(1), productIdOf(4)],
        after(DAY),
      );

      expect(created).toEqual([
        {
          id: productEventIdOf(1000),
          productId: productIdOf(1),
          ownerUserId: userIdOf(1),
          type: 'purge_due',
          occurredAt: after(DAY),
        },
        {
          id: productEventIdOf(1001),
          productId: productIdOf(4),
          ownerUserId: userIdOf(2),
          type: 'purge_due',
          occurredAt: after(DAY),
        },
      ]);
      expect(await readProductEventsOf(1)).toEqual([
        {
          id: productEventIdOf(1000),
          productId: productIdOf(1),
          ownerUserId: userIdOf(1),
          type: 'purge_due',
          occurredAt: after(DAY),
          status: 'pending',
          completedAt: null,
          dispatchCount: 1,
          lastDispatchedAt: after(DAY),
          createdAt: after(DAY),
          updatedAt: after(DAY),
        },
      ]);
    });

    test('2回作成してもプロダクトごとに1件のままで、2回目は作ったイベントを返さない', async () => {
      const store = createStore();
      await store.createPurgeDueEvents([productIdOf(1)], after(DAY));

      const second = await store.createPurgeDueEvents(
        [productIdOf(1), productIdOf(2)],
        after(DAY + 1000),
      );

      expect(second.map((event) => event.productId)).toEqual([productIdOf(2)]);
      expect(await readProductEventsOf(1)).toHaveLength(1);
      expect(await readProductEventsOf(1)).toMatchObject([
        { occurredAt: after(DAY) },
      ]);
    });

    test('同じプロダクトを重ねて指定しても1件だけ作る', async () => {
      const created = await createStore().createPurgeDueEvents(
        [productIdOf(1), productIdOf(1)],
        after(DAY),
      );

      expect(created).toHaveLength(1);
      expect(await readProductEventsOf(1)).toHaveLength(1);
    });

    test('他の種類のイベントがあるプロダクトにも作る', async () => {
      await insertProductEvent(1, 1, { status: 'completed' });

      const created = await createStore().createPurgeDueEvents(
        [productIdOf(1)],
        after(DAY),
      );

      expect(created).toHaveLength(1);
      expect((await readProductEventsOf(1)).map((event) => event.type)).toEqual(
        ['deleted', 'purge_due'],
      );
    });

    test('行の無いプロダクトには作らない', async () => {
      const created = await createStore().createPurgeDueEvents(
        [productIdOf(99), productIdOf(2)],
        after(DAY),
      );

      expect(created.map((event) => event.productId)).toEqual([productIdOf(2)]);
    });

    test('空の一覧はD1へ問い合わせずに空を返す', async () => {
      const { database, placeholderCounts } = createRecordingDatabase();

      expect(
        await createStore(database).createPurgeDueEvents([], after(DAY)),
      ).toEqual([]);
      expect(placeholderCounts).toEqual([]);
    });

    test('多数のプロダクトはバインド変数の上限に収まるよう分割して作る', async () => {
      const indexes = indexesUpTo(100).map((index) => index + 100);
      await insertProducts(indexes, 1);
      const { database, placeholderCounts } = createRecordingDatabase();

      const created = await createStore(database).createPurgeDueEvents(
        indexes.map(productIdOf),
        after(DAY),
      );

      expectSplitWithinBindLimit(placeholderCounts);
      expect(created.map((event) => event.productId)).toEqual(
        indexes.map(productIdOf),
      );
    });
  });

  describe('listPurgeCandidates', () => {
    test('業務日付の境界より前に論理削除し物理削除の時期の到来のイベントが無いプロダクトを、論理削除の日時とIDの昇順で上限まで返す', async () => {
      await clearProductTables();
      await insertUser(1);
      await insertProduct(1, 1, { deletedAt: beforeBoundary(DAY) });
      await insertProduct(2, 1, { deletedAt: beforeBoundary(1) });
      await insertProduct(3, 1);
      await insertProduct(4, 1, { deletedAt: BOUNDARY });
      await insertProduct(5, 1, { deletedAt: beforeBoundary(1) });
      await insertProduct(6, 1, { deletedAt: beforeBoundary(2 * DAY) });
      await insertProductEvent(1, 6, { type: 'purge_due' });
      await insertProduct(7, 1, { deletedAt: beforeBoundary(3 * DAY) });
      await insertProductEvent(2, 7, { type: 'deleted', status: 'completed' });

      const store = createStore();

      expect(await store.listPurgeCandidates(BOUNDARY, 10)).toEqual([
        productIdOf(7),
        productIdOf(1),
        productIdOf(2),
        productIdOf(5),
      ]);
      expect(await store.listPurgeCandidates(BOUNDARY, 2)).toEqual([
        productIdOf(7),
        productIdOf(1),
      ]);
    });
  });

  describe('countOverduePurges', () => {
    test('境界より前に論理削除して行の残るプロダクトを、物理削除の時期の到来のイベントの有無によらず数える', async () => {
      await clearProductTables();
      await insertUser(1);
      await insertProducts([1, 2], 1, { deletedAt: beforeBoundary(1) });
      await insertProductEvent(1, 2, { type: 'purge_due' });
      await insertProduct(3, 1, { deletedAt: BOUNDARY });
      await insertProduct(4, 1);

      const store = createStore();

      expect(await store.countOverduePurges(BOUNDARY)).toBe(2);
      expect(await store.countOverduePurges(beforeBoundary(1))).toBe(0);
    });
  });

  describe('listOwnedProductIds', () => {
    test('利用者の行の残る全プロダクトのIDを論理削除済みを含めてIDの昇順で上限まで返し、他の利用者のものを含めない', async () => {
      await insertProduct(5, 1, { deletedAt: after(DAY) });
      await insertProduct(6, 1, { hiddenAt: after(DAY) });

      const store = createStore();

      expect(await store.listOwnedProductIds(userIdOf(1), 10)).toEqual([
        productIdOf(1),
        productIdOf(2),
        productIdOf(3),
        productIdOf(5),
        productIdOf(6),
      ]);
      expect(await store.listOwnedProductIds(userIdOf(1), 2)).toEqual([
        productIdOf(1),
        productIdOf(2),
      ]);
      expect(await store.listOwnedProductIds(userIdOf(3), 10)).toEqual([]);
    });
  });

  describe('purgeDueCreatedAt', () => {
    test('物理削除の時期の到来のイベントがあるプロダクトだけについて、その作成日時を返す', async () => {
      await insertProductEvent(1, 1, {
        type: 'purge_due',
        createdAt: after(DAY),
      });
      await insertProductEvent(2, 2, { type: 'deleted', createdAt: after(5) });
      await insertProductEvent(3, 4, {
        type: 'purge_due',
        createdAt: after(2 * DAY),
        status: 'completed',
      });

      const createdAt = await createStore().purgeDueCreatedAt([
        productIdOf(1),
        productIdOf(2),
        productIdOf(4),
        productIdOf(99),
      ]);

      expect(createdAt).toEqual(
        new Map([
          [productIdOf(1), after(DAY)],
          [productIdOf(4), after(2 * DAY)],
        ]),
      );
    });

    test('空の一覧はD1へ問い合わせずに空を返す', async () => {
      const { database, placeholderCounts } = createRecordingDatabase();

      expect(await createStore(database).purgeDueCreatedAt([])).toEqual(
        new Map(),
      );
      expect(placeholderCounts).toEqual([]);
    });

    test('91件以上はバインド変数の上限に収まるよう分割して全件を引く', async () => {
      const indexes = indexesUpTo(95).map((index) => index + 100);
      await insertProducts(indexes, 1);
      await createStore().createPurgeDueEvents(
        indexes.map(productIdOf),
        after(DAY),
      );
      const { database, placeholderCounts } = createRecordingDatabase();

      const createdAt = await createStore(database).purgeDueCreatedAt(
        indexes.map(productIdOf),
      );

      expectSplitWithinBindLimit(placeholderCounts);
      expect(createdAt.size).toBe(95);
    });
  });
});
