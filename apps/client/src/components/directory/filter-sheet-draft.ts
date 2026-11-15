import {
  type BusinessDateString,
  type PeriodPreset,
  type PeriodRange,
  periodKeyOf,
  presetRange,
} from '../../../common-lib/directory/directory-period.ts';
import {
  type DirectoryQuery,
  type DirectorySort,
  effectiveSort,
} from '../../../common-lib/directory/directory-query-rules.ts';
import {
  EMPTY_PERIOD_RANGE_DRAFT,
  isApplicablePeriodRangeDraft,
  type PeriodRangeDraft,
  periodRangeDraftOf,
  periodRangeOfDraft,
} from './period-range-draft.ts';

// 絞り込み欄が呼び出し元へ知らせる条件の上書き。検索語とページは含めない
export type DirectoryFilterPatch = Partial<
  Pick<DirectoryQuery, 'category' | 'from' | 'to' | 'sort'>
>;

export interface FilterSheetDraft {
  readonly category: string | undefined;
  readonly period: PeriodPreset | 'custom';
  readonly custom: PeriodRangeDraft;
  readonly sort: DirectorySort;
}

export const filterSheetDraftOf = (
  query: DirectoryQuery,
  businessToday: BusinessDateString,
): FilterSheetDraft => {
  const range: PeriodRange = { from: query.from, to: query.to };
  const period = periodKeyOf(range, businessToday);
  return {
    category: query.category,
    period,
    custom:
      period === 'custom'
        ? periodRangeDraftOf(range)
        : EMPTY_PERIOD_RANGE_DRAFT,
    sort: effectiveSort(query),
  };
};

export const resetFilterSheetDraft = (
  query: DirectoryQuery,
): FilterSheetDraft => ({
  category: undefined,
  period: 'all',
  custom: EMPTY_PERIOD_RANGE_DRAFT,
  sort: effectiveSort({ q: query.q }),
});

export const isApplicableFilterSheetDraft = (
  draft: FilterSheetDraft,
  businessToday: BusinessDateString,
): boolean =>
  draft.period !== 'custom' ||
  isApplicablePeriodRangeDraft(draft.custom, businessToday);

// 条件の上書きで既定に戻した項目を消せるよう、4つの項目を必ず持たせる
export const filterPatchOfDraft = (
  draft: FilterSheetDraft,
  businessToday: BusinessDateString,
): DirectoryFilterPatch => {
  const range =
    draft.period === 'custom'
      ? periodRangeOfDraft(draft.custom)
      : presetRange(draft.period, businessToday);
  return {
    category: draft.category,
    from: range.from,
    to: range.to,
    sort: draft.sort,
  };
};
