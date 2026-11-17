import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type { YearTournamentRecord } from '../../core/year-tournament/ports.ts';
import { yearScheduleFor } from '../../core/year-tournament/year-schedule.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { db } from '../product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  insertBrackets,
} from '../tournament/testing/bracket-fixtures.ts';
import { D1YearTournamentStore } from './d1-year-tournament-store.ts';
import {
  clearYearTournamentTables,
  defaultScheduleOf,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearEntryIdOf,
  yearTournamentIdOf,
} from './testing/year-tournament-fixtures.ts';

const YEARS_OVER_ONE_STATEMENT = 95;

const AT = new Date('2026-12-01T08:00:00.000Z');

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const store = new D1YearTournamentStore(db);

function openRecordOf(
  index: number,
  year: number = YEAR,
): YearTournamentRecord {
  return {
    yearTournamentId: yearTournamentIdOf(index),
    year,
    schedule: defaultScheduleOf(year),
    source: 'default',
    version: 0,
    updatedAt: null,
    updatedByAdminId: null,
    status: 'open',
    drawStartedAt: null,
    bracketId: null,
    firstRoundDate: null,
    participantCount: null,
    outcome: null,
    championEntryId: null,
    awardedAt: null,
  };
}

async function readYearRows() {
  return db.select().from(yearTournaments);
}

async function readYearRow(index: number) {
  const [row] = await db
    .select()
    .from(yearTournaments)
    .where(eq(yearTournaments.id, yearTournamentIdOf(index)));
  return row;
}

beforeEach(async () => {
  await clearYearTournamentTables();
});

describe('D1YearTournamentStore.ensureYear', () => {
  test('既定の日の日程の列で受付中の年を作り、決勝日の版を0にして記録を返す', async () => {
    const record = await store.ensureYear(YEAR, YEAR_SCHEDULE, AT);

    expect(record.yearTournamentId).toMatch(ULID);
    expect(record).toEqual({
      ...openRecordOf(1),
      yearTournamentId: record.yearTournamentId,
    });
    await expect(readYearRows()).resolves.toEqual([
      expect.objectContaining({
        id: record.yearTournamentId,
        year: YEAR,
        finalDate: '2027-05-30',
        finalDateSource: 'default',
        finalDateVersion: 0,
        finalDateUpdatedAt: null,
        finalDateUpdatedByAdminId: null,
        deadlineDate: '2027-05-24',
        acceptUntil: YEAR_SCHEDULE.acceptUntil,
        deadlineAt: YEAR_SCHEDULE.deadlineAt,
        drawAt: YEAR_SCHEDULE.drawAt,
        changeLockAt: YEAR_SCHEDULE.changeLockAt,
        status: 'open',
        createdAt: AT,
        updatedAt: AT,
      }),
    ]);
  });

  test('同じ年を2回・同時に用意しても行は1つで、同じ記録を返す', async () => {
    const results = await Promise.all([
      store.ensureYear(YEAR, YEAR_SCHEDULE, AT),
      store.ensureYear(YEAR, YEAR_SCHEDULE, AT),
    ]);
    const again = await store.ensureYear(YEAR, YEAR_SCHEDULE, AT);

    expect(results[1]).toEqual(results[0]);
    expect(again).toEqual(results[0]);
    await expect(readYearRows()).resolves.toHaveLength(1);
  });

  test('既にある年は重複を無視し、保存した決勝日と期限の列の記録を返す', async () => {
    const explicit = yearScheduleFor(YEAR, parseBusinessDate('2027-05-23'));
    const savedAt = new Date('2026-11-30T08:00:00.000Z');
    await insertYearTournaments([
      {
        index: 1,
        columns: {
          finalDate: explicit.finalDate,
          finalDateSource: 'explicit',
          finalDateVersion: 2,
          finalDateUpdatedAt: savedAt,
          finalDateUpdatedByAdminId: 'admin-1',
          deadlineDate: explicit.deadlineDate,
          acceptUntil: explicit.acceptUntil,
          deadlineAt: explicit.deadlineAt,
          drawAt: explicit.drawAt,
          changeLockAt: explicit.changeLockAt,
        },
      },
    ]);

    await expect(store.ensureYear(YEAR, YEAR_SCHEDULE, AT)).resolves.toEqual({
      ...openRecordOf(1),
      schedule: explicit,
      source: 'explicit',
      version: 2,
      updatedAt: savedAt,
      updatedByAdminId: 'admin-1',
    });
    await expect(readYearRows()).resolves.toHaveLength(1);
  });

  test('日程の対象年が年と食い違えばRangeErrorにし、何も書かない', async () => {
    await expect(
      store.ensureYear(YEAR, defaultScheduleOf(YEAR + 1), AT),
    ).rejects.toThrow(RangeError);
    await expect(readYearRows()).resolves.toEqual([]);
  });
});

describe('D1YearTournamentStore.findByYears・findById', () => {
  const DRAWN_AT = new Date('2027-05-25T06:45:10.000Z');

  beforeEach(async () => {
    await insertBrackets([{ index: 1, kind: 'year', participantCount: 13 }]);
    await insertYearTournaments([
      { index: 1, year: 2026 },
      {
        index: 2,
        year: 2027,
        columns: {
          status: 'finished',
          drawStartedAt: YEAR_SCHEDULE.drawAt,
          drawnAt: DRAWN_AT,
          bracketId: bracketIdOf(1),
          firstRoundDate: '2027-05-27',
          participantCount: 13,
          outcome: 'awarded',
          championEntryId: yearEntryIdOf(1),
          awardedAt: DRAWN_AT,
          finishedAt: DRAWN_AT,
        },
      },
    ]);
  });

  test('年ごとに組み合わせと受賞を含む記録を引き当て、行の無い年と重複した年を除いて返す', async () => {
    const found = await store.findByYears([2027, 2026, 2028, 2027]);

    expect([...found.keys()].toSorted()).toEqual([2026, 2027]);
    expect(found.get(2026)).toEqual(openRecordOf(1, 2026));
    expect(found.get(2027)).toEqual({
      ...openRecordOf(2, 2027),
      status: 'finished',
      drawStartedAt: YEAR_SCHEDULE.drawAt,
      bracketId: bracketIdOf(1),
      firstRoundDate: parseBusinessDate('2027-05-27'),
      participantCount: 13,
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(1),
      awardedAt: DRAWN_AT,
    });
  });

  test('識別子で年の記録を読み、無い年はundefinedを返す', async () => {
    await expect(store.findById(yearTournamentIdOf(1))).resolves.toEqual(
      openRecordOf(1, 2026),
    );
    await expect(
      store.findById(yearTournamentIdOf(9)),
    ).resolves.toBeUndefined();
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1YearTournamentStore(recording.database).findByYears([]),
    ).resolves.toEqual(new Map());
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超える年はバインド変数の上限に収まるよう分けて引き当て、すべて結果に含める', async () => {
    const years = Array.from(
      { length: YEARS_OVER_ONE_STATEMENT },
      (_, offset) => 2030 + offset,
    );
    await insertYearTournaments(
      years.map((year, offset) => ({ index: offset + 10, year })),
    );
    const recording = createRecordingDatabase();

    const found = await new D1YearTournamentStore(
      recording.database,
    ).findByYears(years);

    expect([...found.keys()].toSorted()).toEqual(years);
    expect(found.get(2124)).toEqual(openRecordOf(104, 2124));
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1YearTournamentStore.listDue', () => {
  // 2026年の組み合わせ決定は2026-05-26T06:45Z、2027年は2027-05-25T06:45Z
  const DUE_2027 = defaultScheduleOf(2027).drawAt;

  beforeEach(async () => {
    await insertYearTournaments([
      { index: 1, year: 2028 },
      { index: 2, year: 2027 },
      {
        index: 3,
        year: 2026,
        columns: { status: 'drawing', drawStartedAt: AT },
      },
      {
        index: 4,
        year: 2025,
        columns: { status: 'in_progress', drawStartedAt: AT },
      },
      {
        index: 5,
        year: 2024,
        columns: {
          status: 'finished',
          drawStartedAt: AT,
          outcome: 'no_award',
        },
      },
    ]);
  });

  test('組み合わせ決定の日時が到来した受付中と組み合わせ決定中の年だけを、年の昇順で返す', async () => {
    const due = await store.listDue(DUE_2027, 10);

    expect(due.map(({ year }) => year)).toEqual([2026, 2027]);
    expect(due[1]).toEqual(openRecordOf(2, 2027));
  });

  test('組み合わせ決定の日時の1ミリ秒前の年は返さない', async () => {
    const due = await store.listDue(new Date(DUE_2027.getTime() - 1), 10);

    expect(due.map(({ year }) => year)).toEqual([2026]);
  });

  test('件数の上限まで古い年から返す', async () => {
    const due = await store.listDue(DUE_2027, 1);

    expect(due.map(({ year }) => year)).toEqual([2026]);
  });
});

describe('D1YearTournamentStore.listInProgress', () => {
  test('進行中の年だけを年の昇順に、件数の上限まで返す', async () => {
    await insertYearTournaments([
      { index: 1, year: 2028, columns: { status: 'in_progress' } },
      { index: 2, year: 2026, columns: { status: 'in_progress' } },
      { index: 3, year: 2027, columns: { status: 'in_progress' } },
      { index: 4, year: 2025, columns: { status: 'drawing' } },
      {
        index: 5,
        year: 2024,
        columns: { status: 'finished', outcome: 'no_award' },
      },
    ]);

    const all = await store.listInProgress(10);
    const first = await store.listInProgress(2);

    expect(all.map(({ year }) => year)).toEqual([2026, 2027, 2028]);
    expect(first.map(({ year }) => year)).toEqual([2026, 2027]);
  });
});

describe('D1YearTournamentStore.latestFrozenDeadlineDate', () => {
  test('凍結済みの年が無ければnullを返す', async () => {
    await insertYearTournaments([{ index: 1, year: 2027 }]);

    await expect(store.latestFrozenDeadlineDate()).resolves.toBeNull();
  });

  test('凍結済みの年の決済期限日の最大を返し、凍結前の年の後の決済期限日は数えない', async () => {
    await insertYearTournaments([
      {
        index: 1,
        year: 2025,
        columns: {
          status: 'finished',
          drawStartedAt: AT,
          outcome: 'no_award',
        },
      },
      {
        index: 2,
        year: 2026,
        columns: { status: 'in_progress', drawStartedAt: AT },
      },
      { index: 3, year: 2027 },
    ]);

    await expect(store.latestFrozenDeadlineDate()).resolves.toBe(
      defaultScheduleOf(2026).deadlineDate,
    );
  });
});

describe('D1YearTournamentStore.freeze', () => {
  beforeEach(async () => {
    await insertYearTournaments([{ index: 1 }]);
  });

  test('凍結前の年に凍結の日時と組み合わせ決定中を記録し、frozenを返す', async () => {
    await expect(
      store.freeze(yearTournamentIdOf(1), YEAR_SCHEDULE.drawAt),
    ).resolves.toBe('frozen');

    await expect(readYearRow(1)).resolves.toMatchObject({
      status: 'drawing',
      drawStartedAt: YEAR_SCHEDULE.drawAt,
      updatedAt: YEAR_SCHEDULE.drawAt,
    });
  });

  test('凍結済みの年は凍結の日時を変えず、alreadyを返す', async () => {
    await store.freeze(yearTournamentIdOf(1), YEAR_SCHEDULE.drawAt);
    const before = await readYearRow(1);

    await expect(
      store.freeze(
        yearTournamentIdOf(1),
        new Date(YEAR_SCHEDULE.drawAt.getTime() + 60_000),
      ),
    ).resolves.toBe('already');
    await expect(readYearRow(1)).resolves.toEqual(before);
  });

  test('同時の2回の凍結では1回だけfrozenを返す', async () => {
    const results = await Promise.all([
      store.freeze(yearTournamentIdOf(1), YEAR_SCHEDULE.drawAt),
      store.freeze(
        yearTournamentIdOf(1),
        new Date(YEAR_SCHEDULE.drawAt.getTime() + 1),
      ),
    ]);

    expect(results.toSorted()).toEqual(['already', 'frozen']);
  });

  test('凍結の後に組み合わせを記録した年の状態を組み合わせ決定中へ戻さない', async () => {
    await insertYearTournaments([
      {
        index: 2,
        year: 2026,
        columns: { status: 'in_progress', drawStartedAt: AT },
      },
    ]);
    const before = await readYearRow(2);

    await expect(store.freeze(yearTournamentIdOf(2), AT)).resolves.toBe(
      'already',
    );
    await expect(readYearRow(2)).resolves.toEqual(before);
  });

  test('無い年はalreadyを返す', async () => {
    await expect(store.freeze(yearTournamentIdOf(9), AT)).resolves.toBe(
      'already',
    );
  });
});
