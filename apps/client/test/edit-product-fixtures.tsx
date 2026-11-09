import { createRoute } from '@tanstack/react-router';
import { type Mock, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { executeGraphQL as executeGraphQLImpl } from '../lib/start/graphql/execute-graphql.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import {
  GraphQLClientError,
  type GraphQLClientErrorInit,
} from '../lib/utilities/graphql/graphql-result.ts';
import { ProductEditPage } from '../src/components/product/product-edit-page.tsx';
import type {
  MyProductSection,
  ProductDeleteNotice,
} from '../src/components/product/product-section-types.ts';
import {
  ClientDeleteProductDocument,
  ClientMyProductDocument,
  type ClientMyProductQuery,
  ClientMyProductsDocument,
  ClientProductCategoriesDocument,
  type ClientProductCategoriesQuery,
  ClientProductHandleAvailabilityDocument,
  ClientUpdateProductDocument,
  type ClientUpdateProductMutation,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as MyProductsRoute } from '../src/routes/_authenticated/my/products/index.tsx';
import { Route as EditProductRoute } from '../src/routes/_authenticated/my/products/$handle/edit.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

export type MyProductFields = ClientUpdateProductMutation['updateProduct'];

export type MyProductPlan = MyProductFields['plan'];

export const EDIT_PATH = '/my/products/pitch-notes/edit';

// 業務日付2026-11-09の15:00(UTC-08:00)。東京では2026-11-10の8:00
export const NOW = new Date('2026-11-09T23:00:00.000Z');

// 業務日付2026-11-20の前日の23:45(UTC-08:00)
export const PAIRING_AT = new Date('2026-11-20T07:45:00.000Z');

export const LOCK_MESSAGE =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';

export const LOCK_UNKNOWN_REASON =
  'ローンチの状態を確認できませんでした。時間をおいて再度お試しください。';

export const CONFLICT_MESSAGE =
  'プロダクトが別の画面で変更されました。最新の内容を読み込んでから操作してください。';

export const CATEGORIES: ClientProductCategoriesQuery = {
  productCategories: [
    {
      id: '01JD0CATEGORY0000000000001',
      name: '開発ツール',
      handle: 'dev-tools',
      systemDefault: false,
    },
    {
      id: '01JD0CATEGORY0000000000000',
      name: 'その他',
      handle: 'other',
      systemDefault: true,
    },
  ],
};

export const RESCHEDULE_PLAN: MyProductPlan = {
  mode: 'RESCHEDULE',
  currentLaunchDate: '2026-11-20',
  window: {
    earliest: '2026-11-10',
    latest: '2027-02-07',
    unavailable: [],
    relaunchIntervalDays: null,
  },
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
};

export const LOCKED_PLAN: MyProductPlan = {
  mode: 'BLOCKED',
  currentLaunchDate: null,
  window: null,
  blocks: [
    {
      code: 'launch_scheduled',
      message: 'このプロダクトはローンチ予定があるため再ローンチできません。',
      releaseAt: null,
    },
  ],
  locked: true,
  locks: [{ code: 'qualifier_match', message: LOCK_MESSAGE }],
  lockUnknown: false,
  ultrasEntitled: false,
};

export const PRODUCT: MyProductFields = {
  handle: 'pitch-notes',
  previousHandle: null,
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を整える',
  category: {
    id: '01JD0CATEGORY0000000000001',
    name: '開発ツール',
    handle: 'dev-tools',
    systemDefault: false,
  },
  websiteUrl: 'https://pitch.example/',
  description: '台本を整える道具です。',
  logoFileId: '01JD0FILE0000000000000L0G0',
  logo: null,
  screenshots: [
    { fileId: '01JD0FILE00000000000000002', image: null, byteSize: 2_097_152 },
  ],
  hidden: false,
  listed: false,
  version: 3,
  latestLaunch: {
    id: '01JD0LAUNCH000000000000001',
    number: 1,
    launchDate: '2026-11-20',
    kickoffAt: '2026-11-20T08:00:00.000Z',
    status: 'SCHEDULED',
    outcome: null,
    summary: { label: 'キックオフ予定', inMatch: false },
  },
  plan: RESCHEDULE_PLAN,
};

export const productWith = (
  overrides: Partial<MyProductFields>,
): MyProductFields => ({ ...PRODUCT, ...overrides });

export const ok = (data: unknown) => Promise.resolve({ ok: true, data });

export const failure = (init: GraphQLClientErrorInit) =>
  Promise.resolve({ ok: false, error: new GraphQLClientError(init) });

export const found = (product: MyProductFields): ClientMyProductQuery => ({
  myProduct: { __typename: 'MyProduct', ...product },
});

export interface Responders {
  // 照会したハンドルごとに、その時点の結果を返す
  readonly myProduct?: (handle: string) => ClientMyProductQuery;
  readonly update?: () => Promise<unknown>;
  readonly remove?: () => Promise<unknown>;
}

// テストのファイルがvi.mockで差し替えた実行の関数を、取得の応答を決めるために読む
export const executeGraphQL = executeGraphQLImpl as unknown as Mock<
  (document: unknown, variables: unknown, options?: unknown) => Promise<unknown>
>;

// 文脈に無い文書の取得は失敗にして、想定外の呼び出しを見逃さない
export const respond = ({
  myProduct = () => found(PRODUCT),
  update = () => ok({ updateProduct: PRODUCT }),
  remove = () => ok({ deleteProduct: true }),
}: Responders = {}) => {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === ClientMyProductDocument) {
      return ok(myProduct((variables as { readonly handle: string }).handle));
    }
    if (document === ClientProductCategoriesDocument) {
      return ok(CATEGORIES);
    }
    if (document === ClientProductHandleAvailabilityDocument) {
      return ok({ productHandleAvailability: 'AVAILABLE' });
    }
    if (document === ClientUpdateProductDocument) {
      return update();
    }
    if (document === ClientDeleteProductDocument) {
      return remove();
    }
    if (document === ClientMyProductsDocument) {
      return ok({
        myProducts: {
          nodes: [
            {
              handle: PRODUCT.handle,
              name: PRODUCT.name,
              category: PRODUCT.category,
              logo: null,
              hidden: false,
              listed: false,
              latestLaunch: PRODUCT.latestLaunch,
              plan: PRODUCT.plan,
            },
          ],
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      });
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

export const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

export interface EditRegistrations {
  readonly sections?: readonly MyProductSection[];
  readonly deleteNotices?: readonly ProductDeleteNotice[];
}

// アプリの経路と同じ判定・取得・画面を通すため、本物の経路の設定を画面のテスト用のルーターの同じ位置の経路へ写す。区画と注意書きの登録を確かめる時は、本物の経路と同じ画面にテスト用の登録を渡す
const createRoutesWith =
  ({ sections, deleteNotices }: EditRegistrations) =>
  (rootRoute: PageRootRoute) => {
    const authenticatedRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: '_authenticated',
      beforeLoad: AuthenticatedRoute.options.beforeLoad,
    });
    const editRoute = createRoute({
      getParentRoute: () => authenticatedRoute,
      path: 'my/products/$handle/edit',
      loader: EditProductRoute.options.loader,
      head: EditProductRoute.options.head,
      component:
        sections === undefined && deleteNotices === undefined
          ? EditProductRoute.options.component
          : function TestEditProductRoute() {
              const { viewer } = editRoute.useRouteContext();
              const { handle } = editRoute.useParams();
              const { name } = editRoute.useLoaderData();
              return (
                <ProductEditPage
                  key={handle}
                  viewer={viewer}
                  handle={handle}
                  productName={name}
                  sections={sections ?? []}
                  deleteNotices={deleteNotices ?? []}
                />
              );
            },
    } as Parameters<typeof createRoute>[0]) as unknown as {
      useRouteContext: typeof EditProductRoute.useRouteContext;
      useParams: typeof EditProductRoute.useParams;
      useLoaderData: typeof EditProductRoute.useLoaderData;
    } & ReturnType<typeof createRoute>;
    return [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <h1>トップページ</h1>,
      }),
      authenticatedRoute.addChildren([
        createRoute({
          getParentRoute: () => authenticatedRoute,
          path: 'my/products',
          loader: MyProductsRoute.options.loader,
          component: MyProductsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
        editRoute,
      ]),
    ];
  };

export async function renderEditProduct({
  path = EDIT_PATH,
  viewer = signedInViewerQuery(),
  registrations = {},
  now = NOW,
  fakeTimers = ['Date'],
}: {
  readonly path?: string;
  readonly viewer?: ReturnType<typeof signedInViewerQuery>;
  readonly registrations?: EditRegistrations;
  readonly now?: Date;
  readonly fakeTimers?: readonly ('Date' | 'setTimeout' | 'clearTimeout')[];
} = {}) {
  vi.useFakeTimers({ now, toFake: [...fakeTimers] });
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  const router = await renderPageRouter({
    path,
    createRoutes: createRoutesWith(registrations),
    context: createPageRouterContext('local'),
    cachedViewer: viewer,
  });
  await render(<Toaster />);
  return router;
}

export const main = () => page.getByRole('main');
export const pageTitle = () => main().getByRole('heading', { level: 1 });
export const form = () =>
  main().getByRole('form', { name: 'Pitch Notesを編集' });
export const textbox = (name: string) => form().getByRole('textbox', { name });
export const saveButton = () =>
  form().getByRole('button', { name: '変更を保存', exact: true });
export const categorySelect = () =>
  form().getByRole('combobox', { name: 'カテゴリ(必須)' });
export const statusSection = () =>
  main().getByRole('region', { name: 'ローンチの状態' });
export const dangerSection = () =>
  main().getByRole('region', { name: '危険な操作' });
export const deleteButton = () =>
  dangerSection().getByRole('button', { name: 'プロダクトを削除' });
export const dialog = () => page.getByRole('dialog');

// 送った更新の入力
export const updateInputOf = (index = 0): unknown =>
  (callsOf(ClientUpdateProductDocument)[index] as readonly unknown[])[1];
