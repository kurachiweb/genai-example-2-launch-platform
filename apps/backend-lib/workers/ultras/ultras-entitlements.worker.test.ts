import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ULTRAS_PROMOTION_FLAG_KEY } from '../../../common-lib/ultras/promotion-flag.ts';
import { ultrasSettings } from '../../../db/schema/ultras/ultras-settings.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
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
  restoreUltrasSettingsSeed,
  T0,
  userIdOf,
} from './testing/ultras-store-fixtures.ts';
import { StoredUltrasEntitlements } from './ultras-entitlements.ts';

const DAY = 86_400_000;

const store = new D1SubscriptionStore(db);
const entitlements: UltrasEntitlements = new StoredUltrasEntitlements(store);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

async function setPromotionFlag(enabled: boolean): Promise<void> {
  await db
    .update(ultrasSettings)
    .set({ enabled })
    .where(eq(ultrasSettings.settingKey, ULTRAS_PROMOTION_FLAG_KEY));
}

beforeEach(async () => {
  await clearUltrasTables();
  await insertUser(1);
  await insertUser(2);
});

describe('StoredUltrasEntitlementsの時点の判定', () => {
  test('特典の継続期間は開始時刻を含み終了時刻を含まない', async () => {
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        stripeStatus: 'canceled',
        startedAt: T0,
        benefitEndsAt: after(10 * DAY),
        benefitEndFixed: true,
      }),
    );

    expect(await entitlements.isEntitledAt(userIdOf(1), after(-1))).toBe(false);
    expect(await entitlements.isEntitledAt(userIdOf(1), T0)).toBe(true);
    expect(
      await entitlements.isEntitledAt(userIdOf(1), after(10 * DAY - 1)),
    ).toBe(true);
    expect(await entitlements.isEntitledAt(userIdOf(1), after(10 * DAY))).toBe(
      false,
    );
  });

  test('終了時刻が無い加入は開始時刻の後のどの時点でも特典を受けられる', async () => {
    await insertSubscriptionRow(activatedSubscriptionRow(1, { startedAt: T0 }));

    expect(await entitlements.isEntitledAt(userIdOf(1), after(-1))).toBe(false);
    expect(
      await entitlements.isEntitledAt(userIdOf(1), after(3650 * DAY)),
    ).toBe(true);
  });

  test('加入が無い利用者と未有効の行だけの利用者は特典を受けられない', async () => {
    await insertSubscriptionRow(
      newSubscriptionRow(1, { stripeStatus: 'active' }),
    );

    expect(await entitlements.isEntitledAt(userIdOf(1), after(DAY))).toBe(
      false,
    );
    expect(await entitlements.isEntitledAt(userIdOf(2), after(DAY))).toBe(
      false,
    );
  });

  test('他の利用者の加入では特典を受けられない', async () => {
    await insertSubscriptionRow(activatedSubscriptionRow(1, { startedAt: T0 }));

    expect(await entitlements.isEntitledAt(userIdOf(2), after(DAY))).toBe(
      false,
    );
  });
});

describe('StoredUltrasEntitlementsの期間の判定', () => {
  beforeEach(async () => {
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        stripeStatus: 'canceled',
        startedAt: after(10 * DAY),
        benefitEndsAt: after(20 * DAY),
        benefitEndFixed: true,
      }),
    );
  });

  test('期間の終わりが開始時刻と同じなら重なり、その1ミリ秒前なら重ならない', async () => {
    expect(
      await entitlements.wasEntitledDuring(userIdOf(1), T0, after(10 * DAY)),
    ).toBe(true);
    expect(
      await entitlements.wasEntitledDuring(
        userIdOf(1),
        T0,
        after(10 * DAY - 1),
      ),
    ).toBe(false);
  });

  test('期間の始まりが終了時刻の1ミリ秒前なら重なり、終了時刻と同じなら重ならない', async () => {
    expect(
      await entitlements.wasEntitledDuring(
        userIdOf(1),
        after(20 * DAY - 1),
        after(30 * DAY),
      ),
    ).toBe(true);
    expect(
      await entitlements.wasEntitledDuring(
        userIdOf(1),
        after(20 * DAY),
        after(30 * DAY),
      ),
    ).toBe(false);
  });

  test('特典の継続期間を含む期間と、継続期間の中の期間はどちらも重なる', async () => {
    expect(
      await entitlements.wasEntitledDuring(userIdOf(1), T0, after(30 * DAY)),
    ).toBe(true);
    expect(
      await entitlements.wasEntitledDuring(
        userIdOf(1),
        after(12 * DAY),
        after(13 * DAY),
      ),
    ).toBe(true);
    expect(
      await entitlements.wasEntitledDuring(
        userIdOf(1),
        after(15 * DAY),
        after(15 * DAY),
      ),
    ).toBe(true);
  });

  test('離れた期間・他の利用者・未有効の行は重ならない', async () => {
    await insertSubscriptionRow(
      newSubscriptionRow(2, { userId: userIdOf(2), stripeStatus: 'active' }),
    );

    expect(
      await entitlements.wasEntitledDuring(
        userIdOf(1),
        after(30 * DAY),
        after(40 * DAY),
      ),
    ).toBe(false);
    expect(
      await entitlements.wasEntitledDuring(userIdOf(2), T0, after(30 * DAY)),
    ).toBe(false);
  });

  test('期間の始まりが終わりより後なら例外にする', async () => {
    await expect(
      entitlements.wasEntitledDuring(userIdOf(1), after(DAY), T0),
    ).rejects.toThrow(RangeError);
    await expect(
      entitlements.entitledUsersDuring([userIdOf(1)], after(DAY), T0),
    ).rejects.toThrow(RangeError);
  });
});

describe('StoredUltrasEntitlementsの複数の利用者の一括の判定', () => {
  // 3で割った余りが1の利用者は終了時刻の無い加入、2の利用者は10日後に終わる加入、0の利用者は未有効の行だけを持つ
  beforeEach(async () => {
    await insertUsers(range(3, 95));
    await insertSubscriptionRows(
      range(1, 95).map((index) => {
        switch (index % 3) {
          case 1:
            return activatedSubscriptionRow(index, {
              userId: userIdOf(index),
              startedAt: T0,
            });
          case 2:
            return activatedSubscriptionRow(index, {
              userId: userIdOf(index),
              stripeStatus: 'canceled',
              startedAt: T0,
              benefitEndsAt: after(10 * DAY),
              benefitEndFixed: true,
            });
          default:
            return newSubscriptionRow(index, {
              userId: userIdOf(index),
              stripeStatus: 'active',
            });
        }
      }),
    );
  });

  test('時点の一括の判定は90件を超える利用者を分けて問い合わせ、その時点で特典を受けられる利用者の集合を返す', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();
    const recorded = new StoredUltrasEntitlements(
      new D1SubscriptionStore(database),
    );
    const userIds = range(1, 95).map(userIdOf);

    const atTwentyDays = await recorded.entitledUsersAt(
      userIds,
      after(20 * DAY),
    );
    const atFiveDays = await entitlements.entitledUsersAt(
      userIds,
      after(5 * DAY),
    );

    expectSplitWithinBindLimit(placeholderCounts);
    expect(atTwentyDays).toEqual(
      new Set(
        range(1, 95)
          .filter((index) => index % 3 === 1)
          .map(userIdOf),
      ),
    );
    expect(atFiveDays).toEqual(
      new Set(
        range(1, 95)
          .filter((index) => index % 3 !== 0)
          .map(userIdOf),
      ),
    );
  });

  test('期間の一括の判定は期間のどこかで特典を受けられる利用者の集合を返し、指定外の利用者を含めない', async () => {
    const userIds = range(1, 94).map(userIdOf);

    const duringFiveToTwenty = await entitlements.entitledUsersDuring(
      userIds,
      after(5 * DAY),
      after(20 * DAY),
    );
    const duringTenToTwenty = await entitlements.entitledUsersDuring(
      userIds,
      after(10 * DAY),
      after(20 * DAY),
    );

    expect(duringFiveToTwenty).toEqual(
      new Set(
        range(1, 94)
          .filter((index) => index % 3 !== 0)
          .map(userIdOf),
      ),
    );
    expect(duringTenToTwenty).toEqual(
      new Set(
        range(1, 94)
          .filter((index) => index % 3 === 1)
          .map(userIdOf),
      ),
    );
    expect(duringFiveToTwenty.has(userIdOf(95))).toBe(false);
  });

  test('同じ利用者を重ねて渡しても集合には1つだけ入る', async () => {
    const found = await entitlements.entitledUsersAt(
      [userIdOf(1), userIdOf(1), userIdOf(3)],
      after(DAY),
    );

    expect(found).toEqual(new Set([userIdOf(1)]));
  });

  test('時点の一括の判定は開始時刻ちょうどの利用者を含み、その1ミリ秒前では含めない', async () => {
    await insertUser(96);
    await insertSubscriptionRow(
      activatedSubscriptionRow(96, {
        userId: userIdOf(96),
        startedAt: after(DAY),
      }),
    );
    const userIds = [userIdOf(96), userIdOf(1), userIdOf(3)];

    expect(await entitlements.entitledUsersAt(userIds, after(DAY))).toEqual(
      new Set([userIdOf(96), userIdOf(1)]),
    );
    expect(await entitlements.entitledUsersAt(userIds, after(DAY - 1))).toEqual(
      new Set([userIdOf(1)]),
    );
  });

  test('利用者が無ければ問い合わせずに空の集合を返す', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();
    const recorded = new StoredUltrasEntitlements(
      new D1SubscriptionStore(database),
    );

    expect(await recorded.entitledUsersAt([], after(DAY))).toEqual(new Set());
    expect(await recorded.entitledUsersDuring([], T0, after(DAY))).toEqual(
      new Set(),
    );
    expect(placeholderCounts).toEqual([]);
  });
});

describe('StoredUltrasEntitlementsの過去の時点の判定', () => {
  test('解約の予約・取り消し・終了の後も、保存した特典の継続期間に基づいて過去の時点を判定する', async () => {
    await db.batch([
      store.upsertStripeState({
        row: activatedSubscriptionRow(1, {
          startedAt: T0,
          currentPeriodEnd: after(30 * DAY),
        }),
      }),
    ]);
    const pastInstant = after(5 * DAY);
    const pastPeriod = [after(DAY), after(6 * DAY)] as const;

    expect(await entitlements.isEntitledAt(userIdOf(1), pastInstant)).toBe(
      true,
    );

    await db.batch([
      store.upsertStripeState({
        row: activatedSubscriptionRow(1, {
          startedAt: T0,
          cancelScheduled: true,
          cancelAt: after(30 * DAY),
          currentPeriodEnd: after(30 * DAY),
          benefitEndsAt: after(31 * DAY),
          canceledAt: after(10 * DAY),
          cancellationSource: 'user',
        }),
      }),
    ]);
    expect(await entitlements.isEntitledAt(userIdOf(1), pastInstant)).toBe(
      true,
    );
    expect(
      await entitlements.wasEntitledDuring(userIdOf(1), ...pastPeriod),
    ).toBe(true);
    expect(await entitlements.isEntitledAt(userIdOf(1), after(31 * DAY))).toBe(
      false,
    );

    await db.batch([
      store.upsertStripeState({
        row: activatedSubscriptionRow(1, {
          startedAt: T0,
          currentPeriodEnd: after(30 * DAY),
        }),
      }),
    ]);
    expect(await entitlements.isEntitledAt(userIdOf(1), pastInstant)).toBe(
      true,
    );
    expect(await entitlements.isEntitledAt(userIdOf(1), after(31 * DAY))).toBe(
      true,
    );

    await db.batch([
      store.upsertStripeState({
        row: activatedSubscriptionRow(1, {
          stripeStatus: 'unpaid',
          startedAt: T0,
          endedAt: after(20 * DAY),
          benefitEndsAt: after(20 * DAY),
          benefitEndFixed: true,
        }),
      }),
    ]);
    expect(await entitlements.isEntitledAt(userIdOf(1), pastInstant)).toBe(
      true,
    );
    expect(
      await entitlements.wasEntitledDuring(userIdOf(1), ...pastPeriod),
    ).toBe(true);
    expect(await entitlements.isEntitledAt(userIdOf(1), after(20 * DAY))).toBe(
      false,
    );
  });
});

describe('StoredUltrasEntitlementsと機能フラグ', () => {
  beforeEach(async () => {
    await restoreUltrasSettingsSeed();
  });

  afterEach(async () => {
    await restoreUltrasSettingsSeed();
  });

  test('機能フラグのオンとオフで判定と加入状態のどちらも変わらない', async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, { startedAt: T0 }),
      activatedSubscriptionRow(2, {
        userId: userIdOf(2),
        stripeStatus: 'canceled',
        startedAt: T0,
        benefitEndsAt: after(10 * DAY),
        benefitEndFixed: true,
      }),
    ]);
    const judge = async () => ({
      at: await entitlements.isEntitledAt(userIdOf(2), after(10 * DAY)),
      during: await entitlements.wasEntitledDuring(
        userIdOf(2),
        after(5 * DAY),
        after(15 * DAY),
      ),
      usersAt: await entitlements.entitledUsersAt(
        [userIdOf(1), userIdOf(2)],
        after(10 * DAY),
      ),
      usersDuring: await entitlements.entitledUsersDuring(
        [userIdOf(1), userIdOf(2)],
        after(5 * DAY),
        after(15 * DAY),
      ),
      plan: await entitlements.currentPlan(userIdOf(1), after(DAY)),
    });

    const whileOff = await judge();
    await setPromotionFlag(true);
    const whileOn = await judge();

    expect(whileOff).toEqual({
      at: false,
      during: true,
      usersAt: new Set([userIdOf(1)]),
      usersDuring: new Set([userIdOf(1), userIdOf(2)]),
      plan: {
        status: 'active',
        startedAt: T0,
        currentPeriodEndsAt: null,
        benefitEndsAt: null,
        canceledAt: null,
      },
    });
    expect(whileOn).toEqual(whileOff);
  });
});

describe('StoredUltrasEntitlementsの現在の加入状態', () => {
  test('最新の有効化された加入から加入状態を導き、課金期間の終了時刻と解約の操作の時刻を写す', async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, {
        stripeStatus: 'canceled',
        startedAt: T0,
        benefitEndsAt: after(5 * DAY),
        benefitEndFixed: true,
        canceledAt: after(DAY),
        cancellationSource: 'user',
      }),
      activatedSubscriptionRow(2, {
        startedAt: after(20 * DAY),
        currentPeriodEnd: after(50 * DAY),
      }),
      newSubscriptionRow(3, { stripeStatus: 'active' }),
    ]);

    expect(
      await entitlements.currentPlan(userIdOf(1), after(25 * DAY)),
    ).toEqual({
      status: 'active',
      startedAt: after(20 * DAY),
      currentPeriodEndsAt: after(50 * DAY),
      benefitEndsAt: null,
      canceledAt: null,
    });
  });

  test('支払いの再試行中はpast_due、解約が予約されていれば終了時刻までcanceled、終了時刻を過ぎればendedになる', async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, {
        stripeStatus: 'past_due',
        startedAt: T0,
        currentPeriodEnd: after(30 * DAY),
        pastDueSince: after(30 * DAY),
      }),
      activatedSubscriptionRow(2, {
        userId: userIdOf(2),
        startedAt: T0,
        cancelScheduled: true,
        cancelAt: after(30 * DAY),
        currentPeriodEnd: after(30 * DAY),
        benefitEndsAt: after(31 * DAY),
        canceledAt: after(10 * DAY),
        cancellationSource: 'user',
      }),
    ]);

    expect(
      await entitlements.currentPlan(userIdOf(1), after(31 * DAY)),
    ).toMatchObject({ status: 'past_due', benefitEndsAt: null });
    expect(
      await entitlements.currentPlan(userIdOf(2), after(31 * DAY - 1)),
    ).toEqual({
      status: 'canceled',
      startedAt: T0,
      currentPeriodEndsAt: after(30 * DAY),
      benefitEndsAt: after(31 * DAY),
      canceledAt: after(10 * DAY),
    });
    expect(
      await entitlements.currentPlan(userIdOf(2), after(31 * DAY)),
    ).toMatchObject({ status: 'ended', benefitEndsAt: after(31 * DAY) });
  });

  test('有効化された加入が無ければnullを返す', async () => {
    await insertSubscriptionRow(
      newSubscriptionRow(1, { stripeStatus: 'active' }),
    );

    expect(await entitlements.currentPlan(userIdOf(1), after(DAY))).toBeNull();
    expect(await entitlements.currentPlan(userIdOf(2), after(DAY))).toBeNull();
  });
});
