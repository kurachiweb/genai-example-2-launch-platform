import {
  MINOR_UNITS_PER_DOLLAR,
  PAYMENT_DISPLAY_CURRENCY,
} from '../../../../common-lib/payments/money.ts';
import type {
  StatisticsMetricKey,
  StatisticsMetricSeries,
  StatisticsSeriesPoint,
} from './statistics-series.ts';

// グラフの目盛りは細かい値を読ませないため、金額はドル単位で示す
const MONEY_AXIS_FORMAT: Intl.NumberFormatOptions = Object.freeze({
  style: 'currency',
  currency: PAYMENT_DISPLAY_CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const COUNT_AXIS_FORMAT: Intl.NumberFormatOptions = Object.freeze({
  maximumFractionDigits: 0,
});

export const chartAxisFormatOf = (
  metric: StatisticsMetricKey,
): Intl.NumberFormatOptions =>
  metric === 'netRevenue' ? MONEY_AXIS_FORMAT : COUNT_AXIS_FORMAT;

// 業務日付をそのまま区切って読み、閲覧者のタイムゾーンで日をずらさない
export const chartWeekTickOf = (weekStart: string): string => {
  const [, month = '', day = ''] = weekStart.split('-');
  return `${String(Number(month))}/${String(Number(day))}`;
};

export const chartPointsOf = ({
  key,
  points,
}: StatisticsMetricSeries): readonly StatisticsSeriesPoint[] =>
  points.map(({ weekStart, value }) => ({
    weekStart,
    value: key === 'netRevenue' ? value / MINOR_UNITS_PER_DOLLAR : value,
  }));
