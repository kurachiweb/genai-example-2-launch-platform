import { createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AppDocument } from '../../lib/components/app-shell/app-document.tsx';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { SiteLayout } from '../components/layout/site-layout.tsx';
import { ErrorPage } from '../components/pages/error-page.tsx';
import { NotFoundPage } from '../components/pages/not-found-page.tsx';
import { SITE_LAYOUT_SLOTS } from '../composition/layout-slots.ts';
import { buildRootHead } from '../head/page-heads.ts';
import stylesheetHref from '../styles.css?url';

interface ClientDocumentProps {
  readonly children: ReactNode;
}

// ルートのerrorComponent・notFoundComponentはルートのcomponentを置き換えて描かれるため、共通レイアウトはそれらも包むshellComponentに置く
function ClientDocument({ children }: ClientDocumentProps) {
  return (
    <AppDocument>
      <SiteLayout slots={SITE_LAYOUT_SLOTS}>{children}</SiteLayout>
    </AppDocument>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: ({ context }) => context.runtime.get(),
  head: ({ loaderData }) =>
    buildRootHead({
      stylesheetHref,
      webAnalyticsToken: loaderData?.publicConfig.webAnalyticsToken,
    }),
  shellComponent: ClientDocument,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});
