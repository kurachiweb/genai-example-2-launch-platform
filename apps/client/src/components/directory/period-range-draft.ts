import {
  type BusinessDateString,
  type PeriodRange,
  validateCustomRange,
} from '../../../common-lib/directory/directory-period.ts';

// 日付の入力欄の値。未入力は空の文字列
export interface PeriodRangeDraft {
  readonly from: string;
  readonly to: string;
}

export const EMPTY_PERIOD_RANGE_DRAFT: PeriodRangeDraft = Object.freeze({
  from: '',
  to: '',
});

export const periodRangeDraftOf = (range: PeriodRange): PeriodRangeDraft => ({
  from: range.from ?? '',
  to: range.to ?? '',
});

// 条件の上書きで指定の無い端を消せるよう、両端の項目を必ず持たせる
export const periodRangeOfDraft = (draft: PeriodRangeDraft): PeriodRange => ({
  from: draft.from === '' ? undefined : draft.from,
  to: draft.to === '' ? undefined : draft.to,
});

export const isApplicablePeriodRangeDraft = (
  draft: PeriodRangeDraft,
  businessToday: BusinessDateString,
): boolean =>
  (draft.from !== '' || draft.to !== '') &&
  Object.keys(validateCustomRange({ ...draft, today: businessToday }))
    .length === 0;
