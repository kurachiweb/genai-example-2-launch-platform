import { describe, expect, test } from 'bun:test';

import {
  EMPTY_PERIOD_RANGE_DRAFT,
  isApplicablePeriodRangeDraft,
  periodRangeDraftOf,
  periodRangeOfDraft,
} from './period-range-draft.ts';

const TODAY = '2026-09-17';

describe('periodRangeDraftOf', () => {
  test('期間の端の無い方を空の文字列にした入力欄の値にする', () => {
    expect(periodRangeDraftOf({ from: '2026-09-01' })).toStrictEqual({
      from: '2026-09-01',
      to: '',
    });
    expect(periodRangeDraftOf({ to: '2026-09-10' })).toStrictEqual({
      from: '',
      to: '2026-09-10',
    });
    expect(periodRangeDraftOf({})).toStrictEqual(EMPTY_PERIOD_RANGE_DRAFT);
  });
});

describe('periodRangeOfDraft', () => {
  test('空の欄をundefinedにし、条件を消せるよう両端の項目を必ず持たせる', () => {
    expect(periodRangeOfDraft({ from: '2026-09-01', to: '' })).toStrictEqual({
      from: '2026-09-01',
      to: undefined,
    });
    expect(periodRangeOfDraft({ from: '', to: '2026-09-10' })).toStrictEqual({
      from: undefined,
      to: '2026-09-10',
    });
    expect(
      periodRangeOfDraft({ from: '2026-09-01', to: '2026-09-10' }),
    ).toStrictEqual({ from: '2026-09-01', to: '2026-09-10' });
  });
});

describe('isApplicablePeriodRangeDraft', () => {
  test.each([
    [{ from: '2026-09-01', to: '' }],
    [{ from: '', to: '2026-09-10' }],
    [{ from: '2026-09-01', to: '2026-09-10' }],
    [{ from: TODAY, to: TODAY }],
  ])('片方だけ・両方の過去と今日の日付を適用できる(%o)', (draft) => {
    expect(isApplicablePeriodRangeDraft(draft, TODAY)).toBe(true);
  });

  test.each([
    ['どちらも空', EMPTY_PERIOD_RANGE_DRAFT],
    ['開始日が未来', { from: '2026-09-18', to: '' }],
    ['終了日が未来', { from: '', to: '2026-09-18' }],
    ['開始日が終了日より後', { from: '2026-09-10', to: '2026-09-01' }],
  ])('%sなら適用できない', (_label, draft) => {
    expect(isApplicablePeriodRangeDraft(draft, TODAY)).toBe(false);
  });
});
