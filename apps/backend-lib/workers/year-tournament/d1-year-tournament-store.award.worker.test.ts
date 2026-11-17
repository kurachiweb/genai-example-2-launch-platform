import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
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
import {
  bracketIdOf,
  insertBrackets,
} from '../tournament/testing/bracket-fixtures.ts';
import { D1YearTournamentStore } from './d1-year-tournament-store.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR_SCHEDULE,
  type YearEntryFixture,
  yearEntryIdOf,
  type YearTournamentFixture,
  yearTournamentIdOf,
} from './testing/year-tournament-fixtures.ts';

const PRODUCT_IDS_OVER_ONE_STATEMENT = 95;

const DRAWN_AT = new Date('2027-05-25T06:45:10.000Z');

const FINISHED_AT = new Date('2027-05-31T06:45:00.000Z');

const FROZEN = {
  status: 'drawing',
  drawStartedAt: YEAR_SCHEDULE.drawAt,
  updatedAt: YEAR_SCHEDULE.drawAt,
} as const;

const store = new D1YearTournamentStore(db);

async function readYearRow(index: number) {
  const [row] = await db
    .select()
    .from(yearTournaments)
    .where(eq(yearTournaments.id, yearTournamentIdOf(index)));
  return row;
}

function drawnEntryOf(index: number): YearEntryFixture {
  return {
    index,
    launch: index,
    product: index,
    owner: 1,
    columns: {
      status: 'drawn',
      entitlementSource: 'ultras',
      entitledAt: YEAR_SCHEDULE.deadlineAt,
      classifiedYear: 2027,
    },
  };
}

// 物理削除で組み合わせに入った枠の紐付けを解除した状態にする
async function unlinkEntry(index: number): Promise<void> {
  await db
    .update(yearTournamentEntries)
    .set({ launchId: null, productId: null, ownerUserId: null })
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
}

function finishedYear(
  index: number,
  year: number,
  columns: YearTournamentFixture['columns'],
): YearTournamentFixture {
  return {
    index,
    year,
    columns: {
      ...FROZEN,
      status: 'finished',
      finishedAt: FINISHED_AT,
      ...columns,
    },
  };
}

// 利用者1のプロダクト1〜4を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
  await insertBrackets([
    { index: 1, kind: 'year', participantCount: 13 },
    { index: 2, kind: 'year', participantCount: 1 },
  ]);
});

describe('D1YearTournamentStore.markDrawn', () => {
  beforeEach(async () => {
    await insertYearTournaments([{ index: 1, columns: FROZEN }]);
    await insertYearEntries([drawnEntryOf(1)]);
  });

  test('組み合わせ決定中の年にブラケット・1回戦の日・参加数・組み合わせの日時を記録し、進行中にする', async () => {
    await store.markDrawn(
      yearTournamentIdOf(1),
      {
        bracketId: bracketIdOf(1),
        firstRoundDate: parseBusinessDate('2027-05-27'),
        participantCount: 13,
        finished: null,
      },
      DRAWN_AT,
    );

    await expect(readYearRow(1)).resolves.toMatchObject({
      status: 'in_progress',
      bracketId: bracketIdOf(1),
      firstRoundDate: '2027-05-27',
      participantCount: 13,
      drawStartedAt: YEAR_SCHEDULE.drawAt,
      drawnAt: DRAWN_AT,
      outcome: null,
      championEntryId: null,
      awardedAt: null,
      finishedAt: null,
      updatedAt: DRAWN_AT,
    });
  });

  test('参加1で組み合わせと同時に終わる年は、1回戦の日なしで受賞・優勝の枠・受賞と終了の日時を記録して終える', async () => {
    await store.markDrawn(
      yearTournamentIdOf(1),
      {
        bracketId: bracketIdOf(2),
        firstRoundDate: null,
        participantCount: 1,
        finished: { outcome: 'awarded', championEntryId: yearEntryIdOf(1) },
      },
      DRAWN_AT,
    );

    await expect(readYearRow(1)).resolves.toMatchObject({
      status: 'finished',
      bracketId: bracketIdOf(2),
      firstRoundDate: null,
      participantCount: 1,
      drawnAt: DRAWN_AT,
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(1),
      awardedAt: DRAWN_AT,
      finishedAt: DRAWN_AT,
    });
  });

  test('参加0で終わる年は、受賞なしを受賞の日時なしで記録して終える', async () => {
    await store.markDrawn(
      yearTournamentIdOf(1),
      {
        bracketId: bracketIdOf(2),
        firstRoundDate: null,
        participantCount: 0,
        finished: { outcome: 'no_award', championEntryId: null },
      },
      DRAWN_AT,
    );

    await expect(readYearRow(1)).resolves.toMatchObject({
      status: 'finished',
      participantCount: 0,
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
      finishedAt: DRAWN_AT,
    });
  });

  test('組み合わせ決定中でない年(受付中・記録済みの進行中・終了)は変えない', async () => {
    await insertYearTournaments([
      { index: 2, year: 2028 },
      {
        index: 3,
        year: 2026,
        columns: {
          status: 'in_progress',
          drawStartedAt: DRAWN_AT,
          drawnAt: DRAWN_AT,
          bracketId: bracketIdOf(2),
        },
      },
      {
        index: 4,
        year: 2025,
        columns: { status: 'finished', outcome: 'no_award' },
      },
    ]);
    const before = await Promise.all([2, 3, 4].map(readYearRow));

    for (const index of [2, 3, 4]) {
      await store.markDrawn(
        yearTournamentIdOf(index),
        {
          bracketId: bracketIdOf(1),
          firstRoundDate: parseBusinessDate('2027-05-27'),
          participantCount: 13,
          finished: null,
        },
        FINISHED_AT,
      );
    }

    await expect(Promise.all([2, 3, 4].map(readYearRow))).resolves.toEqual(
      before,
    );
  });
});

describe('D1YearTournamentStore.recordFinish', () => {
  beforeEach(async () => {
    await insertYearTournaments([
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
    await insertYearEntries([drawnEntryOf(1), drawnEntryOf(2)]);
  });

  test('進行中の年に受賞・優勝の枠・受賞と終了の日時を記録し、trueを返す', async () => {
    await expect(
      store.recordFinish(
        yearTournamentIdOf(1),
        'awarded',
        yearEntryIdOf(2),
        FINISHED_AT,
      ),
    ).resolves.toBe(true);

    await expect(readYearRow(1)).resolves.toMatchObject({
      status: 'finished',
      bracketId: bracketIdOf(1),
      drawnAt: DRAWN_AT,
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(2),
      awardedAt: FINISHED_AT,
      finishedAt: FINISHED_AT,
      updatedAt: FINISHED_AT,
    });
  });

  test('受賞なしは優勝の枠と受賞の日時を記録せずに終える', async () => {
    await expect(
      store.recordFinish(yearTournamentIdOf(1), 'no_award', null, FINISHED_AT),
    ).resolves.toBe(true);

    await expect(readYearRow(1)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
      finishedAt: FINISHED_AT,
    });
  });

  test('終了済みの年は2回目の確定で変えず、falseを返す', async () => {
    await store.recordFinish(
      yearTournamentIdOf(1),
      'awarded',
      yearEntryIdOf(1),
      FINISHED_AT,
    );
    const before = await readYearRow(1);

    await expect(
      store.recordFinish(
        yearTournamentIdOf(1),
        'awarded',
        yearEntryIdOf(2),
        new Date(FINISHED_AT.getTime() + 86_400_000),
      ),
    ).resolves.toBe(false);
    await expect(readYearRow(1)).resolves.toEqual(before);
  });

  test('同時の2回の確定では1回だけtrueを返し、その確定の優勝の枠が残る', async () => {
    const results = await Promise.all([
      store.recordFinish(
        yearTournamentIdOf(1),
        'awarded',
        yearEntryIdOf(1),
        FINISHED_AT,
      ),
      store.recordFinish(
        yearTournamentIdOf(1),
        'awarded',
        yearEntryIdOf(2),
        FINISHED_AT,
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? yearEntryIdOf(1) : yearEntryIdOf(2);
    await expect(readYearRow(1)).resolves.toMatchObject({
      championEntryId: winner,
    });
  });

  test('存在しない年ではfalseを返す', async () => {
    await expect(
      store.recordFinish(yearTournamentIdOf(9), 'no_award', null, FINISHED_AT),
    ).resolves.toBe(false);
  });

  test('受賞に優勝の枠が無い、または受賞なしに優勝の枠があればRangeErrorにし、記録しない', async () => {
    const before = await readYearRow(1);

    await expect(
      store.recordFinish(yearTournamentIdOf(1), 'awarded', null, FINISHED_AT),
    ).rejects.toThrow(RangeError);
    await expect(
      store.recordFinish(
        yearTournamentIdOf(1),
        'no_award',
        yearEntryIdOf(1),
        FINISHED_AT,
      ),
    ).rejects.toThrow(RangeError);
    await expect(readYearRow(1)).resolves.toEqual(before);
  });
});

describe('D1YearTournamentStore.listAwardedBetween', () => {
  const FROM = new Date('2027-05-31T08:00:00.000Z');
  const TO = new Date('2027-06-01T06:45:00.000Z');

  // 年1〜4の優勝の枠は同じ番号のプロダクト
  beforeEach(async () => {
    await insertYearTournaments([
      finishedYear(1, 2027, {
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(1),
        awardedAt: new Date(TO.getTime() - 1),
      }),
      finishedYear(2, 2026, {
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(2),
        awardedAt: FROM,
      }),
      finishedYear(3, 2025, {
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(3),
        awardedAt: TO,
      }),
      finishedYear(4, 2024, {
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(4),
        awardedAt: new Date(FROM.getTime() - 1),
      }),
      finishedYear(5, 2023, { outcome: 'no_award' }),
    ]);
    await insertYearEntries([1, 2, 3, 4].map(drawnEntryOf));
  });

  test('受賞の日時が起点ちょうどから終点の直前までの受賞を、年と優勝のプロダクトで受賞の昇順に返す', async () => {
    await expect(store.listAwardedBetween(FROM, TO)).resolves.toEqual([
      {
        yearTournamentId: yearTournamentIdOf(2),
        year: 2026,
        productId: productIdOf(2),
      },
      {
        yearTournamentId: yearTournamentIdOf(1),
        year: 2027,
        productId: productIdOf(1),
      },
    ]);
  });

  test('物理削除で優勝の枠の紐付けを解除した受賞は除く', async () => {
    await unlinkEntry(2);

    await expect(store.listAwardedBetween(FROM, TO)).resolves.toEqual([
      {
        yearTournamentId: yearTournamentIdOf(1),
        year: 2027,
        productId: productIdOf(1),
      },
    ]);
  });

  test('期間内に受賞が無ければ空の一覧を返す', async () => {
    await expect(
      store.listAwardedBetween(
        new Date('2027-06-02T07:00:00.000Z'),
        new Date('2027-06-03T07:00:00.000Z'),
      ),
    ).resolves.toEqual([]);
  });
});

describe('D1YearTournamentStore.listAwardsByProducts', () => {
  const AWARDED_2026 = new Date('2026-06-01T06:45:00.000Z');
  const AWARDED_2027 = new Date('2027-05-31T06:45:00.000Z');

  // プロダクト1は2026年と2027年に受賞し、プロダクト2は組み合わせに入っただけ、プロダクト3は2025年に受賞した後に紐付けを解除した
  beforeEach(async () => {
    await insertLaunch(5, 1, {
      launchDate: '2027-01-15',
      outcome: 'won',
      decidedAt: new Date('2027-01-16T07:40:00.000Z'),
    });
    await insertYearTournaments([
      finishedYear(1, 2027, {
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(5),
        awardedAt: AWARDED_2027,
      }),
      finishedYear(2, 2026, {
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(1),
        awardedAt: AWARDED_2026,
      }),
      finishedYear(3, 2025, {
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(3),
        awardedAt: new Date('2025-05-26T06:45:00.000Z'),
      }),
      finishedYear(4, 2024, { outcome: 'no_award' }),
    ]);
    await insertYearEntries([
      drawnEntryOf(1),
      drawnEntryOf(2),
      drawnEntryOf(3),
      { ...drawnEntryOf(5), launch: 5, product: 1 },
    ]);
    await unlinkEntry(3);
  });

  test('プロダクトごとの受賞を、受賞したローンチ・年・受賞の日時で受賞の昇順に返す', async () => {
    await expect(
      store.listAwardsByProducts([
        productIdOf(1),
        productIdOf(2),
        productIdOf(3),
        productIdOf(1),
      ]),
    ).resolves.toEqual([
      {
        productId: productIdOf(1),
        launchId: launchIdOf(1),
        year: 2026,
        awardedAt: AWARDED_2026,
      },
      {
        productId: productIdOf(1),
        launchId: launchIdOf(5),
        year: 2027,
        awardedAt: AWARDED_2027,
      },
    ]);
  });

  test('紐付けを解除した受賞と受賞の無いプロダクトは空の一覧を返す', async () => {
    await expect(
      store.listAwardsByProducts([productIdOf(2), productIdOf(3)]),
    ).resolves.toEqual([]);
  });

  test('空の入力では問い合わせずに空の一覧を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1YearTournamentStore(recording.database).listAwardsByProducts([]),
    ).resolves.toEqual([]);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるプロダクトはバインド変数の上限に収まるよう分けて引き当て、すべて結果に含める', async () => {
    const productIds = [
      ...Array.from(
        { length: PRODUCT_IDS_OVER_ONE_STATEMENT - 1 },
        (_, offset) => productIdOf(100 + offset),
      ),
      productIdOf(1),
    ];
    const recording = createRecordingDatabase();

    const awards = await new D1YearTournamentStore(
      recording.database,
    ).listAwardsByProducts(productIds);

    expect(awards.map(({ year }) => year)).toEqual([2026, 2027]);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
