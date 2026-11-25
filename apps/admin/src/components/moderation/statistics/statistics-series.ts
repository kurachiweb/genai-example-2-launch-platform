import { addBusinessDays } from '../../../../common-lib/time/business-date-arithmetic.ts';
import type { AdminStatisticsWeekView } from '../../../graphql/admin-weekly-statistics.ts';

export const STATISTICS_METRIC_KEYS = Object.freeze([
  'netRevenue',
  'users',
  'products',
  'qualifierMatches',
  'upvotes',
] as const);

export type StatisticsMetricKey = (typeof STATISTICS_METRIC_KEYS)[number];

// 合計収益は最小通貨単位(セント)、他は件数
export type StatisticsMetricValues = Readonly<
  Record<StatisticsMetricKey, number>
>;

export interface StatisticsMetricSummary {
  readonly key: StatisticsMetricKey;
  readonly value: number;
  // nullは前週の行が無い
  readonly delta: number | null;
}

export interface StatisticsLatestWeek {
  readonly weekStart: string;
  readonly metrics: readonly StatisticsMetricSummary[];
}

export interface StatisticsTableRow {
  readonly weekStart: string;
  readonly inProgress: boolean;
  readonly values: StatisticsMetricValues;
}

export interface StatisticsSeriesPoint {
  readonly weekStart: string;
  readonly value: number;
}

export interface StatisticsMetricSeries {
  readonly key: StatisticsMetricKey;
  // 週の古い順
  readonly points: readonly StatisticsSeriesPoint[];
}

export interface StatisticsSeries {
  // nullは確定した週が無い
  readonly latestFinalized: StatisticsLatestWeek | null;
  // 週の新しい順
  readonly rows: readonly StatisticsTableRow[];
  readonly series: readonly StatisticsMetricSeries[];
}

const DAYS_PER_WEEK = 7;

const valuesOf = (week: AdminStatisticsWeekView): StatisticsMetricValues => ({
  netRevenue: week.netRevenue.amount,
  users: week.users,
  products: week.products,
  qualifierMatches: week.qualifierMatches,
  upvotes: week.upvotes,
});

// 集計が止まった週は行が欠けるため、前週は並びの1つ前ではなく7日前に始まる行で判定する
const latestFinalizedOf = (
  weeks: readonly AdminStatisticsWeekView[],
): StatisticsLatestWeek | null => {
  const latest = weeks.findLast(({ finalized }) => finalized);
  if (latest === undefined) {
    return null;
  }
  const previousStart = addBusinessDays(latest.weekStart, -DAYS_PER_WEEK);
  const previous = weeks.find(({ weekStart }) => weekStart === previousStart);
  const latestValues = valuesOf(latest);
  const previousValues = previous === undefined ? null : valuesOf(previous);
  return {
    weekStart: latest.weekStart,
    metrics: STATISTICS_METRIC_KEYS.map((key) => ({
      key,
      value: latestValues[key],
      delta:
        previousValues === null
          ? null
          : latestValues[key] - previousValues[key],
    })),
  };
};

export const statisticsSeriesOf = (
  weeks: readonly AdminStatisticsWeekView[],
): StatisticsSeries => {
  const ascending = weeks.toSorted((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  );
  return {
    latestFinalized: latestFinalizedOf(ascending),
    rows: ascending.toReversed().map((week) => ({
      weekStart: week.weekStart,
      inProgress: !week.finalized,
      values: valuesOf(week),
    })),
    series: STATISTICS_METRIC_KEYS.map((key) => ({
      key,
      points: ascending.map((week) => ({
        weekStart: week.weekStart,
        value: valuesOf(week)[key],
      })),
    })),
  };
};
