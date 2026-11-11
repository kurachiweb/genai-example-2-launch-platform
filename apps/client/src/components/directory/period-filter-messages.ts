import {
  formatPeriodLabel,
  type BusinessDateString,
  type PeriodPreset,
} from '../../../common-lib/directory/directory-period.ts';

export const PERIOD_FILTER_LABEL = '期間';

export const PERIOD_OPTION_LABELS: Readonly<
  Record<PeriodPreset | 'custom', string>
> = Object.freeze({
  yesterday: '昨日',
  week: '今週',
  month: '今月',
  year: '今年',
  all: '全期間',
  custom: '期間を指定…',
});

export const PERIOD_RANGE_TITLE = '期間を指定';

export const PERIOD_FROM_LABEL = '開始日';

export const PERIOD_TO_LABEL = '終了日';

export const PERIOD_RANGE_HINT =
  '片方だけ入力すると、その日以降・以前のローンチで絞り込みます。';

export const PERIOD_FUTURE_MESSAGE = '未来の日付は選べません。';

export const PERIOD_ORDER_MESSAGE =
  '開始日は終了日以前の日付を選んでください。';

export const PERIOD_CANCEL_LABEL = 'キャンセル';

export const PERIOD_APPLY_LABEL = '適用';

// 期間の端の日付の示し方を期間の表示と揃えるため、開始日と終了日が同じ期間の表示(日付1つ)を使う
export const periodDateLabel = (
  date: BusinessDateString,
  businessToday: BusinessDateString,
): string => formatPeriodLabel({ from: date, to: date }, businessToday);
