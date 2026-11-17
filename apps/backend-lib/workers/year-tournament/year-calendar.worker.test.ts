import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type { YearCalendar } from '../../core/year-tournament/ports.ts';
import { yearScheduleFor } from '../../core/year-tournament/year-schedule.ts';
import { db } from '../product/testing/product-fixtures.ts';
import { D1YearTournamentStore } from './d1-year-tournament-store.ts';
import {
  clearYearTournamentTables,
  defaultScheduleOf,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearTournamentIdOf,
} from './testing/year-tournament-fixtures.ts';
import { YearTournamentCalendar } from './year-calendar.ts';

// 業務時刻の2026-12-01 0:00。2026年は5/31(日)が既定の決勝日で、組み合わせ決定の時刻を過ぎている
const NOW = new Date('2026-12-01T08:00:00.000Z');

const ADMIN_ID = '01JD0ADMN00000000000000001';

// 2027年に明示した決勝日。決済期限日は5/10(月)
const EXPLICIT_FINAL_DATE = parseBusinessDate('2027-05-16');
const EXPLICIT_SCHEDULE = yearScheduleFor(YEAR, EXPLICIT_FINAL_DATE);

// 2026年の決済期限日5/25(月)より前のWeek優勝の日
const AWARD_BEFORE_DEADLINE_2026 = parseBusinessDate('2026-05-17');

const calendar: YearCalendar = new YearTournamentCalendar(
  new D1YearTournamentStore(db),
);

function dateOf(value: string) {
  return parseBusinessDate(value);
}

function minutesBefore(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() - minutes * 60_000);
}

function scheduleColumnsOf(schedule: typeof YEAR_SCHEDULE) {
  return {
    finalDate: schedule.finalDate,
    deadlineDate: schedule.deadlineDate,
    acceptUntil: schedule.acceptUntil,
    deadlineAt: schedule.deadlineAt,
    drawAt: schedule.drawAt,
    changeLockAt: schedule.changeLockAt,
  };
}

async function countYearRows(): Promise<number> {
  return (await db.select().from(yearTournaments)).length;
}

async function insertFrozenYear(index: number, year: number): Promise<void> {
  await insertYearTournaments([
    {
      index,
      year,
      columns: {
        status: 'drawing',
        drawStartedAt: defaultScheduleOf(year).drawAt,
      },
    },
  ]);
}

beforeEach(async () => {
  await clearYearTournamentTables();
});

describe('YearTournamentCalendar.describe', () => {
  test('行のある年は行の列の日程・出どころ・記録を返し、凍結していなければ受付中にする', async () => {
    await insertYearTournaments([
      {
        index: 1,
        columns: {
          ...scheduleColumnsOf(EXPLICIT_SCHEDULE),
          finalDateSource: 'explicit',
          finalDateVersion: 1,
          finalDateUpdatedAt: NOW,
          finalDateUpdatedByAdminId: ADMIN_ID,
        },
      },
    ]);

    const years = await calendar.describe([YEAR], NOW);

    expect(years.get(YEAR)).toMatchObject({
      year: YEAR,
      schedule: EXPLICIT_SCHEDULE,
      source: 'explicit',
      state: 'open',
      record: {
        yearTournamentId: yearTournamentIdOf(1),
        year: YEAR,
        schedule: EXPLICIT_SCHEDULE,
        source: 'explicit',
        version: 1,
        updatedAt: NOW,
        updatedByAdminId: ADMIN_ID,
        status: 'open',
        drawStartedAt: null,
      },
    });
  });

  test('凍結済みの行の年は凍結済みにする', async () => {
    await insertFrozenYear(1, YEAR);

    const years = await calendar.describe([YEAR], NOW);

    expect(years.get(YEAR)).toMatchObject({
      year: YEAR,
      schedule: YEAR_SCHEDULE,
      source: 'default',
      state: 'frozen',
      record: { yearTournamentId: yearTournamentIdOf(1) },
    });
  });

  test('行の無い年は既定の決勝日の日程で、組み合わせ決定の時刻の前は開催予定にする', async () => {
    const schedule2026 = defaultScheduleOf(2026);

    const years = await calendar.describe(
      [2026, YEAR],
      minutesBefore(schedule2026.drawAt, 1),
    );

    expect(years.get(2026)).toEqual({
      year: 2026,
      schedule: schedule2026,
      source: 'default',
      state: 'planned',
      record: null,
    });
    expect(years.get(YEAR)).toEqual({
      year: YEAR,
      schedule: YEAR_SCHEDULE,
      source: 'default',
      state: 'planned',
      record: null,
    });
  });

  test('行の無い年は組み合わせ決定の時刻ちょうどから開催しなかった年にする', async () => {
    const schedule2026 = defaultScheduleOf(2026);

    const years = await calendar.describe([2026], schedule2026.drawAt);

    expect(years.get(2026)).toEqual({
      year: 2026,
      schedule: schedule2026,
      source: 'default',
      state: 'not_held',
      record: null,
    });
  });

  test('重複した年を1件にまとめ、照会で年の行を作らない', async () => {
    const years = await calendar.describe([2026, YEAR, 2026], NOW);

    expect([...years.keys()].toSorted()).toEqual([2026, YEAR]);
    expect(await countYearRows()).toBe(0);
  });
});

describe('YearTournamentCalendar.upcoming', () => {
  test('現在の年が開催しなかった年なら、行の無い翌年を開催予定として返し、行を作らない', async () => {
    const upcoming = await calendar.upcoming(NOW);

    expect(upcoming).toEqual({
      year: YEAR,
      schedule: YEAR_SCHEDULE,
      source: 'default',
      state: 'planned',
    });
    expect(await countYearRows()).toBe(0);
  });

  test('組み合わせ決定の時刻を過ぎても凍結していない現在の年は受付中として返す', async () => {
    await insertYearTournaments([{ index: 1, year: 2026 }]);

    const upcoming = await calendar.upcoming(NOW);

    expect(upcoming).toMatchObject({ year: 2026, state: 'open' });
  });

  test('凍結済みの年を飛ばす', async () => {
    await insertFrozenYear(1, 2026);

    const upcoming = await calendar.upcoming(NOW);

    expect(upcoming).toMatchObject({ year: YEAR, state: 'planned' });
  });
});

describe('YearTournamentCalendar.ensureUpcoming', () => {
  test('次に開催する年の行が無ければ既定の決勝日の日程で作る', async () => {
    const record = await calendar.ensureUpcoming(NOW);

    expect(record).toMatchObject({
      year: YEAR,
      schedule: YEAR_SCHEDULE,
      source: 'default',
      version: 0,
      status: 'open',
      drawStartedAt: null,
    });
    const rows = await db.select().from(yearTournaments);
    expect(rows.map(({ year }) => year)).toEqual([YEAR]);
  });

  test('次に開催する年の行があれば保存済みの列のまま返し、行を増やさない', async () => {
    await insertYearTournaments([
      {
        index: 1,
        columns: {
          ...scheduleColumnsOf(EXPLICIT_SCHEDULE),
          finalDateSource: 'explicit',
          finalDateVersion: 1,
        },
      },
    ]);

    const record = await calendar.ensureUpcoming(NOW);

    expect(record).toMatchObject({
      yearTournamentId: yearTournamentIdOf(1),
      schedule: EXPLICIT_SCHEDULE,
      source: 'explicit',
    });
    expect(await countYearRows()).toBe(1);
  });

  test('現在の年が凍結済みなら翌年の行を作る', async () => {
    await insertFrozenYear(1, 2026);

    const record = await calendar.ensureUpcoming(NOW);

    expect(record).toMatchObject({ year: YEAR, status: 'open' });
    expect(await countYearRows()).toBe(2);
  });

  test('同時に呼んでも行は1つにそろう', async () => {
    const [first, second] = await Promise.all([
      calendar.ensureUpcoming(NOW),
      calendar.ensureUpcoming(NOW),
    ]);

    expect(first.yearTournamentId).toBe(second.yearTournamentId);
    expect(await countYearRows()).toBe(1);
  });
});

describe('YearTournamentCalendar.resolveAward', () => {
  test('初年度は開催しなかった年の対象期間のWeek優勝を、行の無い翌年の開催予定の年の対象にする', async () => {
    const resolution = await calendar.resolveAward(
      AWARD_BEFORE_DEADLINE_2026,
      NOW,
    );

    expect(resolution).toEqual({
      kind: 'open',
      year: {
        year: YEAR,
        schedule: YEAR_SCHEDULE,
        source: 'default',
        state: 'planned',
      },
    });
    expect(await countYearRows()).toBe(0);
  });

  test('行の無い年は組み合わせ決定の時刻の前なら、その年の対象期間のWeek優勝を開催予定のその年の対象にする', async () => {
    const schedule2026 = defaultScheduleOf(2026);

    const resolution = await calendar.resolveAward(
      AWARD_BEFORE_DEADLINE_2026,
      minutesBefore(schedule2026.drawAt, 1),
    );

    expect(resolution).toEqual({
      kind: 'open',
      year: {
        year: 2026,
        schedule: schedule2026,
        source: 'default',
        state: 'planned',
      },
    });
    expect(await countYearRows()).toBe(0);
  });

  test('決済期限日の前日のWeek優勝はその年、当日のWeek優勝は翌年の対象にする', async () => {
    await insertYearTournaments([{ index: 1 }]);

    const beforeDeadline = await calendar.resolveAward(
      dateOf('2027-05-23'),
      NOW,
    );
    const onDeadline = await calendar.resolveAward(dateOf('2027-05-24'), NOW);

    expect(beforeDeadline).toMatchObject({
      kind: 'open',
      year: { year: YEAR, state: 'open' },
    });
    expect(onDeadline).toMatchObject({
      kind: 'open',
      year: { year: 2028, state: 'planned', schedule: defaultScheduleOf(2028) },
    });
  });

  test('凍結済みの年の対象期間のWeek優勝は遅れとする', async () => {
    await insertFrozenYear(1, YEAR);

    const resolution = await calendar.resolveAward(dateOf('2027-05-20'), NOW);

    expect(resolution).toEqual({ kind: 'late', year: YEAR });
  });

  test('組み合わせ決定の途中の年(凍結済みで組み合わせを記録する前)の対象期間のWeek優勝も遅れとする', async () => {
    await insertYearTournaments([
      {
        index: 1,
        columns: { status: 'drawing', drawStartedAt: YEAR_SCHEDULE.drawAt },
      },
    ]);

    const resolution = await calendar.resolveAward(
      dateOf('2027-05-23'),
      YEAR_SCHEDULE.drawAt,
    );

    expect(resolution).toEqual({ kind: 'late', year: YEAR });
  });

  test('行の決勝日の列を書き換えると、対象年と期限が新しい列から求まる', async () => {
    await insertYearTournaments([{ index: 1 }]);
    const awardedDate = dateOf('2027-05-12');
    const before = await calendar.resolveAward(awardedDate, NOW);

    await db
      .update(yearTournaments)
      .set({
        ...scheduleColumnsOf(EXPLICIT_SCHEDULE),
        finalDateSource: 'explicit',
        finalDateVersion: 1,
      })
      .where(eq(yearTournaments.id, yearTournamentIdOf(1)));
    const after = await calendar.resolveAward(awardedDate, NOW);
    const described = await calendar.describe([YEAR], NOW);

    expect(before).toMatchObject({
      kind: 'open',
      year: { year: YEAR, schedule: YEAR_SCHEDULE },
    });
    expect(after).toMatchObject({ kind: 'open', year: { year: 2028 } });
    expect(described.get(YEAR)).toMatchObject({
      schedule: EXPLICIT_SCHEDULE,
      source: 'explicit',
    });
  });
});

describe('YearTournamentCalendar.openPeriodStart', () => {
  test('凍結済みの年が無ければ起点なし', async () => {
    await insertYearTournaments([{ index: 1 }]);

    expect(await calendar.openPeriodStart(NOW)).toBeNull();
  });

  test('凍結済みの最新の年の決済期限日の0:00を返し、凍結していない年を見ない', async () => {
    await insertFrozenYear(1, 2026);
    await insertFrozenYear(2, YEAR);
    await insertYearTournaments([{ index: 3, year: 2028 }]);

    const start = await calendar.openPeriodStart(NOW);

    expect(start).toEqual(
      fromBusinessDateTime(YEAR_SCHEDULE.deadlineDate, { hour: 0, minute: 0 }),
    );
  });
});
