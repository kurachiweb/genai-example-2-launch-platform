import { describe, expect, test } from 'bun:test';

import { qualifierWindow } from '../../../lib/core/match/match-model.ts';
import type { ScheduledLaunch } from '../../../lib/core/product/ports.ts';
import type { PairingStore } from './ports.ts';
import {
  QUALIFIER_PAIRING_READ_LIMIT,
  QUALIFIER_PAIRING_WRITE_LIMIT,
  StoreQualifierPairingService,
} from './qualifier-pairing-service.ts';
import {
  COMPLETED_NOW,
  createFakeMatchScheduler,
  createFakePairingStore,
  createFakeScheduledLaunchDirectory,
  createPairingMatchIds,
  lastIndexRandom,
  PAIRING_DATE,
  PAIRING_NOW,
  scheduledLaunches,
  scheduledLaunchOf,
} from './testing/pairing-fakes.ts';
import { createSteppingClock } from './testing/settlement-fakes.ts';

function serviceOf(
  launches: readonly ScheduledLaunch[],
  options: {
    readonly store?: PairingStore;
    readonly skippedLaunches?: ReadonlySet<string>;
  } = {},
) {
  const store = options.store ?? createFakePairingStore();
  const directory = createFakeScheduledLaunchDirectory(launches);
  const scheduler = createFakeMatchScheduler({
    skippedLaunches: options.skippedLaunches,
  });
  const service = new StoreQualifierPairingService(
    store,
    directory,
    scheduler,
    lastIndexRandom,
    createSteppingClock([PAIRING_NOW, COMPLETED_NOW]),
    createPairingMatchIds(),
  );
  return { service, store, directory, scheduler };
}

function scheduledLaunchIds(
  scheduler: ReturnType<typeof createFakeMatchScheduler>,
): string[] {
  return scheduler.calls.flatMap(({ inputs }) =>
    inputs.flatMap((input) => input.entries.map((entry) => entry.launchId)),
  );
}

describe('StoreQualifierPairingService.pair', () => {
  test('読み取りは500件・書き込みは50マッチずつである', () => {
    expect(QUALIFIER_PAIRING_READ_LIMIT).toBe(500);
    expect(QUALIFIER_PAIRING_WRITE_LIMIT).toBe(50);
  });

  test('対象日の予定のローンチを500件ずつ、次のページが無くなるまで読む', async () => {
    const { service, directory } = serviceOf(scheduledLaunches(1001));

    await service.pair(PAIRING_DATE);

    expect(directory.reads).toEqual([
      { launchDate: PAIRING_DATE, after: undefined, limit: 500 },
      { launchDate: PAIRING_DATE, after: 'launch-0500', limit: 500 },
      { launchDate: PAIRING_DATE, after: 'launch-1000', limit: 500 },
    ]);
  });

  test('組んだマッチを予選として、開始と終了を対象日の0:00と23:40にして予定する', async () => {
    const [first, second, third] = scheduledLaunches(3);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('ローンチがありません');
    }
    const { service, scheduler } = serviceOf([first, second, third]);

    await service.pair(PAIRING_DATE);

    const window = qualifierWindow(PAIRING_DATE);
    const entryOf = (launch: ScheduledLaunch) => ({
      launchId: launch.launchId,
      productId: launch.productId,
      ownerUserId: launch.ownerUserId,
    });
    const common = {
      kind: 'qualifier' as const,
      round: null,
      stage: null,
      matchDate: PAIRING_DATE,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    };
    expect(scheduler.calls).toEqual([
      {
        inputs: [
          {
            ...common,
            matchId: '01JF0PAIR00000000000000001',
            entries: [entryOf(first), entryOf(second)],
          },
          {
            ...common,
            matchId: '01JF0PAIR00000000000000002',
            entries: [entryOf(third)],
          },
        ],
        at: PAIRING_NOW,
      },
    ]);
    expect(window.startsAt.toISOString()).toBe('2027-03-03T08:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2027-03-04T07:40:00.000Z');
  });

  test('カテゴリごとに組み、余り同士を組み、最後の1つを不戦勝にする', async () => {
    const { service, scheduler } = serviceOf([
      scheduledLaunchOf(1, 'category-a'),
      scheduledLaunchOf(2, 'category-b'),
      scheduledLaunchOf(3, 'category-a'),
      scheduledLaunchOf(4, 'category-b'),
      scheduledLaunchOf(5, 'category-a'),
      scheduledLaunchOf(6, 'category-c'),
      scheduledLaunchOf(7, 'category-d'),
    ]);

    await service.pair(PAIRING_DATE);

    expect(
      scheduler.calls.flatMap(({ inputs }) =>
        inputs.map((input) => input.entries.map((entry) => entry.launchId)),
      ),
    ).toEqual([
      ['launch-0001', 'launch-0003'],
      ['launch-0002', 'launch-0004'],
      ['launch-0005', 'launch-0006'],
      ['launch-0007'],
    ]);
  });

  test('組んだマッチを50件ずつ予定し、予定の書き込みごとにイベントが送られる単位を50マッチにする', async () => {
    const { service, scheduler } = serviceOf(scheduledLaunches(203));

    const summary = await service.pair(PAIRING_DATE);

    expect(scheduler.calls.map(({ inputs }) => inputs.length)).toEqual([
      50, 50, 2,
    ]);
    expect(new Set(scheduledLaunchIds(scheduler)).size).toBe(203);
    expect(summary).toEqual({ launches: 203, matches: 102 });
  });

  test('既にその日の予選に組まれたローンチを除いて組む', async () => {
    const store = createFakePairingStore({
      paired: ['launch-0002', 'launch-0004'],
    });
    const { service, scheduler } = serviceOf(scheduledLaunches(5), { store });

    await service.pair(PAIRING_DATE);

    expect(scheduledLaunchIds(scheduler)).toEqual([
      'launch-0001',
      'launch-0003',
      'launch-0005',
    ]);
  });

  test('予定の後に記録を完了にし、作ったマッチと側のローンチの数を記録する', async () => {
    const store = createFakePairingStore();
    const { service } = serviceOf(scheduledLaunches(5), { store });

    await service.pair(PAIRING_DATE);

    expect(store.calls).toEqual(['beginDay', 'pairedLaunchIds', 'completeDay']);
    expect(store.days.get(PAIRING_DATE)).toEqual({
      completedAt: COMPLETED_NOW,
      launches: 5,
      matches: 3,
    });
  });

  test('同時に組まれていて予定されなかったマッチは件数に数えない', async () => {
    const store = createFakePairingStore();
    const { service } = serviceOf(scheduledLaunches(4), {
      store,
      skippedLaunches: new Set(['launch-0003']),
    });

    const summary = await service.pair(PAIRING_DATE);

    expect(summary).toEqual({ launches: 2, matches: 1 });
    expect(store.days.get(PAIRING_DATE)).toMatchObject({
      launches: 2,
      matches: 1,
    });
  });

  test('対象のローンチが無い未完了の日も、記録を完了にする', async () => {
    const store = createFakePairingStore();
    const { service, scheduler } = serviceOf([], { store });

    const summary = await service.pair(PAIRING_DATE);

    expect(summary).toEqual({ launches: 0, matches: 0 });
    expect(scheduler.calls).toEqual([]);
    expect(store.days.get(PAIRING_DATE)).toEqual({
      completedAt: COMPLETED_NOW,
      launches: 0,
      matches: 0,
    });
  });

  test('完了済みの日でも、組まれていないローンチだけを組み、最初の完了の日時を保って件数を足す', async () => {
    const firstCompletedAt = new Date('2027-03-03T07:45:30.000Z');
    const store = createFakePairingStore({
      paired: ['launch-0001', 'launch-0002'],
      day: { completedAt: firstCompletedAt, launches: 2, matches: 1 },
    });
    const { service, scheduler } = serviceOf(scheduledLaunches(4), { store });

    const summary = await service.pair(PAIRING_DATE);

    expect(scheduledLaunchIds(scheduler)).toEqual([
      'launch-0003',
      'launch-0004',
    ]);
    expect(summary).toEqual({ launches: 2, matches: 1 });
    expect(store.days.get(PAIRING_DATE)).toEqual({
      completedAt: firstCompletedAt,
      launches: 4,
      matches: 2,
    });
  });

  test('完了済みの日に組む対象が無ければ、予定も記録の完了も書かない', async () => {
    const firstCompletedAt = new Date('2027-03-03T07:45:30.000Z');
    const store = createFakePairingStore({
      paired: ['launch-0001', 'launch-0002'],
      day: { completedAt: firstCompletedAt, launches: 2, matches: 1 },
    });
    const { service, scheduler } = serviceOf(scheduledLaunches(2), { store });

    const summary = await service.pair(PAIRING_DATE);

    expect(summary).toEqual({ launches: 0, matches: 0 });
    expect(scheduler.calls).toEqual([]);
    expect(store.calls).toEqual(['beginDay', 'pairedLaunchIds']);
    expect(store.days.get(PAIRING_DATE)).toEqual({
      completedAt: firstCompletedAt,
      launches: 2,
      matches: 1,
    });
  });

  test('予定の書き込みが失敗すると記録を完了にせず、例外を伝える', async () => {
    const store = createFakePairingStore();
    const { service, scheduler } = serviceOf(scheduledLaunches(4), { store });
    const failure = new Error('D1の書き込みの失敗');
    scheduler.schedule = () => Promise.reject(failure);

    const error: unknown = await service
      .pair(PAIRING_DATE)
      .catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(store.calls).not.toContain('completeDay');
    expect(store.days.get(PAIRING_DATE)?.completedAt).toBeNull();
  });
});
