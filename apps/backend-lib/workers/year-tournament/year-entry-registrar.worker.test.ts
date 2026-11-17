import type { Event } from '@sentry/cloudflare';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { matchIdOf } from '../match/testing/match-fixtures.ts';
import {
  db,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  CHAMPION_1,
  CHAMPION_2,
  CHAMPION_3,
  type ChampionFixture,
  createRegistrarHarness,
  NOW,
  readEntryRows,
  seedChampionOwners,
} from './testing/year-entry-registrar-fixtures.ts';
import {
  championWeekTournamentIdOf,
  defaultScheduleOf,
  insertYearEntries,
  YEAR_SCHEDULE,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const AWARDED_FROM = new Date('2026-11-01T08:00:00.000Z');

let events: Event[] = [];

beforeEach(async () => {
  events = installRecordingSentry();
  await seedChampionOwners();
});

afterEach(resetObservability);

describe('ChampionYearEntryRegistrar.syncChampions(枠の作成)', () => {
  test('Week優勝ごとに、週の初日からの週の識別子と予選勝利時の値を写した受付中の枠を作る', async () => {
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1, CHAMPION_2],
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: AWARDED_FROM, now: NOW }),
    ).resolves.toEqual({
      created: [yearEntryIdOf(1), yearEntryIdOf(2)],
      late: [],
      skipped: 0,
    });

    expect(harness.championQueries).toEqual([
      { awardedFrom: AWARDED_FROM, awardedBefore: NOW },
    ]);
    expect(harness.qualifierQueries).toEqual([[launchIdOf(1), launchIdOf(2)]]);
    expect(harness.matchQueries).toEqual([
      { ids: [matchIdOf(1), matchIdOf(2)], now: NOW },
    ]);
    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: yearEntryIdOf(1),
        weekTournamentId: championWeekTournamentIdOf(1),
        weekPeriod: '2026-W46',
        launchId: launchIdOf(1),
        productId: productIdOf(1),
        ownerUserId: userIdOf(1),
        launchDate: '2026-11-05',
        qualifierMatchId: matchIdOf(1),
        qualifierUpvoteCount: 12,
        qualifierLastUpvoteElapsedMs: 5_400_000,
        awardedAt: CHAMPION_1.awardedAt,
        awardedDate: '2026-11-15',
        status: 'awaiting_payment',
        entitlementSource: null,
        entitledAt: null,
        closeReason: null,
        classifiedYear: null,
        refundStatus: 'none',
        createdAt: NOW,
      }),
      expect.objectContaining({
        id: yearEntryIdOf(2),
        weekTournamentId: championWeekTournamentIdOf(2),
        weekPeriod: '2026-W47',
        launchId: launchIdOf(2),
        productId: productIdOf(2),
        ownerUserId: userIdOf(2),
        launchDate: '2026-11-12',
        qualifierMatchId: matchIdOf(2),
        qualifierUpvoteCount: 0,
        qualifierLastUpvoteElapsedMs: null,
        awardedAt: CHAMPION_2.awardedAt,
        awardedDate: '2026-11-22',
        status: 'awaiting_payment',
      }),
    ]);
    expect(events).toEqual([]);
  });

  test('枠のあるWeek優勝をWeekトーナメントのIDで除き、残りのローンチだけ予選を照会する', async () => {
    await insertYearEntries([
      {
        index: 9,
        launch: 1,
        product: 1,
        owner: 1,
        columns: { weekTournamentId: championWeekTournamentIdOf(1) },
      },
    ]);
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1, CHAMPION_2],
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [yearEntryIdOf(1)], late: [], skipped: 0 });

    expect(harness.championQueries).toEqual([
      { awardedFrom: null, awardedBefore: NOW },
    ]);
    expect(harness.qualifierQueries).toEqual([[launchIdOf(2)]]);
    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: yearEntryIdOf(1),
        weekTournamentId: championWeekTournamentIdOf(2),
      }),
      expect.objectContaining({
        id: yearEntryIdOf(9),
        weekTournamentId: championWeekTournamentIdOf(1),
        weekPeriod: '2026-W47',
        qualifierUpvoteCount: 10,
      }),
    ]);
  });

  test('全てのWeek優勝に枠があれば、予選もUltrasも照会せず何も作らない', async () => {
    await createRegistrarHarness({
      champions: [CHAMPION_1],
    }).registrar.syncChampions({ awardedFrom: null, now: NOW });
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1],
      narrow: () => Promise.resolve(new Set([userIdOf(1)])),
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [], skipped: 0 });

    expect(harness.qualifierQueries).toEqual([]);
    expect(harness.matchQueries).toEqual([]);
    expect(harness.narrowQueries).toEqual([]);
    await expect(readEntryRows()).resolves.toHaveLength(1);
  });

  test('Week優勝が無ければ予選を照会せず何も作らない', async () => {
    const harness = createRegistrarHarness({ champions: [] });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [], skipped: 0 });

    expect(harness.qualifierQueries).toEqual([]);
    await expect(readEntryRows()).resolves.toEqual([]);
  });

  test('同じ取り込みを2回行っても、Week優勝ごとの枠は1つだけになる', async () => {
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1, CHAMPION_2],
    });

    await harness.registrar.syncChampions({ awardedFrom: null, now: NOW });
    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [], skipped: 0 });

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        weekTournamentId: championWeekTournamentIdOf(1),
      }),
      expect.objectContaining({
        weekTournamentId: championWeekTournamentIdOf(2),
      }),
    ]);
  });

  test('照会と挿入の間に同じWeek優勝の枠が作られていれば、作成に数えず既存の枠を変えない', async () => {
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1],
      narrow: async () => {
        await insertYearEntries([
          {
            index: 9,
            launch: 1,
            product: 1,
            owner: 1,
            columns: { weekTournamentId: championWeekTournamentIdOf(1) },
          },
        ]);
        return new Set<string>();
      },
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [], skipped: 0 });

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({ id: yearEntryIdOf(9) }),
    ]);
  });
});

describe('ChampionYearEntryRegistrar.syncChampions(Ultrasの参加資格)', () => {
  test('Week優勝から対象年の決済期限までにUltrasの期間がある投稿者の枠は、参加資格(Ultras)で作る', async () => {
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1, CHAMPION_2, CHAMPION_3],
      narrow: () => Promise.resolve(new Set([userIdOf(1), userIdOf(2)])),
      entitled: ({ userIds, from }) =>
        userIds[0] === userIdOf(1) ||
        from.getTime() === CHAMPION_3.awardedAt.getTime(),
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({
      created: [yearEntryIdOf(1), yearEntryIdOf(2), yearEntryIdOf(3)],
      late: [],
      skipped: 0,
    });

    expect(harness.narrowQueries).toEqual([
      {
        userIds: [userIdOf(1), userIdOf(2)],
        from: CHAMPION_1.awardedAt,
        to: YEAR_SCHEDULE.deadlineAt,
      },
    ]);
    expect(harness.entitlementQueries).toEqual(
      [CHAMPION_1, CHAMPION_2, CHAMPION_3].map(({ owner, awardedAt }) => ({
        userIds: [userIdOf(owner)],
        from: awardedAt,
        to: YEAR_SCHEDULE.deadlineAt,
      })),
    );
    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: yearEntryIdOf(1),
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: NOW,
      }),
      expect.objectContaining({
        id: yearEntryIdOf(2),
        status: 'awaiting_payment',
        entitlementSource: null,
        entitledAt: null,
      }),
      expect.objectContaining({
        id: yearEntryIdOf(3),
        status: 'entitled',
        entitlementSource: 'ultras',
      }),
    ]);
  });

  test('候補を絞る照会に含まれない投稿者は、個別の判定をせずに受付中で作る', async () => {
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1, CHAMPION_2],
      narrow: () => Promise.resolve(new Set([userIdOf(2)])),
      entitled: () => true,
    });

    await harness.registrar.syncChampions({ awardedFrom: null, now: NOW });

    expect(harness.entitlementQueries).toEqual([
      {
        userIds: [userIdOf(2)],
        from: CHAMPION_2.awardedAt,
        to: YEAR_SCHEDULE.deadlineAt,
      },
    ]);
    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: yearEntryIdOf(1),
        status: 'awaiting_payment',
      }),
      expect.objectContaining({ id: yearEntryIdOf(2), status: 'entitled' }),
    ]);
  });

  test('決済期限日の当日のWeek優勝は翌年の対象とし、翌年の決済期限までの期間でUltrasを判定する', async () => {
    const deadlineDay: ChampionFixture = {
      index: 1,
      weekStart: '2027-05-17',
      awardedAt: new Date('2027-05-24T15:00:00.000Z'),
      owner: 1,
    };
    const now = new Date('2027-05-25T08:00:00.000Z');
    const harness = createRegistrarHarness({
      champions: [deadlineDay],
      narrow: () => Promise.resolve(new Set([userIdOf(1)])),
      entitled: () => true,
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now }),
    ).resolves.toEqual({ created: [yearEntryIdOf(1)], late: [], skipped: 0 });

    const nextDeadlineAt = defaultScheduleOf(2028).deadlineAt;
    expect(harness.narrowQueries).toEqual([
      {
        userIds: [userIdOf(1)],
        from: deadlineDay.awardedAt,
        to: nextDeadlineAt,
      },
    ]);
    expect(harness.entitlementQueries).toEqual([
      {
        userIds: [userIdOf(1)],
        from: deadlineDay.awardedAt,
        to: nextDeadlineAt,
      },
    ]);
    await expect(
      db
        .select()
        .from(yearTournamentEntries)
        .where(eq(yearTournamentEntries.id, yearEntryIdOf(1))),
    ).resolves.toEqual([
      expect.objectContaining({
        weekPeriod: '2027-W20',
        awardedDate: '2027-05-24',
        status: 'entitled',
      }),
    ]);
  });
});
