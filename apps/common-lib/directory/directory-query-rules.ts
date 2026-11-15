import { checkHandleFormat } from '../handles/handle-rules.ts';
import { PRODUCT_CATEGORY_HANDLE_RULE } from '../product/product-input-rules.ts';
import { truncateGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';
import {
  type BusinessDateString,
  isBusinessDateString,
} from './directory-period.ts';

export const DIRECTORY_PAGE_SIZE = 20;

export const DIRECTORY_SEARCH_MAX_GRAPHEMES = 50;

export const DIRECTORY_SEARCH_COUNTER_FROM = 40;

export const DIRECTORY_SORTS = Object.freeze([
  'relevance',
  'newest',
  'oldest',
  'upvotes',
] as const);

export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

export interface DirectoryQuery {
  readonly q?: string | undefined;
  readonly category?: string | undefined;
  readonly from?: BusinessDateString | undefined;
  readonly to?: BusinessDateString | undefined;
  readonly sort?: DirectorySort | undefined;
  readonly page?: number | undefined;
}

const FIRST_OMITTED_PAGE = 2;

// URLのクエリは数の形の値を数として読み取るため、検索語とハンドルでは文字列に戻す
const textOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : undefined;
};

const normalizeSearchText = (value: unknown): string | undefined => {
  const text = textOf(value);
  if (text === undefined) {
    return undefined;
  }
  const truncated = trimWhiteSpace(
    truncateGraphemes(trimWhiteSpace(text), DIRECTORY_SEARCH_MAX_GRAPHEMES),
  );
  return truncated === '' ? undefined : truncated;
};

const normalizeCategory = (value: unknown): string | undefined => {
  const text = textOf(value);
  return text !== undefined &&
    checkHandleFormat(text, PRODUCT_CATEGORY_HANDLE_RULE) === 'ok'
    ? text
    : undefined;
};

const normalizeRange = (
  rawFrom: unknown,
  rawTo: unknown,
): Pick<DirectoryQuery, 'from' | 'to'> => {
  const from = isBusinessDateString(rawFrom) ? rawFrom : undefined;
  const to = isBusinessDateString(rawTo) ? rawTo : undefined;
  return from !== undefined && to !== undefined && from > to
    ? { from: undefined, to: undefined }
    : { from, to };
};

const isDirectorySort = (value: unknown): value is DirectorySort =>
  DIRECTORY_SORTS.some((sort) => sort === value);

const defaultSortOf = (q: string | undefined): DirectorySort =>
  q === undefined ? 'newest' : 'relevance';

const normalizeSort = (
  value: unknown,
  q: string | undefined,
): DirectorySort | undefined => {
  if (!isDirectorySort(value) || value === defaultSortOf(q)) {
    return undefined;
  }
  return value === 'relevance' && q === undefined ? undefined : value;
};

const DECIMAL_INTEGER_PATTERN = /^[1-9]\d*$/u;

// URLのクエリからは数、GraphQLの入力からは文字列で届く
const pageNumberOf = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return value;
  }
  return typeof value === 'string' && DECIMAL_INTEGER_PATTERN.test(value)
    ? Number(value)
    : undefined;
};

const normalizePage = (value: unknown): number | undefined => {
  const page = pageNumberOf(value);
  return page !== undefined &&
    Number.isSafeInteger(page) &&
    page >= FIRST_OMITTED_PAGE
    ? page
    : undefined;
};

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう既定の項目もundefinedとして返す
export const normalizeDirectoryQuery = (
  raw: Readonly<Record<string, unknown>>,
): DirectoryQuery => {
  const q = normalizeSearchText(raw.q);
  return {
    q,
    category: normalizeCategory(raw.category),
    ...normalizeRange(raw.from, raw.to),
    sort: normalizeSort(raw.sort, q),
    page: normalizePage(raw.page),
  };
};

export const effectiveSort = (query: DirectoryQuery): DirectorySort =>
  query.sort ?? defaultSortOf(query.q);

export const withConditions = (
  query: DirectoryQuery,
  patch: Partial<Omit<DirectoryQuery, 'page'>>,
): DirectoryQuery =>
  normalizeDirectoryQuery({ ...query, ...patch, page: undefined });

export const changedConditionCount = (query: DirectoryQuery): number =>
  [
    query.category !== undefined,
    query.from !== undefined || query.to !== undefined,
    query.sort !== undefined,
  ].filter(Boolean).length;
