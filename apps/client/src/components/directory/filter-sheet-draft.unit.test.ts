import { describe, expect, test } from 'bun:test';

import {
  filterPatchOfDraft,
  filterSheetDraftOf,
  isApplicableFilterSheetDraft,
  resetFilterSheetDraft,
} from './filter-sheet-draft.ts';

// 2026-09-17は木曜日
const TODAY = '2026-09-17';

describe('filterSheetDraftOf', () => {
  test('既定の条件では、カテゴリ無し・全期間・検索語の有無による既定の並び順にする', () => {
    expect(filterSheetDraftOf({}, TODAY)).toStrictEqual({
      category: undefined,
      period: 'all',
      custom: { from: '', to: '' },
      sort: 'newest',
    });
    expect(filterSheetDraftOf({ q: 'ノート' }, TODAY).sort).toBe('relevance');
  });

  test('プリセットと一致する期間はプリセットにし、期間を指定の欄を空にする', () => {
    expect(
      filterSheetDraftOf(
        {
          category: 'design',
          from: '2026-09-14',
          to: '2026-09-20',
          sort: 'oldest',
        },
        TODAY,
      ),
    ).toStrictEqual({
      category: 'design',
      period: 'week',
      custom: { from: '', to: '' },
      sort: 'oldest',
    });
  });

  test('プリセットと一致しない期間は期間を指定にし、欄へ両端を入れる', () => {
    expect(filterSheetDraftOf({ from: '2026-09-01' }, TODAY)).toMatchObject({
      period: 'custom',
      custom: { from: '2026-09-01', to: '' },
    });
  });
});

describe('resetFilterSheetDraft', () => {
  test('カテゴリ・期間・並び順を既定に戻し、並び順の既定は検索語の有無で決める', () => {
    expect(
      resetFilterSheetDraft({ category: 'ai', sort: 'oldest' }),
    ).toStrictEqual({
      category: undefined,
      period: 'all',
      custom: { from: '', to: '' },
      sort: 'newest',
    });
    expect(resetFilterSheetDraft({ q: 'ノート', sort: 'upvotes' }).sort).toBe(
      'relevance',
    );
  });
});

describe('isApplicableFilterSheetDraft', () => {
  const base = filterSheetDraftOf({}, TODAY);

  test('プリセットの期間ならいつでも適用できる', () => {
    expect(isApplicableFilterSheetDraft(base, TODAY)).toBe(true);
  });

  test('期間を指定では、片方以上が入力され未来・逆順でないときだけ適用できる', () => {
    const customOf = (from: string, to: string) => ({
      ...base,
      period: 'custom' as const,
      custom: { from, to },
    });

    expect(isApplicableFilterSheetDraft(customOf('', ''), TODAY)).toBe(false);
    expect(
      isApplicableFilterSheetDraft(customOf('2026-09-01', ''), TODAY),
    ).toBe(true);
    expect(
      isApplicableFilterSheetDraft(customOf('', '2026-09-18'), TODAY),
    ).toBe(false);
    expect(
      isApplicableFilterSheetDraft(customOf('2026-09-10', '2026-09-01'), TODAY),
    ).toBe(false);
  });
});

describe('filterPatchOfDraft', () => {
  test('プリセットは基準時刻の今日からの範囲へ展開し、4つの項目を必ず持たせる', () => {
    expect(
      filterPatchOfDraft(
        { ...filterSheetDraftOf({}, TODAY), period: 'month', sort: 'upvotes' },
        TODAY,
      ),
    ).toStrictEqual({
      category: undefined,
      from: '2026-09-01',
      to: '2026-09-30',
      sort: 'upvotes',
    });
  });

  test('全期間と期間を指定の空の端は、条件を消せるようundefinedにする', () => {
    expect(
      filterPatchOfDraft(filterSheetDraftOf({ category: 'ai' }, TODAY), TODAY),
    ).toStrictEqual({
      category: 'ai',
      from: undefined,
      to: undefined,
      sort: 'newest',
    });
    expect(
      filterPatchOfDraft(
        {
          ...filterSheetDraftOf({}, TODAY),
          period: 'custom',
          custom: { from: '', to: '2026-09-10' },
        },
        TODAY,
      ),
    ).toStrictEqual({
      category: undefined,
      from: undefined,
      to: '2026-09-10',
      sort: 'newest',
    });
  });
});
