import { beforeEach, describe, expect, test } from 'vitest';

import type { WeekAward } from '../../core/week-tournament/ports.ts';
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
import { D1WeekAwardExport } from './d1-week-award-export.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
  weekEntryIdOf,
  type WeekEntryFixture,
} from './testing/week-tournament-fixtures.ts';

const BULK_COUNT = 95;

const AWARDED_AT = new Date('2026-12-01T07:45:00.000Z');

const awardExport = new D1WeekAwardExport(db);

const store = new D1WeekTournamentStore(db);

function drawnEntryOf(index: number, tournament: number): WeekEntryFixture {
  return {
    index,
    tournament,
    launch: index,
    product: index,
    owner: 1,
    columns: {
      status: 'drawn',
      entitlementSource: 'ultras',
      entitledAt: WEEK_WINDOW.deadlineAt,
    },
  };
}

function finished(columns: {
  readonly outcome: 'awarded' | 'no_award';
  readonly championEntryId?: string;
}) {
  return {
    status: 'finished',
    drawStartedAt: WEEK_WINDOW.drawAt,
    finishedAt: AWARDED_AT,
    awardedAt: columns.outcome === 'awarded' ? AWARDED_AT : null,
    updatedAt: AWARDED_AT,
    ...columns,
  } as const;
}

// 週1(2026-W47)はローンチ1が優勝しローンチ2が敗退、週2(2026-W53)はローンチ3が優勝、週3は受賞なしでローンチ4が参加、
// 週4は進行中でローンチ5が参加。ローンチ6は枠が無い
beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4, 5, 6]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
  await insertWeekTournaments([
    {
      index: 1,
      weekStart: '2026-11-16',
      columns: finished({
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(1),
      }),
    },
    {
      index: 2,
      weekStart: '2026-12-28',
      columns: finished({
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(3),
      }),
    },
    {
      index: 3,
      weekStart: '2026-11-09',
      columns: finished({ outcome: 'no_award' }),
    },
    {
      index: 4,
      weekStart: '2026-11-23',
      columns: { status: 'in_progress', drawStartedAt: WEEK_WINDOW.drawAt },
    },
  ]);
  await insertWeekEntries([
    drawnEntryOf(1, 1),
    drawnEntryOf(2, 1),
    drawnEntryOf(3, 2),
    drawnEntryOf(4, 3),
    drawnEntryOf(5, 4),
  ]);
});

describe('D1WeekAwardExport.listForLaunches', () => {
  test('優勝したローンチにだけ、Product of the Week賞と受賞の週(ISO週)を返す', async () => {
    const found = await awardExport.listForLaunches(
      [1, 2, 3, 4, 5, 6].map(launchIdOf),
    );

    expect(found).toEqual(
      new Map<string, WeekAward[]>([
        [launchIdOf(1), [{ kind: 'product_of_the_week', period: '2026-W47' }]],
        [launchIdOf(3), [{ kind: 'product_of_the_week', period: '2026-W53' }]],
      ]),
    );
  });

  test('物理削除で優勝の枠の紐付けを解除した受賞は返さない', async () => {
    await store.unlinkOrDeleteByProduct(productIdOf(1));

    const found = await awardExport.listForLaunches([
      launchIdOf(1),
      launchIdOf(3),
    ]);

    expect(found).toEqual(
      new Map<string, WeekAward[]>([
        [launchIdOf(3), [{ kind: 'product_of_the_week', period: '2026-W53' }]],
      ]),
    );
  });

  test('ローンチのIDが空なら問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    const found = await new D1WeekAwardExport(
      recording.database,
    ).listForLaunches([]);

    expect(found.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるローンチのIDはバインド変数の上限に収まるよう分けて読み、重複を除く', async () => {
    const ids = [
      ...Array.from({ length: BULK_COUNT }, (_, offset) =>
        launchIdOf(100 + offset),
      ),
      launchIdOf(3),
      launchIdOf(3),
    ];
    const recording = createRecordingDatabase();

    const found = await new D1WeekAwardExport(
      recording.database,
    ).listForLaunches(ids);

    expect(found).toEqual(
      new Map<string, WeekAward[]>([
        [launchIdOf(3), [{ kind: 'product_of_the_week', period: '2026-W53' }]],
      ]),
    );
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
