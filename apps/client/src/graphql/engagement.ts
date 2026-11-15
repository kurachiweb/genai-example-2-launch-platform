import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientProductRatingDocument,
  type ClientProductRatingQuery,
  type ProductRatingFragment,
} from './generated/graphql.ts';

const GUEST_SCOPE = 'guest';

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
