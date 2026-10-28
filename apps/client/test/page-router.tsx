import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';

import { MAIN_CONTENT_ID } from '../lib/components/app-shell/main-content.ts';
import { TooltipProvider } from '../lib/components/ui/tooltip/tooltip-provider.tsx';
import { SiteLayout } from '../src/components/layout/site-layout.tsx';
import { ErrorPage } from '../src/components/pages/error-page.tsx';
import { NotFoundPage } from '../src/components/pages/not-found-page.tsx';
import { SITE_LAYOUT_SLOTS } from '../src/composition/layout-slots.ts';

export interface PageRouterOptions {
  readonly path: string;
  readonly createRoutes: (rootRoute: AnyRoute) => readonly AnyRoute[];
}

export const PAGE_ROUTER_ROOT_COMPONENTS = Object.freeze({
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

function PageShell({ children }: { readonly children: ReactNode }) {
  return (
    <TooltipProvider>
      <SiteLayout slots={SITE_LAYOUT_SLOTS}>{children}</SiteLayout>
    </TooltipProvider>
  );
}

// アプリのルートと同じく、共通レイアウトをルートのshellComponentに置き、経路の内容・存在しないページ・想定外のエラーの画面をその中に出すルーターを、メモリ上の履歴で作る
export function createPageRouter({ path, createRoutes }: PageRouterOptions) {
  const rootRoute = createRootRoute({
    shellComponent: PageShell,
    ...PAGE_ROUTER_ROOT_COMPONENTS,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([...createRoutes(rootRoute)]),
    history: createMemoryHistory({ initialEntries: [path] }),
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
