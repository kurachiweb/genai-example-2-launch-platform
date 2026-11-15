import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
} from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import {
  ClientLaunchHistoryDocument,
  type ClientLaunchHistoryQuery,
  type ClientLaunchHistoryQueryVariables,
  ClientProfileAwardsDocument,
  type ClientProfileAwardsQuery,
} from './generated/graphql.ts';
import {
  type ProductAwardView,
  type ProductLaunchView,
  toProductAwardView,
  toProductLaunchView,
} from './product-launch.ts';
import type { ClientViewer } from './viewer.ts';

export const LAUNCH_HISTORY_PAGE_SIZE = 20;

export interface LaunchHistoryProductView {
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: { readonly name: string; readonly handle: string };
  readonly websiteUrl: string;
  // nullは画像の記録が無い
  readonly logo: MediaImageView | null;
  // 掲載済み(可視かつ予選で勝利したローンチがある)
  readonly listed: boolean;
}

export interface LaunchHistoryItemView {
  readonly product: LaunchHistoryProductView;
  // 取消を除く、新しい順
  readonly launches: readonly ProductLaunchView[];
  // Yearが先頭
  readonly awards: readonly ProductAwardView[];
}

export interface LaunchHistoryView {
  readonly viewerIsOwner: boolean;
  // 閲覧者が停止中の本人
  readonly ownerSuspended: boolean;
  readonly totalCount: number;
  readonly items: readonly LaunchHistoryItemView[];
  // 本人の読み込んだ項目に未掲載のプロダクトがある
  readonly hasUnlistedOwnProduct: boolean;
}

export type LaunchHistoryData = InfiniteData<
  ClientLaunchHistoryQuery,
  string | null
>;

type GraphQLLaunchHistoryNode = NonNullable<
  ClientLaunchHistoryQuery['launchHistory']
>['nodes'][number];

const GUEST_SCOPE = 'guest';

const viewerScopeOf = (viewer: ClientViewer | null): string =>
  viewer === null ? GUEST_SCOPE : viewer.id;

const firstPageVariablesOf = (
  userHandle: string,
): ClientLaunchHistoryQueryVariables => ({
  userHandle,
  first: LAUNCH_HISTORY_PAGE_SIZE,
});

// 本人には未掲載の自分のプロダクトも含めて返すため、同じタブでログイン・ログアウトした後に前の閲覧者の一覧を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える。タブの件数とパネルは同じ設定で1つの取得にまとめる。続きのページは最後の項目のカーソルから読む
export const launchHistoryQueryOptions = (
  viewer: ClientViewer | null,
  userHandle: string,
) => {
  const firstPageVariables = firstPageVariablesOf(userHandle);
  return infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientLaunchHistoryDocument, firstPageVariables),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientLaunchHistoryDocument,
          pageParam === null
            ? firstPageVariables
            : { ...firstPageVariables, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      launchHistory,
    }: ClientLaunchHistoryQuery): string | undefined =>
      launchHistory?.pageInfo.hasNextPage === true &&
      launchHistory.pageInfo.endCursor !== null
        ? launchHistory.pageInfo.endCursor
        : undefined,
  });
};

// 受賞の対象はローンチ履歴と同じく閲覧者が本人かどうかで変わるため、閲覧者ごとに分ける
export const profileAwardsQueryOptions = (
  viewer: ClientViewer | null,
  userHandle: string,
) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientProfileAwardsDocument, { userHandle }),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(
          ClientProfileAwardsDocument,
          { userHandle },
          { signal },
        ),
      ),
  });

const toLaunchHistoryItemView = ({
  product: { handle, name, tagline, category, websiteUrl, logo, listed },
  launches,
  awards,
}: GraphQLLaunchHistoryNode): LaunchHistoryItemView => ({
  product: {
    handle,
    name,
    tagline,
    category,
    websiteUrl,
    logo,
    listed,
  },
  launches: launches.map(toProductLaunchView),
  awards: awards.map(toProductAwardView),
});

// 件数と閲覧者の関係は最初のページの値を使う。続きのページの取得の間に利用者を表示できなくなったページ(null)は項目に加えない
export const toLaunchHistoryView = ({
  pages,
}: LaunchHistoryData): LaunchHistoryView | null => {
  const first = pages[0]?.launchHistory;
  if (first === null || first === undefined) {
    return null;
  }
  const items = pages.flatMap(({ launchHistory }) =>
    launchHistory === null
      ? []
      : launchHistory.nodes.map(toLaunchHistoryItemView),
  );
  return {
    viewerIsOwner: first.viewerIsOwner,
    ownerSuspended: first.ownerSuspended,
    totalCount: first.totalCount,
    items,
    hasUnlistedOwnProduct:
      first.viewerIsOwner && items.some(({ product }) => !product.listed),
  };
};

// 表示できない利用者(null)と受賞が無い場合は、どちらも区画を出さない
export const toProfileAwardViews = ({
  profileAwards,
}: ClientProfileAwardsQuery): readonly ProductAwardView[] =>
  profileAwards === null ? [] : profileAwards.map(toProductAwardView);
