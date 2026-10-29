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
import type { DisplayPreferences } from '../lib/utilities/datetime/display-preferences.ts';
import type { AppEnvironment } from '../lib/utilities/system/system-status-availability.ts';
import { AdminLayout } from '../src/components/layout/admin-layout.tsx';
import { ErrorPage } from '../src/components/pages/error-page.tsx';
import { NotFoundPage } from '../src/components/pages/not-found-page.tsx';
import { ADMIN_LAYOUT_SLOTS } from '../src/composition/layout-slots.ts';

export interface PageRouterOptions {
  readonly path: string;
  readonly createRoutes: (rootRoute: PageRootRoute) => readonly AnyRoute[];
  readonly context?: RouterContext;
}

const PAGE_ROUTER_DISPLAY: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

export const createPageRouterContext = (
  environment: AppEnvironment,
): RouterContext =>
  createRouterContext({
    publicConfig: {
      environment,
      turnstileSiteKey: '1x00000000000000000000BB',
      sentry: { dsn: undefined, environment, tracesSampleRate: 0 },
      webAnalyticsToken: undefined,
    },
    display: PAGE_ROUTER_DISPLAY,
  });

export const PAGE_ROUTER_ROOT_COMPONENTS = Object.freeze({
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

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

// 本物の経路の設定を子に付けられるよう、アプリのルートと同じ型にする
const createPageRootRoute = () =>
  createRootRouteWithContext<RouterContext>()({
    shellComponent: PageShell,
    ...PAGE_ROUTER_ROOT_COMPONENTS,
  });

export type PageRootRoute = ReturnType<typeof createPageRootRoute>;

// アプリのルートと同じく、基本レイアウトをルートのshellComponentに置き、経路の内容・存在しないページ・想定外のエラーの画面をその中に出すルーターを、メモリ上の履歴で作る
export function createPageRouter({
  path,
  createRoutes,
  context = createPageRouterContext('local'),
}: PageRouterOptions) {
  const rootRoute = createPageRootRoute();
  return createRouter({
    routeTree: rootRoute.addChildren([...createRoutes(rootRoute)]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context,
  });
}

export async function renderPageRouter(options: PageRouterOptions) {
  const router = createPageRouter(options);
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
