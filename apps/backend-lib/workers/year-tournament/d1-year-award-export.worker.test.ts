import { beforeEach, describe, expect, test } from 'vitest';

import type { YearAward } from '../../core/year-tournament/ports.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1YearAwardExport } from './d1-year-award-export.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import {
  clearYearTournamentTables,
  defaultScheduleOf,
  insertYearEntries,
  insertYearTournaments,
  type YearEntryFixture,
  yearEntryIdOf,
  type YearTournamentFixture,
} from './testing/year-tournament-fixtures.ts';

const LAUNCH_IDS_OVER_ONE_STATEMENT = 95;

const awardExport = new D1YearAwardExport(db);

const entryStore = new D1YearEntryStore(db);

function drawnEntryOf(index: number, year: number): YearEntryFixture {
  return {
    index,
    launch: index,
    product: index,
    owner: 1,
    columns: {
      status: 'drawn',
      entitlementSource: 'ultras',
      entitledAt: defaultScheduleOf(year).deadlineAt,
      classifiedYear: year,
    },
  };
}

function yearOf(
  index: number,
  year: number,
  columns: NonNullable<YearTournamentFixture['columns']>,
): YearTournamentFixture {
  const schedule = defaultScheduleOf(year);
  return {
    index,
    year,
    columns: {
      drawStartedAt: schedule.drawAt,
      updatedAt: schedule.drawAt,
      ...columns,
    },
  };
}

function finishedYear(
  index: number,
  year: number,
  championEntryIndex: number | null,
): YearTournamentFixture {
  const finishedAt = new Date(Date.UTC(year, 5, 1, 6, 45));
  return yearOf(index, year, {
    status: 'finished',
    finishedAt,
    ...(championEntryIndex === null
      ? { outcome: 'no_award' }
      : {
          outcome: 'awarded',
          championEntryId: yearEntryIdOf(championEntryIndex),
          awardedAt: finishedAt,
        }),
  });
}

// 2026年はローンチ1が優勝しローンチ2が敗退、2027年はローンチ3が優勝、2025年は受賞なしでローンチ4が参加、
// 2028年は進行中でローンチ5が参加。ローンチ6は枠が無い
beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4, 5, 6]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
  await insertYearTournaments([
    finishedYear(1, 2026, 1),
    finishedYear(2, 2027, 3),
    finishedYear(3, 2025, null),
    yearOf(4, 2028, { status: 'in_progress' }),
  ]);
  await insertYearEntries([
    drawnEntryOf(1, 2026),
    drawnEntryOf(2, 2026),
    drawnEntryOf(3, 2027),
    drawnEntryOf(4, 2025),
    drawnEntryOf(5, 2028),
  ]);
});

describe('D1YearAwardExport.listForLaunches', () => {
  test('優勝したローンチにだけ、Product of the Year賞と対象年を返す', async () => {
    const found = await awardExport.listForLaunches(
      [1, 2, 3, 4, 5, 6].map(launchIdOf),
    );

    expect(found).toEqual(
      new Map<string, YearAward[]>([
        [launchIdOf(1), [{ kind: 'product_of_the_year', period: '2026' }]],
        [launchIdOf(3), [{ kind: 'product_of_the_year', period: '2027' }]],
      ]),
    );
  });

  test('物理削除で優勝の枠の紐付けを解除した受賞は返さない', async () => {
    await entryStore.unlinkOrDeleteByProduct(productIdOf(1));

    const found = await awardExport.listForLaunches([
      launchIdOf(1),
      launchIdOf(3),
    ]);

    expect(found).toEqual(
      new Map<string, YearAward[]>([
        [launchIdOf(3), [{ kind: 'product_of_the_year', period: '2027' }]],
      ]),
    );
  });

  test('ローンチのIDが空なら問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    const found = await new D1YearAwardExport(
      recording.database,
    ).listForLaunches([]);

    expect(found.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるローンチのIDはバインド変数の上限に収まるよう分けて読み、重複を除く', async () => {
    const ids = [
      ...Array.from({ length: LAUNCH_IDS_OVER_ONE_STATEMENT }, (_, offset) =>
        launchIdOf(100 + offset),
      ),
      launchIdOf(3),
      launchIdOf(3),
    ];
    const recording = createRecordingDatabase();

    const found = await new D1YearAwardExport(
      recording.database,
    ).listForLaunches(ids);

    expect(found).toEqual(
      new Map<string, YearAward[]>([
        [launchIdOf(3), [{ kind: 'product_of_the_year', period: '2027' }]],
      ]),
    );
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
