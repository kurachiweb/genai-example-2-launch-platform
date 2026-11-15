import { createRoute } from '@tanstack/react-router';

import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import type { QualifierBoardView } from '../src/components/top/qualifier-board-fixtures.ts';
import {
  ClientQualifierBoardDocument,
  type ClientQualifierBoardQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as TopPageRoute } from '../src/routes/index.tsx';
import { GUEST_VIEWER_QUERY, renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

interface ExecuteGraphQLMock {
  readonly mock: { readonly calls: readonly (readonly unknown[])[] };
}

export const boardResult = (
  board: QualifierBoardView,
): GraphQLResult<ClientQualifierBoardQuery> => ({
  ok: true,
  data: { qualifierBoard: board },
});

// アプリの経路と同じ取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じパスの経路へ写す
export const renderTopPage = ({
  signedIn = false,
}: { readonly signedIn?: boolean } = {}) =>
  renderPageRouter({
    path: '/',
    cachedViewer: signedIn ? signedInViewerQuery() : GUEST_VIEWER_QUERY,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        loader: TopPageRoute.options.loader,
        pendingComponent: TopPageRoute.options.pendingComponent,
        errorComponent: TopPageRoute.options.errorComponent,
        component: TopPageRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ],
  });

export const boardCallsOf = (executeGraphQL: ExecuteGraphQLMock) =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientQualifierBoardDocument,
  );
