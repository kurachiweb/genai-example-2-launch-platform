import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { ratingModerationListArgsOf } from '../src/components/moderation/shared/moderation-search.ts';
import { loadAdminModerationRatingsPage } from '../src/graphql/admin-moderation-engagement.ts';
import {
  type AdminRatingsQuery,
  type AdminRatingsQueryVariables,
  AdminRatingsDocument,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as RatingsRoute } from '../src/routes/_authenticated/ratings/index.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import {
  MODERATION_REASON,
  type ModerationGraphQLHandler,
  respondModerationGraphQL,
} from './moderation-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const RATINGS_PATH = '/ratings';

export type RatingNode = AdminRatingsQuery['adminRatings']['nodes'][number];

const PRODUCT_ID = '01KA0PR0DVCT00000000000001';

export const VALID_RATING_NODE: RatingNode = Object.freeze<RatingNode>({
  id: '01KA0RAT1NG000000000000001',
  rater: {
    id: '01KA0VSER00000000000000001',
    handle: 'maker_ai',
    nickname: 'サンプル太郎',
    suspended: false,
  },
  productName: 'Pitch Notes',
  productId: PRODUCT_ID,
  score: 4,
  createdAt: '2026-11-09T01:00:00.000Z',
  updatedAt: '2026-11-10T01:00:00.000Z',
  state: 'VALID',
  latestInvalidation: null,
});

export const INVALIDATED_RATING_NODE: RatingNode = Object.freeze<RatingNode>({
  id: '01KA0RAT1NG000000000000002',
  rater: {
    id: '01KA0VSER00000000000000002',
    handle: 'pixel_hanako',
    nickname: 'サンプル花子',
    suspended: false,
  },
  productName: 'Pitch Notes',
  productId: PRODUCT_ID,
  score: 1,
  createdAt: '2026-11-08T01:00:00.000Z',
  updatedAt: '2026-11-08T03:30:00.000Z',
  state: 'INVALIDATED',
  latestInvalidation: {
    reason: MODERATION_REASON,
    occurredAt: '2026-11-12T03:00:00.000Z',
  },
});

// 評価者を読めず、プロダクトが論理削除された評価
export const UNREADABLE_RATING_NODE: RatingNode = Object.freeze<RatingNode>({
  id: '01KA0RAT1NG000000000000003',
  rater: null,
  productName: null,
  productId: '01KA0PR0DVCT00000000000002',
  score: 5,
  createdAt: '2026-11-07T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
  state: 'VALID',
  latestInvalidation: null,
});

export const RATING_NODES: readonly RatingNode[] = Object.freeze([
  VALID_RATING_NODE,
  INVALIDATED_RATING_NODE,
  UNREADABLE_RATING_NODE,
]);

export const ratingsQueryOf = (
  nodes: readonly RatingNode[],
  endCursor: string | null = null,
): AdminRatingsQuery => ({
  adminRatings: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

export type RatingsHandler = (
  variables: AdminRatingsQueryVariables,
) => Promise<unknown>;

// ログイン中の管理者と、評価の一覧・措置の操作にテストが渡した応答を返す
export function respondRatingsGraphQL(
  executeGraphQL: Mock,
  {
    role,
    ratings = () => success(ratingsQueryOf(RATING_NODES)),
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly ratings?: RatingsHandler;
    readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  },
): void {
  respondModerationGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, ModerationGraphQLHandler>([
      [
        AdminRatingsDocument,
        (variables) => ratings(variables as AdminRatingsQueryVariables),
      ],
      ...handlers,
    ]),
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const ratingsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'ratings',
  });
  return [
    authenticatedRoute.addChildren([
      ratingsRoute.addChildren([
        createRoute({
          getParentRoute: () => ratingsRoute,
          path: '/',
          validateSearch: RatingsRoute.options.validateSearch,
          loaderDeps: ({ search }) => ratingModerationListArgsOf(search),
          loader: loadAdminModerationRatingsPage,
          component: RatingsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

// 措置の結果のトーストは文書の外枠が置くため、ページのルーターの外に置く
export async function renderRatingsPage(role: AdminRole, path = RATINGS_PATH) {
  await render(<Toaster />);
  return renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
}

export const ratingsVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminRatingsQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminRatingsDocument)
    .map(([, variables]) => variables as AdminRatingsQueryVariables);
