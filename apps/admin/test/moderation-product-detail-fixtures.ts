import { createRoute } from '@tanstack/react-router';
import { createElement } from 'react';
import type { Mock } from 'vitest';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { loadAdminModerationProductPage } from '../src/graphql/admin-moderation-products.ts';
import {
  AdminProductDocument,
  type AdminProductQuery,
  AdminProductRatingsDocument,
  type AdminProductRatingsQuery,
  type AdminRole,
  AdminViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import { Route as ProductDetailRoute } from '../src/routes/_authenticated/products/$productId.tsx';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminViewerResult, adminWithRole } from './admin-viewer-fixtures.ts';
import {
  LOGO_FILE_ID,
  PRODUCT_ID,
  RATING_ID,
  relayPathOf,
  USER_ID,
} from './moderation-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const PRODUCT_DETAIL_PATH = `/products/${PRODUCT_ID}`;

export const SCREENSHOT_FILE_IDS = Object.freeze([
  '01KA0MED1A0000000000000011',
  '01KA0MED1A0000000000000012',
]);

export const HIDDEN_AT = '2026-11-12T03:00:00.000Z';

export const HIDE_REASON = '虚偽の説明文で利用者を誘導していたため';

type ProductDetail = NonNullable<AdminProductQuery['adminProduct']>;

type RatingNode =
  AdminProductRatingsQuery['adminProductRatings']['nodes'][number];

type Launch = ProductDetail['launches'][number];

type Match = Launch['matches'][number];

const mediaFile = (
  id: string,
  quarantineReasons: ProductDetail['screenshots'][number]['quarantineReasons'] = [],
) => ({
  id,
  path: relayPathOf(id),
  quarantined: quarantineReasons.length > 0,
  quarantineReasons,
});

export const matchOf = (overrides: Partial<Match> = {}): Match => ({
  id: '01KA0MATCH0000000000000001',
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: '2026-11-03',
  upvoteCount: 12,
  result: 'won',
  phase: 'finished',
  decision: 'votes',
  opponentName: 'Tactics Board',
  ...overrides,
});

export const LAUNCHES: readonly Launch[] = Object.freeze([
  {
    id: '01KA0LAVNCH000000000000002',
    number: 2,
    launchDate: '2026-11-10',
    status: 'won',
    matches: [
      matchOf({
        id: '01KA0MATCH0000000000000011',
        matchDate: '2026-11-10',
        upvoteCount: 9,
        result: 'won',
        opponentName: null,
      }),
      matchOf({
        id: '01KA0MATCH0000000000000012',
        kind: 'week',
        round: 1,
        stage: null,
        matchDate: '2026-11-11',
        upvoteCount: 7,
        result: 'lost',
        opponentName: 'Formation Lab',
      }),
      matchOf({
        id: '01KA0MATCH0000000000000013',
        kind: 'week',
        round: 3,
        stage: 'semifinal',
        matchDate: '2026-11-12',
        upvoteCount: 0,
        result: 'bye',
        decision: 'bye',
        opponentName: null,
      }),
      matchOf({
        id: '01KA0MATCH0000000000000014',
        kind: 'year',
        round: 1,
        stage: null,
        matchDate: '2026-11-30',
        upvoteCount: 0,
        result: null,
        phase: 'scheduled',
        decision: null,
        opponentName: 'Kickoff Board',
      }),
    ],
  },
  {
    id: '01KA0LAVNCH000000000000001',
    number: 1,
    launchDate: '2026-11-03',
    status: 'canceled',
    matches: [],
  },
]);

export const productDetailOf = (
  overrides: Partial<ProductDetail> = {},
  product: Partial<ProductDetail['product']> = {},
): ProductDetail => ({
  product: {
    id: PRODUCT_ID,
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    logo: mediaFile(LOGO_FILE_ID),
    owner: {
      id: USER_ID,
      handle: 'maker_ai',
      nickname: 'サンプル太郎',
      suspended: false,
    },
    category: { id: '01KA0CATEG0RY0000000000001', name: '開発ツール' },
    latestLaunchDate: '2026-11-10',
    latestLaunchState: 'WON',
    visibility: 'VISIBLE',
    ...product,
  },
  tagline: '試合の記録を共有するノートアプリ',
  descriptionMarkdown:
    '## 特徴\n\n試合の**記録**を残せます。詳しくは[公式サイト](https://docs.example/guide)を見てください。',
  websiteUrl: 'https://pitch-notes.example',
  screenshots: [
    mediaFile(SCREENSHOT_FILE_IDS[0] ?? ''),
    mediaFile(SCREENSHOT_FILE_IDS[1] ?? '', ['ADMIN_ACTION']),
  ],
  hiddenAt: null,
  latestHide: null,
  ratingSummary: { average: 4.25, count: 1234 },
  launches: [...LAUNCHES],
  ...overrides,
});

export const HIDDEN_PRODUCT_DETAIL: ProductDetail = productDetailOf(
  {
    hiddenAt: HIDDEN_AT,
    latestHide: { reason: HIDE_REASON, occurredAt: HIDDEN_AT },
    screenshots: [
      mediaFile(SCREENSHOT_FILE_IDS[0] ?? '', ['PRODUCT_HIDDEN']),
      mediaFile(SCREENSHOT_FILE_IDS[1] ?? '', [
        'PRODUCT_HIDDEN',
        'ADMIN_ACTION',
      ]),
    ],
  },
  {
    visibility: 'HIDDEN',
    logo: mediaFile(LOGO_FILE_ID, ['PRODUCT_HIDDEN']),
  },
);

export const ratingNodeOf = (
  overrides: Partial<RatingNode> = {},
): RatingNode => ({
  id: RATING_ID,
  rater: {
    id: USER_ID,
    handle: 'fan_1',
    nickname: 'サンプル花子',
    suspended: false,
  },
  productName: 'Pitch Notes',
  productId: PRODUCT_ID,
  score: 4,
  createdAt: '2026-11-10T01:00:00.000Z',
  updatedAt: '2026-11-11T02:30:00.000Z',
  state: 'VALID',
  latestInvalidation: null,
  ...overrides,
});

export const INVALIDATED_RATING_NODE: RatingNode = ratingNodeOf({
  id: '01KA0RAT1NG000000000000002',
  rater: null,
  score: 1,
  updatedAt: '2026-11-12T05:00:00.000Z',
  state: 'INVALIDATED',
  latestInvalidation: { reason: '自作自演の評価のため', occurredAt: HIDDEN_AT },
});

export const productRatingsOf = (
  nodes: readonly RatingNode[],
  endCursor: string | null = null,
): AdminProductRatingsQuery => ({
  adminProductRatings: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

export type ProductDetailHandler = (variables: unknown) => Promise<unknown>;

// ログイン中の管理者・詳細・評価の一覧に既定の応答を返し、テストが渡した応答で置き換える
export function respondProductDetailGraphQL(
  executeGraphQL: Mock,
  {
    role,
    detail = productDetailOf(),
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly detail?: ProductDetail | null;
    readonly handlers?: ReadonlyMap<unknown, ProductDetailHandler>;
  },
): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    if (handler !== undefined) {
      return handler(variables);
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(adminWithRole(role)));
    }
    if (document === AdminProductDocument) {
      return success({ adminProduct: detail });
    }
    if (document === AdminProductRatingsDocument) {
      return success(
        productRatingsOf([ratingNodeOf(), INVALIDATED_RATING_NODE]),
      );
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const productsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'products',
  });
  return [
    authenticatedRoute.addChildren([
      productsRoute.addChildren([
        createRoute({
          getParentRoute: () => productsRoute,
          path: '$productId',
          loader: loadAdminModerationProductPage,
          component: ProductDetailRoute.options.component,
          notFoundComponent: ProductDetailRoute.options.notFoundComponent,
        }),
      ]),
    ]),
  ];
};

// 措置の結果のトーストを確かめられるよう、通知の置き場所も描く
export async function renderProductDetailPage(
  role: AdminRole,
  path = PRODUCT_DETAIL_PATH,
) {
  await render(createElement(Toaster));
  return renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
}
