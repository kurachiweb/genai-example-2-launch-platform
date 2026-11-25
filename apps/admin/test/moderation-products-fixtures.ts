import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import type { RouterContext } from '../lib/start/router-context.ts';
import {
  productModerationListArgsOf,
  toProductModerationSearch,
} from '../src/components/moderation/shared/moderation-search.ts';
import type { AdminModerationProductListArgs } from '../src/graphql/admin-moderation-products.ts';
import {
  AdminModerationCategoryOptionsDocument,
  type AdminModerationCategoryOptionsQuery,
  AdminProductsDocument,
  type AdminProductsQuery,
  type AdminProductsQueryVariables,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as ProductsRoute } from '../src/routes/_authenticated/products/index.tsx';
import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import { success } from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import {
  LOGO_FILE_ID,
  PRODUCT_ID,
  graphQLImageOf,
  LOGO_OBJECT_KEY,
  relayPathOf,
  respondModerationGraphQL,
  USER_ID,
} from './moderation-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const PRODUCTS_PATH = '/products';

export const CATEGORY_ID = '01KA0CATEG0RY0000000000001';

export const OTHER_CATEGORY_ID = '01KA0CATEG0RY0000000000002';

type ProductNode = AdminProductsQuery['adminProducts']['nodes'][number];

export const LAUNCHED_PRODUCT_NODE: ProductNode = Object.freeze({
  id: PRODUCT_ID,
  handle: 'pitch_notes',
  name: 'Pitch Notes',
  logo: Object.freeze({
    id: LOGO_FILE_ID,
    path: relayPathOf(LOGO_FILE_ID),
    image: graphQLImageOf(LOGO_FILE_ID, LOGO_OBJECT_KEY),
    quarantined: false,
    quarantineReasons: [],
  }),
  owner: Object.freeze({
    id: USER_ID,
    handle: 'maker_ai',
    nickname: 'サンプル太郎',
    suspended: false,
  }),
  category: Object.freeze({ id: CATEGORY_ID, name: '生産性' }),
  latestLaunchDate: '2026-11-16',
  latestLaunchState: 'WON',
  visibility: 'VISIBLE',
});

export const UNLAUNCHED_PRODUCT_NODE: ProductNode = Object.freeze({
  id: '01KA0PR0DVCT00000000000002',
  handle: 'quiet_tool',
  name: 'Quiet Tool',
  logo: null,
  owner: null,
  category: Object.freeze({ id: OTHER_CATEGORY_ID, name: '開発ツール' }),
  latestLaunchDate: null,
  latestLaunchState: null,
  visibility: 'HIDDEN',
});

export const SUSPENDED_OWNER_PRODUCT_NODE: ProductNode = Object.freeze({
  ...LAUNCHED_PRODUCT_NODE,
  id: '01KA0PR0DVCT00000000000003',
  handle: 'late_launch',
  name: 'Late Launch',
  logo: null,
  latestLaunchDate: '2026-12-01',
  latestLaunchState: 'SCHEDULED',
  visibility: 'OWNER_SUSPENDED',
});

export const productsQueryOf = (
  nodes: readonly ProductNode[],
  endCursor: string | null = null,
): AdminProductsQuery => ({
  adminProducts: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

export const FIRST_PRODUCTS_PAGE = productsQueryOf([
  LAUNCHED_PRODUCT_NODE,
  UNLAUNCHED_PRODUCT_NODE,
  SUSPENDED_OWNER_PRODUCT_NODE,
]);

export const CATEGORY_OPTIONS: AdminModerationCategoryOptionsQuery =
  Object.freeze({
    adminModerationCategoryOptions: [
      { id: OTHER_CATEGORY_ID, name: '開発ツール' },
      { id: CATEGORY_ID, name: '生産性' },
    ],
  });

export type ProductsHandler = (
  variables: AdminProductsQueryVariables,
) => Promise<GraphQLResult<AdminProductsQuery>>;

export type CategoryOptionsHandler = () => Promise<
  GraphQLResult<AdminModerationCategoryOptionsQuery>
>;

export function respondModerationProductsGraphQL(
  executeGraphQL: Mock,
  {
    role,
    products = () => success(FIRST_PRODUCTS_PAGE),
    categories = () => success(CATEGORY_OPTIONS),
  }: {
    readonly role: AdminRole;
    readonly products?: ProductsHandler;
    readonly categories?: CategoryOptionsHandler;
  },
): void {
  respondModerationGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, (variables: unknown) => Promise<unknown>>([
      [
        AdminProductsDocument,
        (variables) => products(variables as AdminProductsQueryVariables),
      ],
      [AdminModerationCategoryOptionsDocument, () => categories()],
    ]),
  });
}

export const productsVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminProductsQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminProductsDocument)
    .map(([, variables]) => variables as AdminProductsQueryVariables);

export const categoryOptionsCallsOf = (executeGraphQL: Mock): number =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === AdminModerationCategoryOptionsDocument,
  ).length;

type TestProductsLoader = (input: {
  readonly context: RouterContext;
  readonly deps: AdminModerationProductListArgs;
  readonly cause: 'preload' | 'enter' | 'stay';
}) => Promise<void> | undefined;

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す。検索パラメータの検証・loaderの依存は型がアプリの経路の木に結び付き写せないため同じ関数で作り(同じであることは画面のテストが確かめる)、loaderは引数の型だけを読み替えて同じ関数を渡す。詳細の経路は一覧からの移動先を確かめるための代わりの経路にする
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
          path: '/',
          validateSearch: toProductModerationSearch,
          loaderDeps: ({ search }) => productModerationListArgsOf(search),
          loader: ProductsRoute.options.loader as unknown as TestProductsLoader,
          component: ProductsRoute.options.component,
        }),
        createRoute({
          getParentRoute: () => productsRoute,
          path: '$productId',
          component: () => null,
        }),
      ]),
    ]),
  ];
};

export const renderModerationProductsPage = (
  role: AdminRole,
  path = PRODUCTS_PATH,
) =>
  renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
