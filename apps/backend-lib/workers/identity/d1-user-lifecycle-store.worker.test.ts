import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import type { UserLifecycleStore } from '../../core/identity/ports.ts';
import { createUserLifecycleStore } from './d1-user-lifecycle-store.ts';
import {
  after,
  clearIdentityTables,
  createRecordingDatabase,
  createSequentialIds,
  db,
  eventIdOf,
  expectSplitWithinBindLimit,
  insertEvent,
  insertEvents,
  insertUser,
  insertUsers,
  readEvent,
  readEventsOf,
  readHandlerRuns,
  T0,
  userIdOf,
} from './testing/identity-store-fixtures.ts';

const HANDLER_A = 'identity-auth.email-suppression-cleanup';
const HANDLER_B = 'user-profile-social.profile-purge';

const DAY = 86_400_000;

function createStore(database: Database = db): UserLifecycleStore {
  return createUserLifecycleStore(database, createSequentialIds());
}

function indexesUpTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('createUserLifecycleStoreのイベントの読み取り', () => {
  describe('findEvent', () => {
    test('イベントを状態・送信の回数・最後の送信日時とともに返す', async () => {
      await insertEvent(1, {
        userId: userIdOf(2),
        type: 'suspended',
        occurredAt: after(10),
        status: 'completed',
        completedAt: after(30),
        dispatchCount: 3,
        lastDispatchedAt: after(20),
      });

      expect(await createStore().findEvent(eventIdOf(1))).toEqual({
        id: eventIdOf(1),
        userId: userIdOf(2),
        type: 'suspended',
        occurredAt: after(10),
        status: 'completed',
        dispatchCount: 3,
        lastDispatchedAt: after(20),
      });
    });

    test('無いイベントはundefinedを返す', async () => {
      expect(await createStore().findEvent(eventIdOf(1))).toBeUndefined();
    });
  });

  describe('findOldestPending', () => {
    test('利用者の未完了のイベントのうち発生日時が最も古いものを返し、完了したものと他の利用者のものを見ない', async () => {
      await insertEvent(1, { occurredAt: T0, status: 'completed' });
      await insertEvent(2, { occurredAt: after(20), type: 'suspended' });
      await insertEvent(3, { occurredAt: after(10), type: 'withdrawn' });
      await insertEvent(4, { occurredAt: after(1), userId: userIdOf(2) });

      expect(await createStore().findOldestPending(userIdOf(1))).toMatchObject({
        id: eventIdOf(3),
        status: 'pending',
      });
    });

    test('発生日時が同じならIDの昇順で最初のものを返す', async () => {
      await insertEvent(5, { occurredAt: after(10) });
      await insertEvent(4, { occurredAt: after(10) });

      expect(await createStore().findOldestPending(userIdOf(1))).toMatchObject({
        id: eventIdOf(4),
      });
    });

    test('未完了のイベントが無ければundefinedを返す', async () => {
      await insertEvent(1, { status: 'completed' });

      expect(
        await createStore().findOldestPending(userIdOf(1)),
      ).toBeUndefined();
    });
  });
});

describe('createUserLifecycleStoreの完了の記録', () => {
  describe('markHandlerCompleted・completedHandlers', () => {
    test('波及処理の完了を記録し、イベントごとの完了した波及処理の名前の集合を返す', async () => {
      await insertEvents([1, 2]);
      const store = createStore();

      await store.markHandlerCompleted(eventIdOf(1), HANDLER_A, after(10));
      await store.markHandlerCompleted(eventIdOf(1), HANDLER_B, after(20));
      await store.markHandlerCompleted(eventIdOf(2), HANDLER_A, after(30));

      expect(await store.completedHandlers(eventIdOf(1))).toEqual(
        new Set([HANDLER_A, HANDLER_B]),
      );
      expect(await store.completedHandlers(eventIdOf(2))).toEqual(
        new Set([HANDLER_A]),
      );
      expect(await store.completedHandlers(eventIdOf(3))).toEqual(new Set());
    });

    test('同じ波及処理の完了の2回目の記録は無視し、最初の完了日時を残す', async () => {
      await insertEvent(1);
      const store = createStore();

      await store.markHandlerCompleted(eventIdOf(1), HANDLER_A, after(10));
      await store.markHandlerCompleted(eventIdOf(1), HANDLER_A, after(99));

      expect(await readHandlerRuns()).toEqual([
        {
          id: eventIdOf(1000),
          eventId: eventIdOf(1),
          handlerName: HANDLER_A,
          completedAt: after(10),
        },
      ]);
    });
  });

  describe('markEventCompleted', () => {
    test('未完了のイベントを完了にし、完了日時と更新日時を記録する', async () => {
      await insertEvent(1);

      await createStore().markEventCompleted(eventIdOf(1), after(50));

      expect(await readEvent(1)).toMatchObject({
        status: 'completed',
        completedAt: after(50),
        updatedAt: after(50),
        createdAt: T0,
      });
    });

    test('完了済みのイベントの2回目の完了は最初の完了日時を変えない', async () => {
      await insertEvent(1);
      const store = createStore();

      await store.markEventCompleted(eventIdOf(1), after(50));
      await store.markEventCompleted(eventIdOf(1), after(90));

      expect(await readEvent(1)).toMatchObject({
        status: 'completed',
        completedAt: after(50),
        updatedAt: after(50),
      });
    });
  });
});

describe('createUserLifecycleStoreの送り直し', () => {
  describe('listStalePending', () => {
    test('最後の送信が指定の日時より前の未完了のイベントを、最後の送信日時とIDの昇順で上限まで返す', async () => {
      await insertEvent(1, { lastDispatchedAt: after(30) });
      await insertEvent(2, {
        lastDispatchedAt: after(10),
        userId: userIdOf(2),
      });
      await insertEvent(3, {
        lastDispatchedAt: after(30),
        userId: userIdOf(3),
      });
      await insertEvent(4, { lastDispatchedAt: after(5), status: 'completed' });
      await insertEvent(5, { lastDispatchedAt: after(100) });
      await insertEvent(6, {
        lastDispatchedAt: after(31),
        userId: userIdOf(4),
      });

      const stale = await createStore().listStalePending(after(100), 3);

      expect(stale.map((event) => event.id)).toEqual([
        eventIdOf(2),
        eventIdOf(1),
        eventIdOf(3),
      ]);
      expect(stale[0]).toEqual({
        id: eventIdOf(2),
        userId: userIdOf(2),
        type: 'withdrawn',
        occurredAt: T0,
        status: 'pending',
        dispatchCount: 1,
        lastDispatchedAt: after(10),
      });
    });
  });

  describe('markRedispatched', () => {
    test('指定した未完了のイベントの送信の回数を1増やして最後の送信日時を記録し、完了したものと指定外は変えない', async () => {
      await insertEvent(1, { dispatchCount: 2 });
      await insertEvent(2, { status: 'completed' });
      await insertEvent(3);

      await createStore().markRedispatched(
        [eventIdOf(1), eventIdOf(2), eventIdOf(1)],
        after(DAY),
      );

      expect(await readEvent(1)).toMatchObject({
        dispatchCount: 3,
        lastDispatchedAt: after(DAY),
        updatedAt: after(DAY),
      });
      expect(await readEvent(2)).toMatchObject({
        dispatchCount: 1,
        lastDispatchedAt: T0,
        updatedAt: T0,
      });
      expect(await readEvent(3)).toMatchObject({
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
      await insertEvents(indexes);
      const { database, placeholderCounts } = createRecordingDatabase();

      await createStore(database).markRedispatched(
        indexes.map(eventIdOf),
        after(DAY),
      );

      expectSplitWithinBindLimit(placeholderCounts);
      expect(await readEvent(1)).toMatchObject({ dispatchCount: 2 });
      expect(await readEvent(95)).toMatchObject({ dispatchCount: 2 });
    });
  });
});

describe('createUserLifecycleStoreの物理削除', () => {
  describe('createPurgeDueEvents', () => {
    test('利用者ごとに物理削除の開始のイベントを未完了・送信1回で作り、作ったイベントを返す', async () => {
      const store = createStore();

      const created = await store.createPurgeDueEvents(
        [userIdOf(1), userIdOf(2)],
        after(DAY),
      );

      expect(created).toEqual([
        {
          id: eventIdOf(1000),
          userId: userIdOf(1),
          type: 'purge_due',
          occurredAt: after(DAY),
        },
        {
          id: eventIdOf(1001),
          userId: userIdOf(2),
          type: 'purge_due',
          occurredAt: after(DAY),
        },
      ]);
      expect(await readEventsOf(1)).toEqual([
        {
          id: eventIdOf(1000),
          userId: userIdOf(1),
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

    test('同じ日に2回作成しても利用者ごとに1件のままで、2回目は作ったイベントを返さない', async () => {
      const store = createStore();
      await store.createPurgeDueEvents([userIdOf(1)], after(DAY));

      const second = await store.createPurgeDueEvents(
        [userIdOf(1), userIdOf(2)],
        after(DAY + 1000),
      );

      expect(second.map((event) => event.userId)).toEqual([userIdOf(2)]);
      expect(await readEventsOf(1)).toHaveLength(1);
      expect(await readEventsOf(1)).toMatchObject([{ occurredAt: after(DAY) }]);
    });

    test('同じ利用者を重ねて指定しても1件だけ作る', async () => {
      const created = await createStore().createPurgeDueEvents(
        [userIdOf(1), userIdOf(1)],
        after(DAY),
      );

      expect(created).toHaveLength(1);
      expect(await readEventsOf(1)).toHaveLength(1);
    });

    test('他の種類のイベントがある利用者にも物理削除の開始のイベントを作る', async () => {
      await insertEvent(1, { type: 'withdrawn', status: 'completed' });

      const created = await createStore().createPurgeDueEvents(
        [userIdOf(1)],
        after(DAY),
      );

      expect(created).toHaveLength(1);
      expect((await readEventsOf(1)).map((event) => event.type)).toEqual([
        'withdrawn',
        'purge_due',
      ]);
    });

    test('空の一覧はD1へ問い合わせずに空を返す', async () => {
      const { database, placeholderCounts } = createRecordingDatabase();

      expect(
        await createStore(database).createPurgeDueEvents([], after(DAY)),
      ).toEqual([]);
      expect(placeholderCounts).toEqual([]);
    });

    test('多数の利用者はバインド変数の上限に収まるよう分割して作る', async () => {
      const indexes = indexesUpTo(50);
      const { database, placeholderCounts } = createRecordingDatabase();

      const created = await createStore(database).createPurgeDueEvents(
        indexes.map(userIdOf),
        after(DAY),
      );

      expectSplitWithinBindLimit(placeholderCounts);
      expect(created.map((event) => event.userId)).toEqual(
        indexes.map(userIdOf),
      );
    });
  });

  describe('listPurgeCandidates', () => {
    test('指定の日時より前に退会し物理削除を始めていない利用者を、退会日時とIDの昇順で上限まで返す', async () => {
      await insertUser(1, { deletedAt: after(DAY) });
      await insertUser(2, { deletedAt: after(DAY / 2) });
      await insertUser(3);
      await insertUser(4, { deletedAt: after(13 * DAY) });
      await insertUser(5, { deletedAt: after(DAY / 2) });
      await insertUser(6, { deletedAt: T0 });
      await insertEvent(1, { userId: userIdOf(6), type: 'purge_due' });
      await insertUser(7, { deletedAt: after(2 * DAY) });
      await insertEvent(2, { userId: userIdOf(7), type: 'withdrawn' });

      const store = createStore();

      expect(await store.listPurgeCandidates(after(13 * DAY), 10)).toEqual([
        userIdOf(2),
        userIdOf(5),
        userIdOf(1),
        userIdOf(7),
      ]);
      expect(await store.listPurgeCandidates(after(13 * DAY), 2)).toEqual([
        userIdOf(2),
        userIdOf(5),
      ]);
    });
  });

  describe('countOverduePurges', () => {
    test('指定の日時より前に退会して物理削除が終わっていない利用者を、物理削除の開始の有無によらず数える', async () => {
      await insertUsers([1, 2], { deletedAt: T0 });
      await insertEvent(1, { userId: userIdOf(2), type: 'purge_due' });
      await insertUser(3, { deletedAt: after(14 * DAY) });
      await insertUser(4);

      const store = createStore();

      expect(await store.countOverduePurges(after(14 * DAY))).toBe(2);
      expect(await store.countOverduePurges(T0)).toBe(0);
    });
  });
});
