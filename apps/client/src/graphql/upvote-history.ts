import { type InfiniteData, infiniteQueryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientUpvoteHistoryDocument,
  type ClientUpvoteHistoryQuery,
  type ClientUpvoteHistoryQueryVariables,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export const UPVOTE_HISTORY_PAGE_SIZE = 20;

type UpvoteHistoryConnection = NonNullable<
  ClientUpvoteHistoryQuery['upvoteHistory']
>;

// idはマッチID
export type UpvoteHistoryItemView = UpvoteHistoryConnection['nodes'][number];

export interface UpvoteHistoryDayView {
  // マッチ実施日の業務日付(YYYY-MM-DD)
  readonly date: string;
  // 読み込んだ項目の数ではなく、その日のUpvoteの総数
  readonly count: number;
  readonly items: readonly UpvoteHistoryItemView[];
}

export interface UpvoteHistoryView {
  readonly totalCount: number;
  // 読み込んだ項目の数
  readonly itemCount: number;
  // 新しい順
  readonly days: readonly UpvoteHistoryDayView[];
}

export type UpvoteHistoryData = InfiniteData<
  ClientUpvoteHistoryQuery,
  string | null
>;

const GUEST_SCOPE = 'guest';

const viewerScopeOf = (viewer: ClientViewer | null): string =>
  viewer === null ? GUEST_SCOPE : viewer.id;

const firstPageVariablesOf = (
  userHandle: string,
): ClientUpvoteHistoryQueryVariables => ({
  userHandle,
  first: UPVOTE_HISTORY_PAGE_SIZE,
});

// 停止中の利用者の履歴は本人にだけ返すため、同じタブでログイン・ログアウトした後に前の閲覧者の一覧を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える。タブの件数とパネルは同じ設定で1つの取得にまとめる
export const upvoteHistoryQueryOptions = (
  viewer: ClientViewer | null,
  userHandle: string,
) => {
  const firstPageVariables = firstPageVariablesOf(userHandle);
  return infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientUpvoteHistoryDocument, firstPageVariables),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientUpvoteHistoryDocument,
          pageParam === null
            ? firstPageVariables
            : { ...firstPageVariables, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      upvoteHistory,
    }: ClientUpvoteHistoryQuery): string | undefined =>
      upvoteHistory?.pageInfo.hasNextPage === true &&
      upvoteHistory.pageInfo.endCursor !== null
        ? upvoteHistory.pageInfo.endCursor
        : undefined,
  });
};

// 本人が読み込みの間にUpvoteを付け替えると続きのページに既出のマッチが含まれ得るため、マッチIDで重複を除き最初に読み込んだ項目を残す
const uniqueItemsOf = (
  connections: readonly UpvoteHistoryConnection[],
): readonly UpvoteHistoryItemView[] => {
  const seen = new Set<string>();
  return connections
    .flatMap(({ nodes }) => nodes)
    .filter(({ id }) => {
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
};

// その日の総数はページに依らず同じ値のため、最初に受け取った値を使う
const dayTotalsOf = (
  connections: readonly UpvoteHistoryConnection[],
): ReadonlyMap<string, number> =>
  new Map(
    connections
      .flatMap(({ dateTotals }) => dateTotals)
      .toReversed()
      .map(({ date, count }) => [date, count]),
  );

// 項目は実施日の新しい順に並ぶため、続く同じ日の項目を1つの日にまとめる
const daysOf = (
  items: readonly UpvoteHistoryItemView[],
  totals: ReadonlyMap<string, number>,
): readonly UpvoteHistoryDayView[] =>
  items
    .reduce<readonly (readonly UpvoteHistoryItemView[])[]>((groups, item) => {
      const last = groups.at(-1);
      return last?.[0]?.date === item.date
        ? [...groups.slice(0, -1), [...last, item]]
        : [...groups, [item]];
    }, [])
    .flatMap((group) => {
      const date = group[0]?.date;
      return date === undefined
        ? []
        : [{ date, count: totals.get(date) ?? group.length, items: group }];
    });

// 件数は最初のページの値を使う。続きのページの取得の間に利用者を表示できなくなったページ(null)は項目に加えない
export const toUpvoteHistoryView = ({
  pages,
}: UpvoteHistoryData): UpvoteHistoryView | null => {
  const first = pages[0]?.upvoteHistory;
  if (first === null || first === undefined) {
    return null;
  }
  const connections = pages.flatMap(({ upvoteHistory }) =>
    upvoteHistory === null ? [] : [upvoteHistory],
  );
  const items = uniqueItemsOf(connections);
  return {
    totalCount: first.totalCount,
    itemCount: items.length,
    days: daysOf(items, dayTotalsOf(connections)),
  };
};
