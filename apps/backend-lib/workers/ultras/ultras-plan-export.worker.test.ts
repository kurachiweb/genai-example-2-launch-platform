import { beforeEach, describe, expect, test } from 'vitest';

import { ULTRAS_PLAN_STATUSES } from '../../../common-lib/ultras/plan-status.ts';
import type { UltrasPlanExport } from '../../core/ultras/ports.ts';
import { D1SubscriptionStore } from './d1-subscription-store.ts';
import {
  activatedSubscriptionRow,
  after,
  clearUltrasTables,
  db,
  insertSubscriptionRow,
  insertSubscriptionRows,
  insertUser,
  newSubscriptionRow,
  T0,
  userIdOf,
} from './testing/ultras-store-fixtures.ts';
import { StoredUltrasPlanExport } from './ultras-plan-export.ts';

const DAY = 86_400_000;

const PLAN_JSON_FIELDS = [
  'canceledAt',
  'currentPeriodEndsAt',
  'name',
  'startedAt',
  'status',
];

const exporter: UltrasPlanExport = new StoredUltrasPlanExport(
  new D1SubscriptionStore(db),
);

beforeEach(async () => {
  await clearUltrasTables();
  await insertUser(1);
  await insertUser(2);
});

describe('StoredUltrasPlanExport', () => {
  test('最新の有効化された加入をplanの項目だけで返し、特典の終了時刻を含めない', async () => {
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
        cancelScheduled: true,
        cancelAt: after(50 * DAY),
        currentPeriodEnd: after(50 * DAY),
        benefitEndsAt: after(51 * DAY),
        canceledAt: after(30 * DAY),
        cancellationSource: 'user',
      }),
    ]);

    const item = await exporter.find(userIdOf(1), after(40 * DAY));

    expect(item).toEqual({
      name: 'ultras',
      status: 'canceled',
      startedAt: after(20 * DAY),
      currentPeriodEndsAt: after(50 * DAY),
      canceledAt: after(30 * DAY),
    });
    expect(Object.keys(item ?? {}).toSorted()).toEqual(PLAN_JSON_FIELDS);
    expect(ULTRAS_PLAN_STATUSES).toContain(item?.status);
  });

  test('加入状態は指定した時点から導き、有効な加入はactive、終了時刻を過ぎた加入はendedになる', async () => {
    await insertSubscriptionRows([
      activatedSubscriptionRow(1, {
        startedAt: T0,
        currentPeriodEnd: after(30 * DAY),
      }),
      activatedSubscriptionRow(2, {
        userId: userIdOf(2),
        stripeStatus: 'canceled',
        startedAt: T0,
        endedAt: after(10 * DAY),
        benefitEndsAt: after(10 * DAY),
        benefitEndFixed: true,
        canceledAt: after(3 * DAY),
        cancellationSource: 'withdrawal',
      }),
    ]);

    expect(await exporter.find(userIdOf(1), after(DAY))).toEqual({
      name: 'ultras',
      status: 'active',
      startedAt: T0,
      currentPeriodEndsAt: after(30 * DAY),
      canceledAt: null,
    });
    expect(await exporter.find(userIdOf(2), after(10 * DAY))).toEqual({
      name: 'ultras',
      status: 'ended',
      startedAt: T0,
      currentPeriodEndsAt: null,
      canceledAt: after(3 * DAY),
    });
  });

  test('加入したことが無い利用者と未有効の行だけの利用者はnullになる', async () => {
    await insertSubscriptionRow(
      newSubscriptionRow(1, { stripeStatus: 'active' }),
    );

    expect(await exporter.find(userIdOf(1), after(DAY))).toBeNull();
    expect(await exporter.find(userIdOf(2), after(DAY))).toBeNull();
  });
});
