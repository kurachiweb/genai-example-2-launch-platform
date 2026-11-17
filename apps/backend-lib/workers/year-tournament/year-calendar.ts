import {
  type BusinessDate,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../../core/time/business-time.ts';
import type {
  YearCalendar,
  YearCalendarEntry,
  YearTournamentRecord,
  YearTournamentStore,
} from '../../core/year-tournament/ports.ts';
import {
  defaultFinalDate,
  type YearSchedule,
  yearScheduleFor,
} from '../../core/year-tournament/year-schedule.ts';
import {
  resolveTargetYear,
  type TargetYearResolution,
  type YearCalendarYear,
} from '../../core/year-tournament/year-target-rules.ts';

// resolveTargetYearが調べる年数(Week優勝の日の年〜3年後)
const AWARD_LOOKUP_YEARS = 4;
// 翌年の決勝日を1月にすると組み合わせ決定が現在の年の年末になり、翌年も凍結済みになり得るため2年後まで調べる
const UPCOMING_LOOKUP_YEARS = 3;

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

function yearOf(date: BusinessDate): number {
  return Number(date.slice(0, 4));
}

function yearsFrom(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, offset) => first + offset);
}

function defaultScheduleOf(year: number): YearSchedule {
  return yearScheduleFor(year, defaultFinalDate(year));
}

function storedEntryOf(record: YearTournamentRecord): YearCalendarEntry {
  return Object.freeze({
    year: record.year,
    schedule: record.schedule,
    source: record.source,
    state: record.drawStartedAt === null ? 'open' : 'frozen',
    record,
  });
}

// 組み合わせ決定の時刻を過ぎても行が無い年は、その時刻に開催しなかった年として扱う
function defaultEntryOf(year: number, now: Date): YearCalendarEntry {
  const schedule = defaultScheduleOf(year);
  return Object.freeze({
    year,
    schedule,
    source: 'default',
    state: schedule.drawAt.getTime() > now.getTime() ? 'planned' : 'not_held',
    record: null,
  });
}

function entryOf(
  entries: ReadonlyMap<number, YearCalendarEntry>,
  year: number,
): YearCalendarEntry {
  const entry = entries.get(year);
  if (entry === undefined) {
    throw new RangeError(`照会していない年です: ${String(year)}`);
  }
  return entry;
}

function calendarYearOf({
  year,
  schedule,
  source,
  state,
}: YearCalendarYear): YearCalendarYear {
  return Object.freeze({ year, schedule, source, state });
}

export class YearTournamentCalendar implements YearCalendar {
  constructor(private readonly store: YearTournamentStore) {}

  async describe(
    years: readonly number[],
    now: Date,
  ): Promise<ReadonlyMap<number, YearCalendarEntry>> {
    const uniqueYears = [...new Set(years)];
    const records = await this.store.findByYears(uniqueYears);
    return new Map(
      uniqueYears.map((year) => {
        const record = records.get(year);
        return [
          year,
          record === undefined
            ? defaultEntryOf(year, now)
            : storedEntryOf(record),
        ];
      }),
    );
  }

  async resolveAward(
    awardedDate: BusinessDate,
    now: Date,
  ): Promise<TargetYearResolution> {
    const entries = await this.describe(
      yearsFrom(yearOf(awardedDate), AWARD_LOOKUP_YEARS),
      now,
    );
    const resolution = resolveTargetYear(awardedDate, (year) =>
      entryOf(entries, year),
    );
    return resolution.kind === 'open'
      ? Object.freeze({ kind: 'open', year: calendarYearOf(resolution.year) })
      : resolution;
  }

  async upcoming(now: Date): Promise<YearCalendarYear> {
    return calendarYearOf(await this.upcomingEntry(now));
  }

  // 組み合わせ決定の時刻を過ぎた年に行を作るとその年の組み合わせ決定が回復として動くため、開催予定の年にだけ作る
  async ensureUpcoming(now: Date): Promise<YearTournamentRecord> {
    const entry = await this.upcomingEntry(now);
    return (
      entry.record ??
      this.store.ensureYear(entry.year, defaultScheduleOf(entry.year), now)
    );
  }

  async openPeriodStart(): Promise<Date | null> {
    const deadlineDate = await this.store.latestFrozenDeadlineDate();
    return deadlineDate === null
      ? null
      : fromBusinessDateTime(deadlineDate, START_OF_DAY);
  }

  private async upcomingEntry(now: Date): Promise<YearCalendarEntry> {
    const years = yearsFrom(
      yearOf(toBusinessDateTime(now).date),
      UPCOMING_LOOKUP_YEARS,
    );
    const entries = await this.describe(years, now);
    const upcoming = years
      .map((year) => entryOf(entries, year))
      .find(({ state }) => state === 'planned' || state === 'open');
    if (upcoming === undefined) {
      throw new RangeError(
        `${String(years[0])}年から${String(UPCOMING_LOOKUP_YEARS)}年の間に開催予定の年がありません`,
      );
    }
    return upcoming;
  }
}
