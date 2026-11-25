import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  productIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  insertBrackets,
} from '../tournament/testing/bracket-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_START,
  WEEK_WINDOW,
  weekEntryIdOf,
  type WeekEntryFixture,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';

const DRAWN_AT = new Date('2026-11-24T07:45:10.000Z');

const FINISHED_AT = new Date('2026-11-28T07:45:00.000Z');

const FROZEN = {
  status: 'drawing',
  drawStartedAt: WEEK_WINDOW.drawAt,
  updatedAt: WEEK_WINDOW.drawAt,
} as const;

const store = new D1WeekTournamentStore(db);

async function readTournamentRow(index: number) {
  const [row] = await db
    .select()
    .from(weekTournaments)
    .where(eq(weekTournaments.id, weekTournamentIdOf(index)));
  return row;
}

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

// 利用者1のプロダクト1〜4を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
  await insertBrackets([
    { index: 1, participantCount: 3 },
    { index: 2, participantCount: 2 },
  ]);
});

describe('D1WeekTournamentStore.markDrawn', () => {
  beforeEach(async () => {
    await insertWeekTournaments([{ index: 1, columns: FROZEN }]);
    await insertWeekEntries([drawnEntryOf(1, 1)]);
  });

  test('組み合わせ決定中の週にブラケットと組み合わせの日時を記録し、進行中にする', async () => {
    await store.markDrawn(
      weekTournamentIdOf(1),
      bracketIdOf(1),
      null,
      DRAWN_AT,
    );

    await expect(readTournamentRow(1)).resolves.toMatchObject({
      status: 'in_progress',
      bracketId: bracketIdOf(1),
      drawStartedAt: WEEK_WINDOW.drawAt,
      drawnAt: DRAWN_AT,
      outcome: null,
      championEntryId: null,
      awardedAt: null,
      finishedAt: null,
      updatedAt: DRAWN_AT,
    });
  });

  test('参加1で組み合わせと同時に終わる週は、受賞・優勝の枠・受賞と終了の日時を記録して終える', async () => {
    await store.markDrawn(
      weekTournamentIdOf(1),
      bracketIdOf(1),
      { outcome: 'awarded', championEntryId: weekEntryIdOf(1) },
      DRAWN_AT,
    );

    await expect(readTournamentRow(1)).resolves.toMatchObject({
      status: 'finished',
      bracketId: bracketIdOf(1),
      drawnAt: DRAWN_AT,
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(1),
      awardedAt: DRAWN_AT,
      finishedAt: DRAWN_AT,
    });
  });

  test('参加0で終わる週は、受賞なしを受賞の日時なしで記録して終える', async () => {
    await store.markDrawn(
      weekTournamentIdOf(1),
      bracketIdOf(1),
      { outcome: 'no_award', championEntryId: null },
      DRAWN_AT,
    );

    await expect(readTournamentRow(1)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
      finishedAt: DRAWN_AT,
    });
  });

  test('組み合わせ決定中でない週(受付中・記録済みの進行中・終了)は変えない', async () => {
    await insertWeekTournaments([
      { index: 2, weekStart: '2026-11-23' },
      {
        index: 3,
        weekStart: '2026-11-09',
        columns: {
          status: 'in_progress',
          drawStartedAt: DRAWN_AT,
          drawnAt: DRAWN_AT,
          bracketId: bracketIdOf(2),
        },
      },
      {
        index: 4,
        weekStart: '2026-11-02',
        columns: { status: 'finished', outcome: 'no_award' },
      },
    ]);
    const before = await Promise.all([2, 3, 4].map(readTournamentRow));

    for (const index of [2, 3, 4]) {
      await store.markDrawn(
        weekTournamentIdOf(index),
        bracketIdOf(1),
        null,
        FINISHED_AT,
      );
    }

    await expect(
      Promise.all([2, 3, 4].map(readTournamentRow)),
    ).resolves.toEqual(before);
  });
});

describe('D1WeekTournamentStore.recordFinish', () => {
  beforeEach(async () => {
    await insertWeekTournaments([
      {
        index: 1,
        columns: {
          ...FROZEN,
          status: 'in_progress',
          bracketId: bracketIdOf(1),
          drawnAt: DRAWN_AT,
        },
      },
    ]);
    await insertWeekEntries([drawnEntryOf(1, 1), drawnEntryOf(2, 1)]);
  });

  test('進行中の週に受賞・優勝の枠・受賞と終了の日時を記録し、trueを返す', async () => {
    await expect(
      store.recordFinish(
        weekTournamentIdOf(1),
        'awarded',
        weekEntryIdOf(2),
        FINISHED_AT,
      ),
    ).resolves.toBe(true);

    await expect(readTournamentRow(1)).resolves.toMatchObject({
      status: 'finished',
      bracketId: bracketIdOf(1),
      drawnAt: DRAWN_AT,
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(2),
      awardedAt: FINISHED_AT,
      finishedAt: FINISHED_AT,
      updatedAt: FINISHED_AT,
    });
  });

  test('受賞なしは優勝の枠と受賞の日時を記録せずに終える', async () => {
    await expect(
      store.recordFinish(weekTournamentIdOf(1), 'no_award', null, FINISHED_AT),
    ).resolves.toBe(true);

    await expect(readTournamentRow(1)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
      finishedAt: FINISHED_AT,
    });
  });

  test('終了済みの週は2回目の確定で変えず、falseを返す', async () => {
    await store.recordFinish(
      weekTournamentIdOf(1),
      'awarded',
      weekEntryIdOf(1),
      FINISHED_AT,
    );
    const before = await readTournamentRow(1);

    await expect(
      store.recordFinish(
        weekTournamentIdOf(1),
        'awarded',
        weekEntryIdOf(2),
        new Date('2026-11-29T07:45:00.000Z'),
      ),
    ).resolves.toBe(false);
    await expect(readTournamentRow(1)).resolves.toEqual(before);
  });

  test('同時の2回の確定では1回だけtrueを返し、その確定の優勝の枠が残る', async () => {
    const results = await Promise.all([
      store.recordFinish(
        weekTournamentIdOf(1),
        'awarded',
        weekEntryIdOf(1),
        FINISHED_AT,
      ),
      store.recordFinish(
        weekTournamentIdOf(1),
        'awarded',
        weekEntryIdOf(2),
        FINISHED_AT,
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? weekEntryIdOf(1) : weekEntryIdOf(2);
    await expect(readTournamentRow(1)).resolves.toMatchObject({
      championEntryId: winner,
    });
  });

  test('存在しない週ではfalseを返す', async () => {
    await expect(
      store.recordFinish(weekTournamentIdOf(9), 'no_award', null, FINISHED_AT),
    ).resolves.toBe(false);
  });

  test('受賞に優勝の枠が無い、または受賞なしに優勝の枠があればRangeErrorにし、記録しない', async () => {
    const before = await readTournamentRow(1);

    await expect(
      store.recordFinish(weekTournamentIdOf(1), 'awarded', null, FINISHED_AT),
    ).rejects.toThrow(RangeError);
    await expect(
      store.recordFinish(
        weekTournamentIdOf(1),
        'no_award',
        weekEntryIdOf(1),
        FINISHED_AT,
      ),
    ).rejects.toThrow(RangeError);
    await expect(readTournamentRow(1)).resolves.toEqual(before);
  });
});

describe('D1WeekTournamentStore.listAwardedBetween', () => {
  const FROM = new Date('2026-11-24T08:00:00.000Z');
  const TO = new Date('2026-11-25T07:45:00.000Z');

  function finishedWeek(
    index: number,
    weekStart: string,
    columns: Parameters<typeof insertWeekTournaments>[0][number]['columns'],
  ) {
    return {
      index,
      weekStart,
      columns: { ...FROZEN, status: 'finished', finishedAt: TO, ...columns },
    } as const;
  }

  // 週1〜4の優勝の枠は同じ番号のプロダクト
  beforeEach(async () => {
    await insertWeekTournaments([
      finishedWeek(1, WEEK_START, {
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(1),
        awardedAt: new Date(TO.getTime() - 1),
      }),
      finishedWeek(2, '2026-11-09', {
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(2),
        awardedAt: FROM,
      }),
      finishedWeek(3, '2026-11-02', {
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(3),
        awardedAt: TO,
      }),
      finishedWeek(4, '2026-10-26', {
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(4),
        awardedAt: new Date(FROM.getTime() - 1),
      }),
      finishedWeek(5, '2026-10-19', { outcome: 'no_award' }),
    ]);
    await insertWeekEntries(
      [1, 2, 3, 4].map((index) => drawnEntryOf(index, index)),
    );
  });

  test('受賞の日時が起点ちょうどから終点の直前までの受賞を、週の初日と優勝のプロダクトで受賞の昇順に返す', async () => {
    await expect(store.listAwardedBetween(FROM, TO)).resolves.toEqual([
      {
        weekStart: parseBusinessDate('2026-11-09'),
        productId: productIdOf(2),
      },
      { weekStart: WEEK_START, productId: productIdOf(1) },
    ]);
  });

  test('物理削除で優勝の枠の紐付けを解除した受賞は除く', async () => {
    await store.unlinkOrDeleteByProduct(productIdOf(2));

    await expect(store.listAwardedBetween(FROM, TO)).resolves.toEqual([
      { weekStart: WEEK_START, productId: productIdOf(1) },
    ]);
  });

  test('期間内に受賞が無ければ空の一覧を返す', async () => {
    await expect(
      store.listAwardedBetween(
        new Date('2026-12-01T08:00:00.000Z'),
        new Date('2026-12-02T08:00:00.000Z'),
      ),
    ).resolves.toEqual([]);
  });
});
