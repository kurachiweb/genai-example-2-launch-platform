import { beforeEach, describe, expect, test } from 'vitest';

import { parseBusinessDate } from '../../core/time/business-time.ts';
import type { WeekChampion } from '../../core/week-tournament/ports.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1WeekChampionDirectory } from './d1-week-champion-directory.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
  weekEntryIdOf,
  type WeekTournamentFixture,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';

const FROM = new Date('2026-11-24T08:00:00.000Z');

const BEFORE = new Date('2026-12-15T07:45:00.000Z');

const directory = new D1WeekChampionDirectory(db);

const store = new D1WeekTournamentStore(db);

function finishedWeek(
  index: number,
  weekStart: string,
  columns: WeekTournamentFixture['columns'],
): WeekTournamentFixture {
  return {
    index,
    weekStart,
    columns: {
      status: 'finished',
      drawStartedAt: WEEK_WINDOW.drawAt,
      finishedAt: BEFORE,
      updatedAt: BEFORE,
      ...columns,
    },
  };
}

function awardedWeek(
  index: number,
  weekStart: string,
  awardedAt: Date,
): WeekTournamentFixture {
  return finishedWeek(index, weekStart, {
    outcome: 'awarded',
    championEntryId: weekEntryIdOf(index),
    awardedAt,
  });
}

function championOf(
  index: number,
  weekStart: string,
  owner: number,
  awardedAt: Date,
): WeekChampion {
  return {
    tournamentId: weekTournamentIdOf(index),
    weekStart: parseBusinessDate(weekStart),
    productId: productIdOf(index),
    launchId: launchIdOf(index),
    ownerUserId: userIdOf(owner),
    awardedAt,
  };
}

// 週1〜5の優勝の枠は同じ番号の枠・ローンチ・プロダクト。プロダクト1〜3は利用者1、4・5は利用者2が投稿した
beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3, 4, 5, 6]) {
    await insertProduct(index, index <= 3 ? 1 : 2);
    await insertLaunch(index, index);
  }
  await insertWeekTournaments([
    awardedWeek(1, '2026-11-30', new Date('2026-12-08T07:45:00.000Z')),
    awardedWeek(2, '2026-11-16', FROM),
    awardedWeek(3, '2026-12-07', new Date(BEFORE.getTime() - 1)),
    awardedWeek(4, '2026-11-09', new Date(FROM.getTime() - 1)),
    awardedWeek(5, '2026-12-14', BEFORE),
    finishedWeek(6, '2026-11-23', { outcome: 'no_award' }),
    {
      index: 7,
      weekStart: '2027-01-18',
      columns: { status: 'in_progress', drawStartedAt: BEFORE },
    },
  ]);
  await insertWeekEntries(
    [1, 2, 3, 4, 5, 6].map((index) => ({
      index,
      tournament: index,
      launch: index,
      product: index,
      owner: index <= 3 ? 1 : 2,
      columns: {
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: WEEK_WINDOW.deadlineAt,
      },
    })),
  );
});

describe('D1WeekChampionDirectory.listChampions', () => {
  test('起点が無ければ、終点の直前までの全ての受賞を週・プロダクト・ローンチ・投稿者・受賞の日時で受賞の昇順に返す', async () => {
    await expect(
      directory.listChampions({ awardedFrom: null, awardedBefore: BEFORE }),
    ).resolves.toEqual([
      championOf(4, '2026-11-09', 2, new Date(FROM.getTime() - 1)),
      championOf(2, '2026-11-16', 1, FROM),
      championOf(1, '2026-11-30', 1, new Date('2026-12-08T07:45:00.000Z')),
      championOf(3, '2026-12-07', 1, new Date(BEFORE.getTime() - 1)),
    ]);
  });

  test('起点があれば、受賞の日時が起点ちょうどから終点の直前までの受賞だけを返す', async () => {
    await expect(
      directory.listChampions({ awardedFrom: FROM, awardedBefore: BEFORE }),
    ).resolves.toEqual([
      championOf(2, '2026-11-16', 1, FROM),
      championOf(1, '2026-11-30', 1, new Date('2026-12-08T07:45:00.000Z')),
      championOf(3, '2026-12-07', 1, new Date(BEFORE.getTime() - 1)),
    ]);
  });

  test('物理削除で優勝の枠の紐付けを解除した受賞は除く', async () => {
    await store.unlinkOrDeleteByProduct(productIdOf(2));

    await expect(
      directory.listChampions({ awardedFrom: FROM, awardedBefore: BEFORE }),
    ).resolves.toEqual([
      championOf(1, '2026-11-30', 1, new Date('2026-12-08T07:45:00.000Z')),
      championOf(3, '2026-12-07', 1, new Date(BEFORE.getTime() - 1)),
    ]);
  });

  test('受賞の日時が同じ受賞は週の初日の昇順に並べる', async () => {
    const tiedAt = new Date('2027-01-05T07:45:00.000Z');
    for (const index of [8, 9]) {
      await insertProduct(index, 1);
      await insertLaunch(index, index);
    }
    await insertWeekTournaments([
      awardedWeek(8, '2026-12-28', tiedAt),
      awardedWeek(9, '2026-12-21', tiedAt),
    ]);
    await insertWeekEntries(
      [8, 9].map((index) => ({
        index,
        tournament: index,
        launch: index,
        product: index,
        owner: 1,
        columns: {
          status: 'drawn',
          entitlementSource: 'ultras',
          entitledAt: WEEK_WINDOW.deadlineAt,
        },
      })),
    );

    await expect(
      directory.listChampions({
        awardedFrom: tiedAt,
        awardedBefore: new Date(tiedAt.getTime() + 1),
      }),
    ).resolves.toEqual([
      championOf(9, '2026-12-21', 1, tiedAt),
      championOf(8, '2026-12-28', 1, tiedAt),
    ]);
  });

  test('期間内に受賞が無ければ空の一覧を返す', async () => {
    await expect(
      directory.listChampions({
        awardedFrom: new Date('2027-01-01T08:00:00.000Z'),
        awardedBefore: new Date('2027-01-08T08:00:00.000Z'),
      }),
    ).resolves.toEqual([]);
  });
});
