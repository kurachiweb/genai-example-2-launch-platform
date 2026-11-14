import { createRoute } from '@tanstack/react-router';

import type { ProductLiveMatchView } from '../src/components/product-page/live-match-fixtures.ts';
import {
  ClientProductLiveMatchDocument,
  ClientProductOwnerStatusDocument,
  ClientProductPageDocument,
  type ClientProductPageQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as ProductPageRoute } from '../src/routes/p/$handle.tsx';
import { GUEST_VIEWER_QUERY, renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

interface ExecuteGraphQLMock {
  readonly mock: { readonly calls: readonly (readonly unknown[])[] };
  mockImplementation(
    implementation: (document: unknown, variables: unknown) => unknown,
  ): unknown;
}

export const ROUTE_PATH = '/p/$handle';

export interface RenderProductRouteOptions {
  readonly signedIn?: boolean;
  readonly pendingMs?: number;
}

// アプリの経路と同じ取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じパスの経路へ写す
export const renderProductRoute = (
  path: string,
  { signedIn = false, pendingMs }: RenderProductRouteOptions = {},
) =>
  renderPageRouter({
    path,
    cachedViewer: signedIn ? signedInViewerQuery() : GUEST_VIEWER_QUERY,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: ROUTE_PATH,
        loader: ProductPageRoute.options.loader,
        pendingComponent: ProductPageRoute.options.pendingComponent,
        errorComponent: ProductPageRoute.options.errorComponent,
        notFoundComponent: ProductPageRoute.options.notFoundComponent,
        component: ProductPageRoute.options.component,
        ...(pendingMs === undefined ? {} : { pendingMs }),
      } as Parameters<typeof createRoute>[0]),
    ],
  });

export const ok = (data: unknown) => ({ ok: true, data });

export interface ProductRouteResponses {
  // 照会のハンドルごとの詳細ページの結果。無いハンドルはnull
  readonly pages: Readonly<
    Record<string, ClientProductPageQuery['productPage']>
  >;
  // 取得のたびに先頭の結果を返し、最後の結果は返し続ける。結果の代わりに失敗の結果も置ける
  readonly liveMatches?: readonly (ProductLiveMatchView | null | object)[];
}

const isFailure = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'ok' in value &&
  value.ok === false;

export const respondProductRoute = (
  executeGraphQL: ExecuteGraphQLMock,
  { pages, liveMatches = [null] }: ProductRouteResponses,
): void => {
  const queue = [...liveMatches];
  executeGraphQL.mockImplementation((document, variables) => {
    if (document === ClientProductPageDocument) {
      const { handle } = variables as { readonly handle: string };
      return Promise.resolve(ok({ productPage: pages[handle] ?? null }));
    }
    if (document === ClientProductLiveMatchDocument) {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve(
        isFailure(next) ? next : ok({ productLiveMatch: next ?? null }),
      );
    }
    if (document === ClientProductOwnerStatusDocument) {
      return Promise.resolve(ok({ productOwnerStatus: null }));
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

export const callsOf = (
  executeGraphQL: ExecuteGraphQLMock,
  document: unknown,
) => executeGraphQL.mock.calls.filter(([called]) => called === document);
