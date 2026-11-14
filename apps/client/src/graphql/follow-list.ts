import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import {
  ClientMyFollowersDocument,
  ClientMyFollowingDocument,
  type ClientMyFollowingQuery,
  type ClientMyFollowingQueryVariables,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export const FOLLOW_LIST_PAGE_SIZE = 20;

export type FollowListDirection = 'following' | 'followers';

export interface FollowListEntry {
  readonly handle: string;
  readonly nickname: string;
  // nullは未設定
  readonly avatar: MediaImageView | null;
  readonly followedAt: string;
}

// フォロー中とフォロワーは同じ形の接続のため、取得の結果を1つの形にそろえてキャッシュする
export type FollowListPageData = ClientMyFollowingQuery['myFollowing'];

export type FollowListData = InfiniteData<FollowListPageData, string | null>;

const FIRST_PAGE_VARIABLES: ClientMyFollowingQueryVariables = Object.freeze({
  first: FOLLOW_LIST_PAGE_SIZE,
});

const queryKeyPrefixOf = (direction: FollowListDirection) =>
  direction === 'following'
    ? graphqlQueryKey(ClientMyFollowingDocument, FIRST_PAGE_VARIABLES)
    : graphqlQueryKey(ClientMyFollowersDocument, FIRST_PAGE_VARIABLES);

const fetchPage = async (
  direction: FollowListDirection,
  variables: ClientMyFollowingQueryVariables,
  signal: AbortSignal,
): Promise<FollowListPageData> => {
  if (direction === 'following') {
    return requireData(
      await executeGraphQL(ClientMyFollowingDocument, variables, { signal }),
    ).myFollowing;
  }
  return requireData(
    await executeGraphQL(ClientMyFollowersDocument, variables, { signal }),
  ).myFollowers;
};

// 一覧は本人のものであるため、同じタブで別の利用者がログインした後に前の利用者の一覧を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える。続きのページは最後の項目のカーソルから読む
export const followListQueryOptions = (
  viewerId: string,
  direction: FollowListDirection,
) =>
  infiniteQueryOptions({
    queryKey: [...queryKeyPrefixOf(direction), viewerId],
    queryFn: ({ pageParam, signal }) =>
      fetchPage(
        direction,
        pageParam === null
          ? FIRST_PAGE_VARIABLES
          : { ...FIRST_PAGE_VARIABLES, after: pageParam },
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({ pageInfo }: FollowListPageData): string | undefined =>
      pageInfo.hasNextPage && pageInfo.endCursor !== null
        ? pageInfo.endCursor
        : undefined,
  });

export const toFollowListEntries = ({
  pages,
}: FollowListData): readonly FollowListEntry[] =>
  pages.flatMap(({ nodes }) =>
    nodes.map(({ user: { handle, nickname, avatar }, followedAt }) => ({
      handle,
      nickname,
      avatar,
      followedAt,
    })),
  );

// 他の画面のフォロー・解除の操作を反映するため、開くたびに取得し直す。取得の失敗は設定のナビゲーションを残したまま一覧の中で再試行できるよう、例外にせずキャッシュに残す。続きのページはここで読み足さず、画面の「さらに読み込む」で読む
export async function loadFollowList({
  context,
  direction,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
  readonly direction: FollowListDirection;
}): Promise<void> {
  await context.queryClient
    .infiniteQuery({
      ...followListQueryOptions(context.viewer.id, direction),
      staleTime: 0,
    })
    .catch(() => undefined);
}
