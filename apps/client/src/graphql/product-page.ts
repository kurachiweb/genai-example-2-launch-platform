import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { notFound, redirect } from '@tanstack/react-router';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import { checkHandleFormat } from '../../common-lib/handles/handle-rules.ts';
import { PRODUCT_HANDLE_RULE } from '../../common-lib/product/product-input-rules.ts';
import { productDetailHref } from '../components/layout/site-links.ts';
import {
  ClientProductLiveMatchDocument,
  type ClientProductLiveMatchQuery,
  ClientProductPageDocument,
  type ClientProductPageQuery,
  type MatchFragment,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export type ProductPageView = Extract<
  NonNullable<ClientProductPageQuery['productPage']>,
  { readonly __typename: 'ProductPage' }
>;

export interface ProductPageLoaderData {
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly listed: boolean;
}

interface ProductPageLoaderArgs {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer | null;
  };
  readonly params: { readonly handle: string };
  readonly location: { readonly searchStr: string };
}

const GUEST_SCOPE = 'guest';

const viewerScopeOf = (viewer: ClientViewer | null): string =>
  viewer === null ? GUEST_SCOPE : viewer.id;

// 本人かどうかと、未掲載のプロダクトを本人にだけ返すことを含む応答のため、同じタブでログイン・ログアウトした後に前の閲覧者の応答を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const productPageQueryOptions = (
  viewer: ClientViewer | null,
  handle: string,
) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientProductPageDocument, { handle }),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientProductPageDocument, { handle }, { signal }),
      ),
  });

// マッチの閲覧者ごとの項目(Upvote済みの側・自分のプロダクト・Upvoteできない理由)を含むため、詳細ページと同じく閲覧者のIDをキーに加える
export const productLiveMatchQueryOptions = (
  viewer: ClientViewer | null,
  productHandle: string,
) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientProductLiveMatchDocument, { productHandle }),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(
          ClientProductLiveMatchDocument,
          { productHandle },
          { signal },
        ),
      ),
  });

export const toProductPageView = ({
  productPage,
}: ClientProductPageQuery): ProductPageView | undefined =>
  productPage?.__typename === 'ProductPage' ? productPage : undefined;

// 形式に合わないハンドルは存在し得ないため照会しない。存在しない・閲覧できない場合は同じ404にし、旧ハンドルは現在のハンドルへ302で転送する。
// 開催中のマッチは定期の取り直しと組で表示した時点の最新を示すため毎回取り直し、その失敗はページを止めず区画の位置で再試行させる。詳細ページの取得の失敗はエラーの画面にするため、そのまま投げる
export async function loadProductPage({
  context: { queryClient, viewer },
  params: { handle },
  location,
}: ProductPageLoaderArgs): Promise<ProductPageLoaderData> {
  if (checkHandleFormat(handle, PRODUCT_HANDLE_RULE) !== 'ok') {
    throw notFound();
  }
  const [data] = await Promise.all([
    queryClient.query({
      ...productPageQueryOptions(viewer, handle),
      staleTime: 'static',
    }),
    queryClient
      .query({ ...productLiveMatchQueryOptions(viewer, handle), staleTime: 0 })
      .catch(() => undefined),
  ]);
  const { productPage } = data;
  if (productPage === null) {
    throw notFound();
  }
  if (productPage.__typename === 'ProductPageRedirect') {
    throw redirect({
      href: `${productDetailHref(productPage.handle)}${location.searchStr}`,
      statusCode: 302,
    });
  }
  return {
    handle: productPage.handle,
    name: productPage.name,
    tagline: productPage.tagline,
    listed: productPage.listed,
  };
}

// Upvote・取り消しの結果で、取り直さずに開催中のマッチだけを差し替える。操作の結果に無い終了の時刻などは取得の値を保つ
export function withUpdatedLiveMatch(
  data: ClientProductLiveMatchQuery,
  match: MatchFragment,
): ClientProductLiveMatchQuery;
export function withUpdatedLiveMatch(
  data: ClientProductLiveMatchQuery | undefined,
  match: MatchFragment,
): ClientProductLiveMatchQuery | undefined;
export function withUpdatedLiveMatch(
  data: ClientProductLiveMatchQuery | undefined,
  match: MatchFragment,
): ClientProductLiveMatchQuery | undefined {
  const live = data?.productLiveMatch;
  if (
    data === undefined ||
    live === null ||
    live === undefined ||
    live.match === null ||
    live.match.id !== match.id
  ) {
    return data;
  }
  return {
    ...data,
    productLiveMatch: { ...live, match: { ...live.match, ...match } },
  };
}
