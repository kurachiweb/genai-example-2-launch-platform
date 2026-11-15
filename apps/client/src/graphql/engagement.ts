import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
} from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientLaunchCommentCountsDocument,
  ClientLaunchCommentsDocument,
  type ClientLaunchCommentsQuery,
  ClientProductRatingDocument,
  type ClientProductRatingQuery,
  type ProductRatingFragment,
} from './generated/graphql.ts';

const GUEST_SCOPE = 'guest';

// コメントの閲覧者自身の印と、投稿者本人にだけ見えるプロダクトの可否を含む応答のため、同じタブでログイン・ログアウトした後に前の閲覧者の値を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const launchCommentsQueryOptions = (
  viewerId: string | null,
  productId: string,
  launchId: string,
) => {
  const firstPageVariables = { productId, launchId };
  return infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientLaunchCommentsDocument, firstPageVariables),
      viewerId ?? GUEST_SCOPE,
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientLaunchCommentsDocument,
          pageParam === null
            ? firstPageVariables
            : { ...firstPageVariables, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      launchComments,
    }: ClientLaunchCommentsQuery): string | undefined =>
      launchComments?.pageInfo.hasNextPage === true &&
      launchComments.pageInfo.endCursor !== null
        ? launchComments.pageInfo.endCursor
        : undefined,
  });
};

// 閲覧者ごとのキーの共通の前方の部分。コメントの操作の後に、同じプロダクトの件数を閲覧者を問わずまとめて無効にする
export const launchCommentCountsKeyOf = (productId: string) =>
  graphqlQueryKey(ClientLaunchCommentCountsDocument, { productId });

// 投稿者本人にだけ見えるプロダクトでは閲覧者で応答が変わるためキーの後に閲覧者のIDを加え、ローンチは含めずに同じプロダクトのローンチのブロックで1つの取得を共有する
export const launchCommentCountsQueryOptions = (
  viewerId: string | null,
  productId: string,
) =>
  queryOptions({
    queryKey: [...launchCommentCountsKeyOf(productId), viewerId ?? GUEST_SCOPE],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(
          ClientLaunchCommentCountsDocument,
          { productId },
          { signal },
        ),
      ),
  });

// 閲覧者自身の評価を含む応答のため、同じタブでログイン・ログアウトした後に前の閲覧者の評価を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const productRatingQueryOptions = (
  viewerId: string | null,
  productId: string,
) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientProductRatingDocument, { productId }),
      viewerId ?? GUEST_SCOPE,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(
          ClientProductRatingDocument,
          { productId },
          { signal },
        ),
      ),
  });

// 評価・取消・評価を添えたコメントの結果で、取り直さずに評価欄の値を置き換える
export function replaceProductRating(
  queryClient: QueryClient,
  viewerId: string,
  rating: ProductRatingFragment,
): void {
  queryClient.setQueryData<ClientProductRatingQuery>(
    productRatingQueryOptions(viewerId, rating.productId).queryKey,
    { productRating: rating },
  );
}
