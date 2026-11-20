import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { MinorUnitAmount } from '../../../../common-lib/payments/money.ts';
import type { AdminUserDirectory } from '../../../../lib/core/identity/ports.ts';
import type {
  DailyMatchSummary,
  MatchDirectory,
} from '../../../../lib/core/match/ports.ts';
import type {
  PaymentRevenueReport,
  RevenuePeriod,
} from '../../../../lib/core/payments/ports.ts';
import type { AdminProductDirectory } from '../../../../lib/core/product/ports.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  addBusinessDays,
  type BusinessDate,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../../../lib/core/time/business-time.ts';
import { MODERATION_TYPES } from '../moderation-types.ts';
import type {
  ModerationIncident,
  ModerationIncidentContext,
  ModerationIncidentReporter,
  WeeklyStatisticsRow,
  WeeklyStatisticsStore,
} from '../ports.ts';
import {
  WEEKLY_STATISTICS_JOB_DEFINITION,
  WeeklyStatisticsJob,
} from './weekly-statistics-job.ts';

const JOB_NAME = 'ugc-moderation.weekly-statistics';

// 業務日付2026-11-20(金曜日)の業務時刻4:21。今週は11/16(月)〜、前週は11/9(月)〜
const FRIDAY = new Date('2026-11-20T12:21:00.000Z');
const CURRENT_WEEK_FROM = new Date('2026-11-16T08:00:00.000Z');
const PREVIOUS_WEEK_FROM = new Date('2026-11-09T08:00:00.000Z');

// 業務日付2026-11-23(月曜日)の業務時刻4:21。今週は11/23(月)〜、前週は11/16(月)〜
const MONDAY = new Date('2026-11-23T12:21:00.000Z');
const NEXT_WEEK_FROM = new Date('2026-11-23T08:00:00.000Z');

function contextAt(scheduledTime: Date): ScheduledJobContext {
  return {
    scheduledTime,
    cron: '21 12 * * *',
    business: toBusinessDateTime(scheduledTime),
  };
}

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

// 日付ごとに予選実施数は日の番号、Upvote数は日の番号の10倍にする
function dailySummariesOf(
  from: BusinessDate,
  to: BusinessDate,
): DailyMatchSummary[] {
  const days: DailyMatchSummary[] = [];
  for (let day = from; day <= to; day = addBusinessDays(day, 1)) {
    const dayOfMonth = Number(day.slice(-2));
    days.push({
      date: day,
      qualifierMatches: dayOfMonth,
      upvotes: dayOfMonth * 10,
    });
  }
  return days;
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

interface FakeOptions {
  readonly previousFinalized?: boolean;
  readonly revenue?: (
    periods: readonly RevenuePeriod[],
  ) => Promise<readonly MinorUnitAmount[]>;
  readonly usersAt?: (at: Date) => Promise<number>;
  readonly productsAt?: (at: Date) => Promise<number>;
  readonly summarize?: (input: {
    readonly from: BusinessDate;
    readonly to: BusinessDate;
  }) => Promise<readonly DailyMatchSummary[]>;
  readonly findFinalizedError?: Error;
  readonly upsertError?: Error;
}

function createJob(options: FakeOptions = {}) {
  const findFinalizedCalls: BusinessDate[] = [];
  const upserts: (readonly WeeklyStatisticsRow[])[] = [];
  const revenueCalls: (readonly RevenuePeriod[])[] = [];
  const userCalls: Date[] = [];
  const productCalls: Date[] = [];
  const summarizeCalls: {
    readonly from: BusinessDate;
    readonly to: BusinessDate;
  }[] = [];
  const reports: {
    readonly incident: ModerationIncident;
    readonly context: ModerationIncidentContext;
  }[] = [];
  const store: Pick<WeeklyStatisticsStore, 'findFinalized' | 'upsert'> = {
    findFinalized: (weekStart) => {
      findFinalizedCalls.push(weekStart);
      if (options.findFinalizedError !== undefined) {
        return Promise.reject(options.findFinalizedError);
      }
      return Promise.resolve(options.previousFinalized ?? false);
    },
    upsert: (rows) => {
      upserts.push(rows);
      if (options.upsertError !== undefined) {
        return Promise.reject(options.upsertError);
      }
      return Promise.resolve();
    },
  };
  const users: Pick<AdminUserDirectory, 'countRegisteredAt'> = {
    countRegisteredAt: (at) => {
      userCalls.push(at);
      return (
        options.usersAt?.(at) ??
        Promise.resolve(sameInstant(at, FRIDAY) ? 120 : 100)
      );
    },
  };
  const products: Pick<AdminProductDirectory, 'countRegisteredAt'> = {
    countRegisteredAt: (at) => {
      productCalls.push(at);
      return (
        options.productsAt?.(at) ??
        Promise.resolve(sameInstant(at, FRIDAY) ? 45 : 40)
      );
    },
  };
  const matches: Pick<MatchDirectory, 'summarizeDaily'> = {
    summarizeDaily: (input) => {
      summarizeCalls.push(input);
      return (
        options.summarize?.(input) ??
        Promise.resolve(dailySummariesOf(input.from, input.to))
      );
    },
  };
  const revenue: PaymentRevenueReport = {
    netRevenue: (periods) => {
      revenueCalls.push(periods);
      return (
        options.revenue?.(periods) ??
        Promise.resolve(periods.map((_, index) => (index + 1) * 1000))
      );
    },
  };
  const reporter: ModerationIncidentReporter = {
    report: (incident, context) => {
      reports.push({ incident, context });
    },
  };
  const job = new WeeklyStatisticsJob(
    store as WeeklyStatisticsStore,
    users as AdminUserDirectory,
    products as AdminProductDirectory,
    matches as MatchDirectory,
    revenue,
    reporter,
  );
  return {
    job,
    findFinalizedCalls,
    upserts,
    revenueCalls,
    userCalls,
    productCalls,
    summarizeCalls,
    reports,
  };
}

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function moderationLogs() {
  return records
    .filter(
      (record) => record.category.join('.') === 'api.application.moderation',
    )
    .map(({ level, message, properties }) => ({
      level,
      message: message.join(''),
      properties,
    }));
}

describe('週ごとの統計の集計のジョブの定義', () => {
  test('4:21の起動でorder 1900に、集計のジョブの識別子を実行する', () => {
    expect(WEEKLY_STATISTICS_JOB_DEFINITION).toEqual({
      name: JOB_NAME,
      at: { hour: 4, minute: 21 },
      order: 1900,
      handler: MODERATION_TYPES.WeeklyStatisticsJob,
    });
    expect(Object.isFrozen(WEEKLY_STATISTICS_JOB_DEFINITION)).toBe(true);
    expect(Object.isFrozen(WEEKLY_STATISTICS_JOB_DEFINITION.at)).toBe(true);
  });
});

describe('WeeklyStatisticsJob', () => {
  test('前週が未確定なら、前週を週の終わりの時点で集計して確定し、今週を実行時刻の時点で集計する', async () => {
    const fake = createJob({ previousFinalized: false });

    await fake.job.run(contextAt(FRIDAY));

    expect(fake.findFinalizedCalls).toEqual([date('2026-11-09')]);
    expect(fake.revenueCalls).toEqual([
      [
        { from: PREVIOUS_WEEK_FROM, to: CURRENT_WEEK_FROM },
        { from: CURRENT_WEEK_FROM, to: FRIDAY },
      ],
    ]);
    expect(fake.userCalls).toEqual([CURRENT_WEEK_FROM, FRIDAY]);
    expect(fake.productCalls).toEqual([CURRENT_WEEK_FROM, FRIDAY]);
    expect(fake.summarizeCalls).toEqual([
      { from: date('2026-11-09'), to: date('2026-11-20') },
    ]);
    expect(fake.upserts).toEqual([
      [
        {
          weekStart: date('2026-11-09'),
          netRevenue: 1000,
          usersTotal: 100,
          productsTotal: 40,
          qualifierMatches: sumOf([9, 10, 11, 12, 13, 14, 15]),
          upvotes: sumOf([90, 100, 110, 120, 130, 140, 150]),
          finalized: true,
          computedAt: FRIDAY,
        },
        {
          weekStart: date('2026-11-16'),
          netRevenue: 2000,
          usersTotal: 120,
          productsTotal: 45,
          qualifierMatches: sumOf([16, 17, 18, 19, 20]),
          upvotes: sumOf([160, 170, 180, 190, 200]),
          finalized: false,
          computedAt: FRIDAY,
        },
      ],
    ]);
    expect(fake.reports).toEqual([]);
  });

  test('前週が確定済みなら、今週だけを実行時刻の時点で集計する', async () => {
    const fake = createJob({ previousFinalized: true });

    await fake.job.run(contextAt(FRIDAY));

    expect(fake.revenueCalls).toEqual([
      [{ from: CURRENT_WEEK_FROM, to: FRIDAY }],
    ]);
    expect(fake.userCalls).toEqual([FRIDAY]);
    expect(fake.productCalls).toEqual([FRIDAY]);
    expect(fake.summarizeCalls).toEqual([
      { from: date('2026-11-16'), to: date('2026-11-20') },
    ]);
    expect(fake.upserts).toEqual([
      [
        {
          weekStart: date('2026-11-16'),
          netRevenue: 1000,
          usersTotal: 120,
          productsTotal: 45,
          qualifierMatches: sumOf([16, 17, 18, 19, 20]),
          upvotes: sumOf([160, 170, 180, 190, 200]),
          finalized: false,
          computedAt: FRIDAY,
        },
      ],
    ]);
  });

  test('月曜日の実行では、終わった前週の日曜日までを前週に、実行日を今週に数える', async () => {
    const fake = createJob({
      previousFinalized: false,
      usersAt: (at) => Promise.resolve(sameInstant(at, MONDAY) ? 130 : 125),
      productsAt: (at) => Promise.resolve(sameInstant(at, MONDAY) ? 50 : 48),
      revenue: () => Promise.resolve([-500, 0]),
    });

    await fake.job.run(contextAt(MONDAY));

    expect(fake.findFinalizedCalls).toEqual([date('2026-11-16')]);
    expect(fake.revenueCalls).toEqual([
      [
        { from: CURRENT_WEEK_FROM, to: NEXT_WEEK_FROM },
        { from: NEXT_WEEK_FROM, to: MONDAY },
      ],
    ]);
    expect(fake.userCalls).toEqual([NEXT_WEEK_FROM, MONDAY]);
    expect(fake.summarizeCalls).toEqual([
      { from: date('2026-11-16'), to: date('2026-11-23') },
    ]);
    expect(fake.upserts).toEqual([
      [
        {
          weekStart: date('2026-11-16'),
          netRevenue: -500,
          usersTotal: 125,
          productsTotal: 48,
          qualifierMatches: sumOf([16, 17, 18, 19, 20, 21, 22]),
          upvotes: sumOf([160, 170, 180, 190, 200, 210, 220]),
          finalized: true,
          computedAt: MONDAY,
        },
        {
          weekStart: date('2026-11-23'),
          netRevenue: 0,
          usersTotal: 130,
          productsTotal: 50,
          qualifierMatches: 23,
          upvotes: 230,
          finalized: false,
          computedAt: MONDAY,
        },
      ],
    ]);
  });

  test('年をまたぐ週は、月曜日に始まる週の範囲で集計する', async () => {
    // 業務日付2027-01-01(金曜日)。今週は2026-12-28(月)〜、前週は2026-12-21(月)〜
    const newYear = new Date('2027-01-01T12:21:00.000Z');
    const fake = createJob({ previousFinalized: false });

    await fake.job.run(contextAt(newYear));

    expect(fake.findFinalizedCalls).toEqual([date('2026-12-21')]);
    expect(fake.summarizeCalls).toEqual([
      { from: date('2026-12-21'), to: date('2027-01-01') },
    ]);
    expect(fake.upserts[0]?.map((row) => row.weekStart)).toEqual([
      date('2026-12-21'),
      date('2026-12-28'),
    ]);
    expect(fake.upserts[0]?.[1]?.qualifierMatches).toBe(
      sumOf([28, 29, 30, 31, 1]),
    );
  });

  test('集計を終えたら、集計した週と確定した週の件数だけをログに残す', async () => {
    const fake = createJob({ previousFinalized: false });

    await fake.job.run(contextAt(FRIDAY));

    expect(moderationLogs()).toEqual([
      {
        level: 'info',
        message: '週ごとの統計を集計しました',
        properties: { computed: 2, finalized: 1 },
      },
    ]);
  });

  const failure = new Error('照会に失敗しました');
  test.each<[string, FakeOptions]>([
    ['収益', { revenue: () => Promise.reject(failure) }],
    ['利用者数', { usersAt: () => Promise.reject(failure) }],
    ['プロダクト数', { productsAt: () => Promise.reject(failure) }],
    ['予選実施数とUpvote数', { summarize: () => Promise.reject(failure) }],
  ])(
    '%sの照会に失敗したら、どの週も保存せず、定型の通知のポートへstatistics-failedを送ってジョブは成功で終える',
    async (_, options) => {
      const fake = createJob({ previousFinalized: false, ...options });

      await fake.job.run(contextAt(FRIDAY));

      expect(fake.upserts).toEqual([]);
      expect(fake.reports).toEqual([
        { incident: 'statistics-failed', context: { job: JOB_NAME } },
      ]);
      expect(moderationLogs()).toEqual([
        {
          level: 'warning',
          message: '週ごとの統計を集計できませんでした',
          properties: { error: failure },
        },
      ]);
    },
  );

  test('照会に失敗した次の実行で、未確定のままの前週を週の終わりの時点で集計し直して確定する', async () => {
    let attempts = 0;
    const fake = createJob({
      previousFinalized: false,
      revenue: (periods) => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(failure)
          : Promise.resolve(periods.map(() => 700));
      },
    });

    await fake.job.run(contextAt(FRIDAY));
    const nextDay = new Date('2026-11-21T12:21:00.000Z');
    await fake.job.run(contextAt(nextDay));

    expect(fake.reports).toHaveLength(1);
    expect(fake.findFinalizedCalls).toEqual([
      date('2026-11-09'),
      date('2026-11-09'),
    ]);
    expect(fake.revenueCalls[1]).toEqual([
      { from: PREVIOUS_WEEK_FROM, to: CURRENT_WEEK_FROM },
      { from: CURRENT_WEEK_FROM, to: nextDay },
    ]);
    expect(fake.upserts).toEqual([
      [
        expect.objectContaining({
          weekStart: date('2026-11-09'),
          netRevenue: 700,
          finalized: true,
          computedAt: nextDay,
        }),
        expect.objectContaining({
          weekStart: date('2026-11-16'),
          netRevenue: 700,
          finalized: false,
          computedAt: nextDay,
        }),
      ],
    ]);
  });

  test('確定の有無を引けないときは、何も照会せずに例外を投げる', async () => {
    const storeFailure = new Error('D1の読み取りに失敗しました');
    const fake = createJob({ findFinalizedError: storeFailure });

    const error: unknown = await fake.job
      .run(contextAt(FRIDAY))
      .catch((caught: unknown) => caught);

    expect(error).toBe(storeFailure);
    expect(fake.revenueCalls).toEqual([]);
    expect(fake.upserts).toEqual([]);
    expect(fake.reports).toEqual([]);
  });

  test('週の行を保存できないときは、定型の通知を送らずに例外を投げる', async () => {
    const storeFailure = new Error('D1の書き込みに失敗しました');
    const fake = createJob({ upsertError: storeFailure });

    const error: unknown = await fake.job
      .run(contextAt(FRIDAY))
      .catch((caught: unknown) => caught);

    expect(error).toBe(storeFailure);
    expect(fake.upserts).toHaveLength(1);
    expect(fake.reports).toEqual([]);
  });
});
