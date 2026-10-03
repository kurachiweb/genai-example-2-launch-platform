import { categoryMaster } from './categories';
import { OPTIONS, normalizeState, parseState } from './options';
import type { DirectoryState, OptionKey } from './options';
import { normalizeQuery } from './query';
import type { DirectoryQuery } from './query';

// 状態切り替え用のキーと本番と同じURLクエリを1つのURLに同居させる
export type DirectorySearch = DirectoryState & DirectoryQuery;

export function validateDirectorySearch(
  raw: Record<string, unknown>,
): DirectorySearch {
  const { state } = normalizeState(parseState(raw));
  return { ...state, ...normalizeQuery(raw, categoryMaster(state)) };
}

export function stateOf(search: DirectorySearch): DirectoryState {
  return Object.fromEntries(
    (Object.keys(OPTIONS) as OptionKey[]).map((key) => [key, search[key]]),
  ) as DirectoryState;
}

export function queryOf(search: DirectorySearch): DirectoryQuery {
  const { q, category, from, to, sort, page } = search;
  return { q, category, from, to, sort, page };
}

export function sameQuery(a: DirectoryQuery, b: DirectoryQuery): boolean {
  return (
    a.q === b.q &&
    a.category === b.category &&
    a.from === b.from &&
    a.to === b.to &&
    a.sort === b.sort &&
    a.page === b.page
  );
}
