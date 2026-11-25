import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

import type { RouterContext } from '../../../lib/start/router-context.ts';
import { createPageRouterContext } from '../../../test/page-router.tsx';
import type { ClientSponsoredPlacementsQuery } from '../../graphql/generated/graphql.ts';
import { sponsoredPlacementsQueryOptions } from './use-sponsored-placements.ts';

// サーバーの描画と同じく、取得済みの広告をキャッシュに持つ状態で、復元の前のHTMLを作る
export const renderPlacementsOnServer = (
  ui: ReactElement,
  data: ClientSponsoredPlacementsQuery,
): Document => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    sponsoredPlacementsQueryOptions().queryKey,
    data,
  );
  const router = createRouter({
    routeTree: createRootRouteWithContext<RouterContext>()(),
    history: createMemoryHistory(),
    context,
  });
  const html = renderToString(
    <QueryClientProvider client={context.queryClient}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  );
  return new DOMParser().parseFromString(html, 'text/html');
};
