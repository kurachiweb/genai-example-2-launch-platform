import type { StatisticsMetricKey } from './statistics-series.ts';

export const WEEKLY_STATISTICS_TITLE = '週ごとの統計';

export const WEEKLY_STATISTICS_DESCRIPTION =
  '直近26週と集計中の今週の運営状況の推移です。週は月曜日に始まり、値は毎日集計します。終わった週の値は変わりません。';

export const STATISTICS_METRIC_LABELS: Readonly<
  Record<StatisticsMetricKey, string>
> = Object.freeze({
  netRevenue: '合計収益(税込)',
  users: 'ユーザー数',
  products: 'プロダクト数',
  qualifierMatches: '予選実施数',
  upvotes: 'Upvote数',
});

// 直近の値の見出し「<週の開始日>からの週」の、週の開始日に続く部分
export const STATISTICS_LATEST_WEEK_SUFFIX = 'からの週';

export const STATISTICS_DELTA_PREFIX = '前週比';

export const STATISTICS_ZERO_DELTA_SIGN = '±';

export const NO_PREVIOUS_WEEK_TEXT = '前週の値なし';

export const NO_FINALIZED_WEEK_MESSAGE = '終わった週の統計はまだありません。';

export const NO_STATISTICS_MESSAGE = '統計はまだ集計されていません。';

export const STATISTICS_TABLE_CAPTION = '週ごとの統計(直近26週と今週)';

export const STATISTICS_WEEK_START_COLUMN = '週の開始日';

export const STATISTICS_IN_PROGRESS_LABEL = '集計中';
