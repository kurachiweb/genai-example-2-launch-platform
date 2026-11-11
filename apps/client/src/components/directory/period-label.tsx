import {
  type BusinessDateString,
  type PeriodRange,
  periodKeyOf,
} from '../../../common-lib/directory/directory-period.ts';
import {
  PERIOD_OPTION_LABELS,
  periodDateLabel,
} from './period-filter-messages.ts';

export interface PeriodLabelProps {
  readonly range: PeriodRange;
  // APIサーバーが返した基準時刻の今日(YYYY-MM-DD)
  readonly businessToday: BusinessDateString;
}

// プリセットと一致する期間はプリセットの名前、一致しない期間は両端の業務日付を<time>要素で示す
export function PeriodLabel({ range, businessToday }: PeriodLabelProps) {
  const key = periodKeyOf(range, businessToday);
  if (key !== 'custom') {
    return PERIOD_OPTION_LABELS[key];
  }
  const timeOf = (date: BusinessDateString) => (
    <time dateTime={date}>{periodDateLabel(date, businessToday)}</time>
  );
  const { from, to } = range;
  if (from !== undefined && to !== undefined) {
    return from === to ? (
      timeOf(from)
    ) : (
      <>
        {timeOf(from)}〜{timeOf(to)}
      </>
    );
  }
  if (from !== undefined) {
    return <>{timeOf(from)}以降</>;
  }
  return to === undefined ? PERIOD_OPTION_LABELS.all : <>{timeOf(to)}以前</>;
}
