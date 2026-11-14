import { beforeEach, describe, expect, test } from 'vitest';

import {
  createRecordingDatabase,
  expectWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1ActivationStore } from './d1-activation-store.ts';
import { D1SubscriptionStore } from './d1-subscription-store.ts';
import {
  activationIdOf,
  after,
  clearUltrasTables,
  db,
  insertActivationRow,
  insertActivationRows,
  insertUser,
  newActivationRow,
  purchaseIdOf,
  readActivationIds,
  readActivationRow,
  stripeSubscriptionIdOf,
  subscriptionIdOf,
  T0,
  userIdOf,
} from './testing/ultras-store-fixtures.ts';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const store = new D1ActivationStore(db);

function insertInputOf(index: number, userIndex = 1) {
  return {
    id: activationIdOf(index),
    userId: userIdOf(userIndex),
    stripeSubscriptionId: stripeSubscriptionIdOf(index),
    activatedAt: T0,
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

beforeEach(async () => {
  await clearUltrasTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1ActivationStoreの知らせの行の追加', () => {
  test('追加した知らせをIDと定期課金のIDで、未送り出し・未完了の状態とともに返す', async () => {
    await db.batch([store.insertIfAbsent(insertInputOf(1))]);

    const found = await store.findById(activationIdOf(1));
    expect(found).toMatchObject({
      id: activationIdOf(1),
      userId: userIdOf(1),
      stripeSubscriptionId: stripeSubscriptionIdOf(1),
      activatedAt: T0,
      dispatchedAt: null,
      completedAt: null,
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(await store.findByStripeId(stripeSubscriptionIdOf(1))).toEqual(
      found,
    );
    expect(await store.findById(activationIdOf(2))).toBeUndefined();
    expect(
      await store.findByStripeId(stripeSubscriptionIdOf(2)),
    ).toBeUndefined();
  });

  test('同じ定期課金のIDの2つ目の追加は別の一括の書き込みでも無視し、最初の行を保つ', async () => {
    await db.batch([store.insertIfAbsent(insertInputOf(1))]);

    await db.batch([
      store.insertIfAbsent({
        ...insertInputOf(1, 2),
        id: activationIdOf(2),
        activatedAt: after(DAY),
      }),
    ]);

    expect(await store.findById(activationIdOf(2))).toBeUndefined();
    expect(await store.findByStripeId(stripeSubscriptionIdOf(1))).toMatchObject(
      {
        id: activationIdOf(1),
        userId: userIdOf(1),
        activatedAt: T0,
      },
    );
  });

  test('加入の有効化と同じ一括の書き込みで確定し、有効化が失敗すれば知らせの行も残らない', async () => {
    const subscriptions = new D1SubscriptionStore(db);
    const activationOf = (index: number) => ({
      id: subscriptionIdOf(index),
      stripeSubscriptionId: stripeSubscriptionIdOf(index),
      userId: userIdOf(1),
      purchaseId: purchaseIdOf(index),
      startedAt: T0,
    });
    await db.batch([
      store.insertIfAbsent(insertInputOf(1)),
      subscriptions.activate(activationOf(1)),
    ]);

    await expect(
      db.batch([
        store.insertIfAbsent(insertInputOf(2)),
        subscriptions.activate(activationOf(2)),
      ]),
    ).rejects.toThrow(
      /UNIQUE constraint failed: ultras_subscriptions\.user_id/u,
    );

    expect(await store.findById(activationIdOf(1))).toBeDefined();
    expect(await store.findById(activationIdOf(2))).toBeUndefined();
  });
});

describe('D1ActivationStoreの送り出しと完了の記録', () => {
  test('送り出しの記録は送り出しの時刻を書き、送り出し直しでは改める', async () => {
    await insertActivationRows([
      newActivationRow(1),
      newActivationRow(2, { userId: userIdOf(2) }),
    ]);

    await store.markDispatched(activationIdOf(1), after(MINUTE));
    expect((await store.findById(activationIdOf(1)))?.dispatchedAt).toEqual(
      after(MINUTE),
    );

    await store.markDispatched(activationIdOf(1), after(DAY));
    const redispatched = await readActivationRow(activationIdOf(1));
    expect(redispatched).toMatchObject({
      dispatchedAt: after(DAY),
      completedAt: null,
    });
    expect(redispatched?.updatedAt.getTime()).toBeGreaterThan(T0.getTime());
    expect(await readActivationRow(activationIdOf(2))).toMatchObject({
      dispatchedAt: null,
      updatedAt: T0,
    });
  });

  test('完了の記録は完了の時刻を書き、2回目は最初の時刻を保つ', async () => {
    await insertActivationRows([
      newActivationRow(1, { dispatchedAt: after(MINUTE) }),
      newActivationRow(2),
    ]);

    await store.markCompleted(activationIdOf(1), after(2 * MINUTE));
    await store.markCompleted(activationIdOf(1), after(HOUR));

    expect(await store.findById(activationIdOf(1))).toMatchObject({
      dispatchedAt: after(MINUTE),
      completedAt: after(2 * MINUTE),
    });
    expect((await store.findById(activationIdOf(2)))?.completedAt).toBeNull();
  });
});

describe('D1ActivationStoreの送り出し直しの対象', () => {
  const now = after(30 * DAY);
  const createdBefore = new Date(now.getTime() - 10 * MINUTE);
  const redispatchBefore = new Date(now.getTime() - 24 * HOUR);

  beforeEach(async () => {
    await insertActivationRows([
      newActivationRow(1, { createdAt: createdBefore }),
      newActivationRow(2, {
        createdAt: new Date(createdBefore.getTime() + 1),
      }),
      newActivationRow(3, {
        createdAt: after(25 * DAY),
        dispatchedAt: redispatchBefore,
      }),
      newActivationRow(4, {
        createdAt: after(25 * DAY),
        dispatchedAt: new Date(redispatchBefore.getTime() + 1),
      }),
      newActivationRow(5, {
        createdAt: after(25 * DAY),
        dispatchedAt: after(28 * DAY),
        completedAt: after(29 * DAY),
      }),
      newActivationRow(6, {
        createdAt: after(24 * DAY),
        completedAt: after(29 * DAY),
      }),
      newActivationRow(7, {
        userId: userIdOf(2),
        createdAt: after(23 * DAY),
        dispatchedAt: after(27 * DAY),
      }),
    ]);
  });

  test('未送り出しで作成から10分以上、または送り出しから24時間以上で未完了の知らせを作成の古い順に返し、完了した知らせと直近の知らせを返さない', async () => {
    const found = await store.findUndispatched({
      createdBefore,
      redispatchBefore,
      limit: 100,
    });

    expect(found.map(({ id }) => id)).toEqual([
      activationIdOf(7),
      activationIdOf(3),
      activationIdOf(1),
    ]);
  });

  test('上限の件数で止める', async () => {
    const found = await store.findUndispatched({
      createdBefore,
      redispatchBefore,
      limit: 2,
    });

    expect(found.map(({ id }) => id)).toEqual([
      activationIdOf(7),
      activationIdOf(3),
    ]);
  });
});

describe('D1ActivationStoreの完了した知らせの削除', () => {
  test('完了から指定の日時以前の知らせだけを完了の古い順に上限の件数まで消し、消した件数を返す', async () => {
    await insertActivationRows([
      newActivationRow(1, { dispatchedAt: T0, completedAt: after(3 * DAY) }),
      newActivationRow(2, { dispatchedAt: T0, completedAt: after(DAY) }),
      newActivationRow(3, { dispatchedAt: T0, completedAt: after(2 * DAY) }),
      newActivationRow(4, { dispatchedAt: T0 }),
      newActivationRow(5, {
        dispatchedAt: T0,
        completedAt: after(3 * DAY + 1),
      }),
    ]);

    expect(await store.deleteCompletedBefore(after(3 * DAY), 2)).toBe(2);
    expect(await readActivationIds()).toEqual([1, 4, 5].map(activationIdOf));

    expect(await store.deleteCompletedBefore(after(3 * DAY), 2)).toBe(1);
    expect(await store.deleteCompletedBefore(after(3 * DAY), 2)).toBe(0);
    expect(await readActivationIds()).toEqual([4, 5].map(activationIdOf));
  });

  test('上限が90件を超えても1つの文で消し、バインド変数の上限に収まる', async () => {
    await insertActivationRows(
      range(1, 95).map((index) =>
        newActivationRow(index, {
          dispatchedAt: T0,
          completedAt: after(index),
        }),
      ),
    );
    await insertActivationRow(newActivationRow(96, { dispatchedAt: T0 }));
    const { database, placeholderCounts } = createRecordingDatabase();

    expect(
      await new D1ActivationStore(database).deleteCompletedBefore(
        after(DAY),
        95,
      ),
    ).toBe(95);

    expect(placeholderCounts).toHaveLength(1);
    expectWithinBindLimit(placeholderCounts);
    expect(await readActivationIds()).toEqual([activationIdOf(96)]);
  });
});

describe('D1ActivationStoreの利用者の行の削除', () => {
  test('削除の文は利用者の知らせだけを消す', async () => {
    await insertActivationRows([
      newActivationRow(1),
      newActivationRow(2, { dispatchedAt: T0, completedAt: after(DAY) }),
      newActivationRow(3, { userId: userIdOf(2) }),
    ]);

    await db.batch([store.deleteByUser(userIdOf(1))]);

    expect(await readActivationIds()).toEqual([activationIdOf(3)]);
  });
});
