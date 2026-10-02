import { countGraphemes, truncateGraphemes } from '#/lib/graphemes';

import {
  TODAY,
  YESTERDAY,
  isIsoDate,
  mondayOf,
  addDays,
  monthRangeOf,
  yearRangeOf,
} from './calendar';
import { findCategory } from './categories';
import type { Category } from './categories';

export const PAGE_SIZE = 20;
export const SEARCH_MAX_LENGTH = 50;
// これを超えたら文字数カウンターを表示する
export const SEARCH_COUNTER_FROM = 40;

export const SORT_KEYS = ['relevance', 'newest', 'oldest', 'upvotes'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: '関連度',
  newest: 'ローンチ日が新しい順',
  oldest: 'ローンチ日が古い順',
  upvotes: 'Upvote数が多い順',
};

export const PERIOD_PRESETS = [
  'yesterday',
  'week',
  'month',
  'year',
  'all',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type PeriodKey = PeriodPreset | 'custom';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  yesterday: '昨日',
  week: '今週',
  month: '今月',
  year: '今年',
  all: '全期間',
  custom: '期間を指定…',
};

// 本番と同じURLクエリ。既定値はURLから省略する(undefined)
export type DirectoryQuery = {
  q?: string;
  category?: string;
  from?: string;
  to?: string;
  sort?: SortKey;
  page?: number;
};

export type DateRange = { from?: string; to?: string };

// 週・月・年は暦の区切り全体へ展開し、同じ区切りの間はURLが変わらないようにする
export function presetRange(preset: PeriodPreset): DateRange {
  switch (preset) {
    case 'yesterday':
      return { from: YESTERDAY, to: YESTERDAY };
    case 'week': {
      const monday = mondayOf(TODAY);
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'month': {
      const [from, to] = monthRangeOf(TODAY);
      return { from, to };
    }
    case 'year': {
      const [from, to] = yearRangeOf(TODAY);
      return { from, to };
    }
    case 'all':
      return {};
  }
}

// 過去に共有された「今週」のリンクのようにプリセットと一致しない範囲は、指定期間として扱う
export function periodKeyOf(range: DateRange): PeriodKey {
  if (!range.from && !range.to) return 'all';
  const preset = PERIOD_PRESETS.find((key) => {
    const candidate = presetRange(key);
    return candidate.from === range.from && candidate.to === range.to;
  });
  return preset ?? 'custom';
}

export function defaultSortOf(q: string | undefined): SortKey {
  return q ? 'relevance' : 'newest';
}

export function effectiveSort(query: DirectoryQuery): SortKey {
  return query.sort ?? defaultSortOf(query.q);
}

export function hasConditions(query: DirectoryQuery): boolean {
  return Boolean(query.q || query.category || query.from || query.to);
}

// モバイルの「絞り込み」ボタンに添える、既定値から変更している項目の数
export function changedFilterCount(query: DirectoryQuery): number {
  return [query.category, query.from || query.to, query.sort].filter(Boolean)
    .length;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

// 不正な値は黙って既定値に戻す。ページ番号の範囲外は一覧側で空状態として扱う
export function normalizeQuery(
  raw: Record<string, unknown>,
  master: Category[],
): DirectoryQuery {
  const rawQ = asString(raw.q)?.trim();
  const q =
    rawQ && countGraphemes(rawQ) > SEARCH_MAX_LENGTH
      ? truncateGraphemes(rawQ, SEARCH_MAX_LENGTH)
      : rawQ || undefined;

  const category = findCategory(master, asString(raw.category))?.slug;

  const rawFrom = asString(raw.from);
  const rawTo = asString(raw.to);
  let from = rawFrom && isIsoDate(rawFrom) ? rawFrom : undefined;
  let to = rawTo && isIsoDate(rawTo) ? rawTo : undefined;
  if (from && to && from > to) {
    from = undefined;
    to = undefined;
  }

  const rawSort = asString(raw.sort);
  const sortCandidate = SORT_KEYS.find((key) => key === rawSort);
  const sort =
    !sortCandidate ||
    (sortCandidate === 'relevance' && !q) ||
    sortCandidate === defaultSortOf(q)
      ? undefined
      : sortCandidate;

  const rawPage = Number(asString(raw.page));
  const page = Number.isInteger(rawPage) && rawPage > 1 ? rawPage : undefined;

  return { q, category, from, to, sort, page };
}

// 検索・絞り込み・並び順の変更時は1ページ目に戻す
export function withConditions(
  query: DirectoryQuery,
  patch: Partial<Omit<DirectoryQuery, 'page'>>,
): DirectoryQuery {
  const next = { ...query, ...patch, page: undefined };
  const sort =
    next.sort === defaultSortOf(next.q) ||
    (next.sort === 'relevance' && !next.q)
      ? undefined
      : next.sort;
  return { ...next, sort };
}
