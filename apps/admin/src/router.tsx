import { createRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { Provider as JotaiProvider } from 'jotai/react';

import {
  reportRenderError,
  reportUnexpectedError,
} from '../lib/start/observability/report-error.ts';
import { installRouteErrorReporting } from '../lib/start/observability/route-error-reporting.ts';
import {
  readInitialRuntime,
  readRequestNonce,
} from '../lib/start/request-context.ts';
import {
  createRouterContext,
  dehydrateAppRuntime,
  hydrateAppRuntime,
} from '../lib/start/router-context.ts';
import { routeTree } from './routeTree.gen.ts';

// QueryClientとJotaiのストアは要求をまたいで共有しないよう、ルーターを作るたびに作る
export function getRouter() {
  const context = createRouterContext(readInitialRuntime());
  const router = createRouter({
    routeTree,
    context,
    ssr: { nonce: readRequestNonce() },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultOnCatch: (error) => {
      reportRenderError(router, error);
    },
    Wrap: ({ children }) => (
      <JotaiProvider store={context.jotaiStore}>{children}</JotaiProvider>
    ),
    dehydrate: () => dehydrateAppRuntime(context),
    hydrate: (dehydrated) => {
      hydrateAppRuntime(context, dehydrated);
    },
  });
  installRouteErrorReporting(Object.values(router.routesById), (error) => {
    reportUnexpectedError(error, 'loader');
  });
  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });
  return router;
}
