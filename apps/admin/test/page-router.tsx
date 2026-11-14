import { QueryClientProvider } from '@tanstack/react-query';
import {
  type AnyRoute,
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';

import { MAIN_CONTENT_ID } from '../lib/components/app-shell/main-content.ts';
import { DisplayPreferencesProvider } from '../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../lib/components/ui/tooltip/tooltip-provider.tsx';
import {
  appRuntimeOf,
  createRouterContext,
  type RouterContext,
} from '../lib/start/router-context.ts';
import type { PublicRuntimeConfig } from '../lib/server/env/frontend-env.ts';
import type { DisplayPreferences } from '../lib/utilities/datetime/display-preferences.ts';
import type { AppEnvironment } from '../lib/utilities/system/system-status-availability.ts';
import { AdminLayout } from '../src/components/layout/admin-layout.tsx';
import { ErrorPage } from '../src/components/pages/error-page.tsx';
import { NotFoundPage } from '../src/components/pages/not-found-page.tsx';
import { ADMIN_LAYOUT_SLOTS } from '../src/composition/layout-slots.ts';
import {
  adminViewerQueryOptions,
  loadRootAuthContext,
} from '../src/graphql/admin-viewer.ts';
import type { AdminViewerQuery } from '../src/graphql/generated/graphql.ts';
import { GUEST_ADMIN_QUERY } from './admin-viewer-fixtures.ts';

export interface RouterRenderOptions {
  readonly path?: string;
  readonly context?: RouterContext;
  readonly cachedViewer?: AdminViewerQuery | null;
}

export interface PageRouterOptions {
  readonly path: string;
  readonly createRoutes: (rootRoute: PageRootRoute) => readonly AnyRoute[];
  readonly context?: RouterContext;
  readonly cachedViewer?: AdminViewerQuery | null;
}

const PAGE_ROUTER_DISPLAY: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

// 画像の書き出し先はアプリのルート直下で、共通部品の補助が返すオリジンは共通部品のディレクトリ基準のため、開発サーバーのルートから配信されるURLを自分で組み立てる
export const SERVED_IMAGES_ORIGIN = `${location.origin}/.vitest-attachments/served-media-images`;

export const createPageRouterContext = (
  environment: AppEnvironment,
  publicConfig: Partial<PublicRuntimeConfig> = {},
): RouterContext =>
  createRouterContext({
    publicConfig: {
      environment,
      turnstileSiteKey: '1x00000000000000000000BB',
      clientSiteOrigin: 'https://client.example',
      imagesOrigin: 'https://images.example',
      sentry: { dsn: undefined, environment, tracesSampleRate: 0 },
      webAnalyticsToken: undefined,
      stripePublishableKey: undefined,
      ...publicConfig,
    },
    display: PAGE_ROUTER_DISPLAY,
  });

export const PAGE_ROUTER_ROOT_COMPONENTS = Object.freeze({
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

export const PAGE_ROUTER_ROOT_BEFORE_LOAD = loadRootAuthContext;

// アプリではSSRとクエリの連携がルーターの外側にQueryClientProviderを置くため、テストのルーターも同じ位置に置く
const createQueryClientWrap =
  (context: RouterContext) =>
  ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={context.queryClient}>
      {children}
    </QueryClientProvider>
  );

// nullならキャッシュを空のままにし、ルートのbeforeLoadに取得させる
function cacheViewer(
  context: RouterContext,
  cachedViewer: AdminViewerQuery | null,
): void {
  if (cachedViewer !== null) {
    context.queryClient.setQueryData(
      adminViewerQueryOptions().queryKey,
      cachedViewer,
    );
  }
}

// アプリの文書の外枠と同じく、ルーターの文脈の表示設定を日時の部品へ渡す
function PageShell({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  return (
    <DisplayPreferencesProvider
      initial={appRuntimeOf(router.options.context).display}
    >
      <TooltipProvider>
        <AdminLayout slots={ADMIN_LAYOUT_SLOTS}>{children}</AdminLayout>
      </TooltipProvider>
    </DisplayPreferencesProvider>
  );
}

// 本物の経路の設定を子に付けられるよう、beforeLoadを含めてアプリのルートと同じ型にする
const createPageRootRoute = () =>
  createRootRouteWithContext<RouterContext>()({
    beforeLoad: PAGE_ROUTER_ROOT_BEFORE_LOAD,
    shellComponent: PageShell,
    ...PAGE_ROUTER_ROOT_COMPONENTS,
  });

export type PageRootRoute = ReturnType<typeof createPageRootRoute>;

// アプリのルートと同じく、基本レイアウトをルートのshellComponentに置き、経路の内容・存在しないページ・想定外のエラーの画面をその中に出すルーターを、メモリ上の履歴で作る
export function createPageRouter({
  path,
  createRoutes,
  context = createPageRouterContext('local'),
  cachedViewer = GUEST_ADMIN_QUERY,
}: PageRouterOptions) {
  cacheViewer(context, cachedViewer);
  const rootRoute = createPageRootRoute();
  return createRouter({
    routeTree: rootRoute.addChildren([...createRoutes(rootRoute)]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context,
    Wrap: createQueryClientWrap(context),
  });
}

export async function renderPageRouter(options: PageRouterOptions) {
  const router = createPageRouter(options);
  await render(<RouterProvider router={router} />);
  return router;
}

// 経路への遷移とログイン中の管理者の取得を使う部品を、基本レイアウトを持たないルーターの中で描く
export async function renderInRouter(
  element: ReactNode,
  {
    path = '/',
    context = createPageRouterContext('local'),
    cachedViewer = GUEST_ADMIN_QUERY,
  }: RouterRenderOptions = {},
) {
  cacheViewer(context, cachedViewer);
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => element,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
    context,
    Wrap: createQueryClientWrap(context),
  });
  await render(<RouterProvider router={router} />);
  return router;
}

// 本文へ移動のリンクと同じく、本文の領域にフォーカスを置いてTabの起点にする
export function focusMainContent(): void {
  const main = document.getElementById(MAIN_CONTENT_ID);
  if (main === null) {
    throw new Error('本文の領域がありません。');
  }
  main.setAttribute('tabindex', '-1');
  main.focus();
}
