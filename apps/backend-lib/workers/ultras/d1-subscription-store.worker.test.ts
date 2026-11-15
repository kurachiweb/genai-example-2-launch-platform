import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import {
  CANCELLATION_SOURCE_VALUES,
  PENDING_CANCELLATION_SOURCE_VALUES,
  STRIPE_SUBSCRIPTION_STATUS_VALUES,
} from '../../../db/schema/ultras/ultras-subscriptions.ts';
import type {
  CancellationSource,
  StripeSubscriptionStatus,
} from '../../core/ultras/entitlement-rules.ts';
import type { SubscriptionRow } from '../../core/ultras/ports.ts';
import { ENDED_STRIPE_STATUSES } from '../../core/ultras/subscription-transition.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1SubscriptionStore } from './d1-subscription-store.ts';
import {
  activatedSubscriptionRow,
  after,
  clearUltrasTables,
  db,
  insertSubscriptionRow,
  insertSubscriptionRows,
  insertUser,
  insertUsers,
  newSubscriptionRow,
  purchaseIdOf,
  readSubscriptionRow,
  stripeSubscriptionIdOf,
  subscriptionIdOf,
  T0,
  userIdOf,
} from './testing/ultras-store-fixtures.ts';

const DAY = 86_400_000;

const store = new D1SubscriptionStore(db);

function activationOf(index: number, userIndex: number, startedAt = T0) {
  return {
    id: subscriptionIdOf(index),
    stripeSubscriptionId: stripeSubscriptionIdOf(index),
    userId: userIdOf(userIndex),
    purchaseId: purchaseIdOf(index),
    startedAt,
  };
}

function idsOf(rows: readonly SubscriptionRow[]): string[] {
  return rows.map(({ id }) => id);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

beforeEach(async () => {
  await clearUltrasTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1SubscriptionStoreのStripe側の値の更新', () => {
  test('無い定期課金は未有効の行として挿入し、定期課金のIDで引ける', async () => {
    const row = newSubscriptionRow(1, {
      stripeStatus: 'incomplete',
      currentPeriodEnd: after(30 * DAY),
    });

    await db.batch([store.upsertStripeState({ row })]);

    expect(await store.findByStripeId(stripeSubscriptionIdOf(1))).toEqual(row);
    expect(await readSubscriptionRow(stripeSubscriptionIdOf(1))).toMatchObject({
      startedAt: null,
      purchaseId: null,
      userId: userIdOf(1),
    });
    expect(
      await store.findByStripeId(stripeSubscriptionIdOf(2)),
    ).toBeUndefined();
  });

  test('有効化された行への更新はStripe側の列だけを書き、ID・開始時刻・利用者・購入IDを保つ', async () => {
    await db.batch([store.activate(activationOf(1, 1))]);
    const before = await readSubscriptionRow(stripeSubscriptionIdOf(1));

    await db.batch([
      store.upsertStripeState({
        row: newSubscriptionRow(1, {
          id: subscriptionIdOf(9),
          userId: userIdOf(2),
          stripeStatus: 'past_due',
          cancelScheduled: true,
          cancelAt: after(20 * DAY),
          currentPeriodEnd: after(20 * DAY),
          benefitEndsAt: after(21 * DAY),
          canceledAt: after(DAY),
          cancellationSource: 'user',
          pendingCancellationSource: 'suspension',
          pastDueSince: after(2 * DAY),
        }),
      }),
    ]);

    const updated = await readSubscriptionRow(stripeSubscriptionIdOf(1));
    expect(updated).toMatchObject({
      id: subscriptionIdOf(1),
      userId: userIdOf(1),
      purchaseId: purchaseIdOf(1),
      startedAt: T0,
      stripeStatus: 'past_due',
      cancelScheduled: true,
      cancelAt: after(20 * DAY),
      currentPeriodEnd: after(20 * DAY),
      benefitEndsAt: after(21 * DAY),
      benefitEndFixed: false,
      canceledAt: after(DAY),
      cancellationSource: 'user',
      pendingCancellationSource: 'suspension',
      pastDueSince: after(2 * DAY),
    });
    expect(updated?.createdAt).toEqual(before?.createdAt);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before?.updatedAt.getTime() ?? Number.NaN,
    );
    expect(await store.findByStripeId(stripeSubscriptionIdOf(1))).toMatchObject(
      {
        id: subscriptionIdOf(1),
        stripeStatus: 'past_due',
        startedAt: T0,
      },
    );
  });
});

describe('D1SubscriptionStoreの有効化', () => {
  test('無い定期課金は有効の状態で挿入し、開始時刻・利用者・購入IDを持つ', async () => {
    await db.batch([store.activate(activationOf(1, 1, after(DAY)))]);

    expect(await store.findByStripeId(stripeSubscriptionIdOf(1))).toEqual(
      activatedSubscriptionRow(1, { startedAt: after(DAY) }),
    );
  });

  test('sinkが先に作った行には開始時刻・利用者・購入IDだけを書き、Stripe側の値を保つ', async () => {
    await insertSubscriptionRow(
      newSubscriptionRow(1, {
        stripeStatus: 'past_due',
        cancelScheduled: true,
        cancelAt: after(20 * DAY),
        currentPeriodEnd: after(20 * DAY),
        benefitEndsAt: after(21 * DAY),
      }),
    );

    await db.batch([store.activate(activationOf(1, 1, after(DAY)))]);

    expect(await store.findByStripeId(stripeSubscriptionIdOf(1))).toEqual(
      newSubscriptionRow(1, {
        purchaseId: purchaseIdOf(1),
        startedAt: after(DAY),
        stripeStatus: 'past_due',
        cancelScheduled: true,
        cancelAt: after(20 * DAY),
        currentPeriodEnd: after(20 * DAY),
        benefitEndsAt: after(21 * DAY),
      }),
    );
    expect(
      (
        await readSubscriptionRow(stripeSubscriptionIdOf(1))
      )?.updatedAt.getTime(),
    ).toBeGreaterThan(T0.getTime());
  });

  test('同じ利用者の2つの加入の同時の有効化は部分一意索引の違反で一括の書き込み全体が失敗し、どちらの行も残らない', async () => {
    await expect(
      db.batch([
        store.activate(activationOf(1, 1)),
        store.activate(activationOf(2, 1, after(DAY))),
      ]),
    ).rejects.toThrow(
      /UNIQUE constraint failed: ultras_subscriptions\.user_id/u,
    );

    expect(
      await store.findByStripeId(stripeSubscriptionIdOf(1)),
    ).toBeUndefined();
    expect(
      await store.findByStripeId(stripeSubscriptionIdOf(2)),
    ).toBeUndefined();
  });

  test('特典の継続期間が開いた加入を持つ利用者の別の加入の有効化は失敗し、特典が終わった加入なら有効化できる', async () => {
    await db.batch([store.activate(activationOf(1, 1))]);

    await expect(
      db.batch([store.activate(activationOf(2, 1, after(DAY)))]),
    ).rejects.toThrow(
      /UNIQUE constraint failed: ultras_subscriptions\.user_id/u,
    );
    expect(
      await store.findByStripeId(stripeSubscriptionIdOf(2)),
    ).toBeUndefined();

    await db.batch([
      store.upsertStripeState({
        row: activatedSubscriptionRow(1, {
          stripeStatus: 'canceled',
          endedAt: after(DAY),
          benefitEndsAt: after(DAY),
          benefitEndFixed: true,
        }),
      }),
      store.activate(activationOf(2, 1, after(DAY))),
    ]);

    expect(await store.findByStripeId(stripeSubscriptionIdOf(2))).toMatchObject(
      {
        userId: userIdOf(1),
        startedAt: after(DAY),
      },
    );
  });
});

describe('D1SubscriptionStoreの時点の重なりの検索', () => {
  beforeEach(async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, {
        stripeStatus: 'canceled',
        startedAt: T0,
        benefitEndsAt: after(10 * DAY),
        benefitEndFixed: true,
      }),
      activatedSubscriptionRow(2, { startedAt: after(10 * DAY) }),
      activatedSubscriptionRow(3, { userId: userIdOf(2), startedAt: T0 }),
      newSubscriptionRow(4, { stripeStatus: 'active' }),
    ]);
  });

  test('特典の継続期間に時点を含む加入を返し、開始時刻を含め終了時刻を含めない', async () => {
    const at = (milliseconds: number) =>
      store.findEntitledOverlapping({
        userId: userIdOf(1),
        at: after(milliseconds),
      });

    expect(await at(-1)).toBeUndefined();
    expect((await at(0))?.id).toBe(subscriptionIdOf(1));
    expect((await at(10 * DAY - 1))?.id).toBe(subscriptionIdOf(1));
    expect((await at(10 * DAY))?.id).toBe(subscriptionIdOf(2));
    expect((await at(400 * DAY))?.id).toBe(subscriptionIdOf(2));
  });

  test('指定した定期課金のIDの加入を除き、他の利用者の加入と未有効の行を含めない', async () => {
    expect(
      await store.findEntitledOverlapping({
        userId: userIdOf(1),
        at: after(20 * DAY),
        excludeStripeId: stripeSubscriptionIdOf(2),
      }),
    ).toBeUndefined();
    expect(
      (
        await store.findEntitledOverlapping({
          userId: userIdOf(1),
          at: after(5 * DAY),
          excludeStripeId: stripeSubscriptionIdOf(2),
        })
      )?.id,
    ).toBe(subscriptionIdOf(1));
    expect(
      (
        await store.findEntitledOverlapping({
          userId: userIdOf(2),
          at: after(5 * DAY),
        })
      )?.id,
    ).toBe(subscriptionIdOf(3));
  });

  test('終了した加入は特典の終了時刻を過ぎると含めない', async () => {
    await insertSubscriptionRow(
      activatedSubscriptionRow(5, {
        userId: userIdOf(2),
        stripeStatus: 'unpaid',
        startedAt: after(-30 * DAY),
        endedAt: after(-1),
        benefitEndsAt: after(-1),
        benefitEndFixed: true,
      }),
    );

    expect(
      await store.findEntitledOverlapping({
        userId: userIdOf(2),
        at: after(-1),
      }),
    ).toBeUndefined();
    expect(
      (
        await store.findEntitledOverlapping({
          userId: userIdOf(2),
          at: after(-2),
        })
      )?.id,
    ).toBe(subscriptionIdOf(5));
  });
});

describe('D1SubscriptionStoreの期間の重なりの一括の検索', () => {
  test('90件を超える利用者は分けて問い合わせ、重なる利用者の開始時刻と終了時刻をすべて返す', async () => {
    const userIndexes = range(1, 95);
    await insertUsers(range(3, 95));
    await insertSubscriptionRows(
      userIndexes.map((index) =>
        activatedSubscriptionRow(index, {
          userId: userIdOf(index),
          benefitEndsAt: index % 2 === 0 ? after(index * DAY) : null,
        }),
      ),
    );
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await new D1SubscriptionStore(database).findOverlapping({
      userIds: userIndexes.map(userIdOf),
      from: after(DAY),
      to: after(2 * DAY),
    });

    expect(placeholderCounts).toEqual([92, 7]);
    expectSplitWithinBindLimit(placeholderCounts);
    expect(found).toHaveLength(95);
    expect(found).toContainEqual({
      userId: userIdOf(2),
      startedAt: T0,
      benefitEndsAt: after(2 * DAY),
    });
    expect(found).toContainEqual({
      userId: userIdOf(95),
      startedAt: T0,
      benefitEndsAt: null,
    });
    expect(new Set(found.map(({ userId }) => userId)).size).toBe(95);
  });

  test('両端を含む期間と重なる加入だけを返し、未有効の行と指定外の利用者を含めない', async () => {
    await insertUsers(range(3, 6));
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, {
        userId: userIdOf(1),
        startedAt: after(20 * DAY),
      }),
      activatedSubscriptionRow(2, {
        userId: userIdOf(2),
        startedAt: after(20 * DAY + 1),
      }),
      activatedSubscriptionRow(3, {
        userId: userIdOf(3),
        startedAt: T0,
        benefitEndsAt: after(10 * DAY),
        benefitEndFixed: true,
      }),
      activatedSubscriptionRow(4, {
        userId: userIdOf(4),
        startedAt: T0,
        benefitEndsAt: after(10 * DAY + 1),
        benefitEndFixed: true,
      }),
      newSubscriptionRow(5, { userId: userIdOf(5), stripeStatus: 'active' }),
      activatedSubscriptionRow(6, { userId: userIdOf(6), startedAt: T0 }),
    ]);

    const found = await store.findOverlapping({
      userIds: [
        userIdOf(1),
        userIdOf(2),
        userIdOf(3),
        userIdOf(4),
        userIdOf(5),
      ],
      from: after(10 * DAY),
      to: after(20 * DAY),
    });

    expect(found).toEqual([
      { userId: userIdOf(1), startedAt: after(20 * DAY), benefitEndsAt: null },
      {
        userId: userIdOf(4),
        startedAt: T0,
        benefitEndsAt: after(10 * DAY + 1),
      },
    ]);
  });

  test('利用者が無ければ問い合わせずに空を返す', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();

    expect(
      await new D1SubscriptionStore(database).findOverlapping({
        userIds: [],
        from: T0,
        to: after(DAY),
      }),
    ).toEqual([]);
    expect(placeholderCounts).toEqual([]);
  });
});

describe('D1SubscriptionStoreの最新の有効化された加入', () => {
  test('開始時刻が最も遅い加入を返し、未有効の行と他の利用者の加入を含めない', async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, {
        stripeStatus: 'canceled',
        startedAt: T0,
        benefitEndsAt: after(5 * DAY),
        benefitEndFixed: true,
      }),
      activatedSubscriptionRow(2, {
        stripeStatus: 'canceled',
        startedAt: after(20 * DAY),
        benefitEndsAt: after(25 * DAY),
        benefitEndFixed: true,
      }),
      activatedSubscriptionRow(3, {
        stripeStatus: 'canceled',
        startedAt: after(5 * DAY),
        benefitEndsAt: after(10 * DAY),
        benefitEndFixed: true,
      }),
      newSubscriptionRow(4, { stripeStatus: 'active' }),
      activatedSubscriptionRow(5, {
        userId: userIdOf(2),
        startedAt: after(30 * DAY),
      }),
    ]);

    expect((await store.findLatestActivated(userIdOf(1)))?.id).toBe(
      subscriptionIdOf(2),
    );
    expect((await store.findLatestActivated(userIdOf(2)))?.id).toBe(
      subscriptionIdOf(5),
    );
  });

  test('有効化された加入が無ければundefinedを返す', async () => {
    await insertSubscriptionRow(
      newSubscriptionRow(1, { stripeStatus: 'active' }),
    );

    expect(await store.findLatestActivated(userIdOf(1))).toBeUndefined();
    expect(await store.findLatestActivated(userIdOf(2))).toBeUndefined();
  });
});

describe('D1SubscriptionStoreの終了していない加入', () => {
  test('終了していないStripe側の状態の加入を作成順に返し、終了した状態と他の利用者の加入を含めない', async () => {
    const statuses: readonly StripeSubscriptionStatus[] = [
      'active',
      'canceled',
      'past_due',
      'unpaid',
      'trialing',
      'incomplete_expired',
      'incomplete',
      'paused',
    ];
    await insertSubscriptionRows(
      statuses.map((stripeStatus, offset) =>
        newSubscriptionRow(offset + 1, { stripeStatus }),
      ),
    );
    await insertSubscriptionRow(
      activatedSubscriptionRow(9, { userId: userIdOf(2) }),
    );

    expect(idsOf(await store.findCancellable(userIdOf(1)))).toEqual([
      subscriptionIdOf(1),
      subscriptionIdOf(3),
      subscriptionIdOf(5),
      subscriptionIdOf(7),
    ]);
    expect(idsOf(await store.findCancellable(userIdOf(2)))).toEqual([
      subscriptionIdOf(9),
    ]);
  });
});

describe('D1SubscriptionStoreの解約の予定の出どころの記録', () => {
  test('指定した加入にだけ解約の予定の出どころを書き、更新日時を進める', async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1),
      activatedSubscriptionRow(2, { userId: userIdOf(2) }),
    ]);

    await store.markPendingCancellation({
      id: subscriptionIdOf(1),
      source: 'withdrawal',
    });

    const marked = await readSubscriptionRow(stripeSubscriptionIdOf(1));
    expect(marked?.pendingCancellationSource).toBe('withdrawal');
    expect(marked?.updatedAt.getTime()).toBeGreaterThan(T0.getTime());
    expect(await readSubscriptionRow(stripeSubscriptionIdOf(2))).toMatchObject({
      pendingCancellationSource: null,
      updatedAt: T0,
    });
  });
});

describe('D1SubscriptionStoreの利用者の行の削除', () => {
  test('削除の文は利用者の加入だけを消す', async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, {
        stripeStatus: 'canceled',
        benefitEndsAt: after(DAY),
        benefitEndFixed: true,
      }),
      newSubscriptionRow(2),
      activatedSubscriptionRow(3, { userId: userIdOf(2) }),
    ]);

    await db.batch([store.deleteByUser(userIdOf(1))]);

    expect(
      await store.findByStripeId(stripeSubscriptionIdOf(1)),
    ).toBeUndefined();
    expect(
      await store.findByStripeId(stripeSubscriptionIdOf(2)),
    ).toBeUndefined();
    expect(await store.findByStripeId(stripeSubscriptionIdOf(3))).toBeDefined();
  });
});

describe('スキーマの列挙とcoreの型の同期', () => {
  test('Stripe側の状態・解約の出どころ・解約の予定の出どころの列挙はcoreのユニオンと同じ集合である', () => {
    expectTypeOf<
      (typeof STRIPE_SUBSCRIPTION_STATUS_VALUES)[number]
    >().toEqualTypeOf<StripeSubscriptionStatus>();
    expectTypeOf<
      (typeof CANCELLATION_SOURCE_VALUES)[number]
    >().toEqualTypeOf<CancellationSource>();
    expectTypeOf<
      (typeof PENDING_CANCELLATION_SOURCE_VALUES)[number]
    >().toEqualTypeOf<
      NonNullable<SubscriptionRow['pendingCancellationSource']>
    >();
  });

  test('終了の状態の集合はスキーマのStripe側の状態に含まれる', () => {
    for (const status of ENDED_STRIPE_STATUSES) {
      expect(STRIPE_SUBSCRIPTION_STATUS_VALUES).toContain(status);
    }
  });
});
