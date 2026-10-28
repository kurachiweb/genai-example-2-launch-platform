import { createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AppDocument } from '../../lib/components/app-shell/app-document.tsx';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { AdminLayout } from '../components/layout/admin-layout.tsx';
import { ErrorPage } from '../components/pages/error-page.tsx';
import { NotFoundPage } from '../components/pages/not-found-page.tsx';
import { ADMIN_LAYOUT_SLOTS } from '../composition/layout-slots.ts';
import { buildRootHead } from '../head/page-heads.ts';
import stylesheetHref from '../styles.css?url';

interface AdminDocumentProps {
  readonly children: ReactNode;
}

// ルートのerrorComponent・notFoundComponentはルートのcomponentを置き換えて描かれるため、基本レイアウトはそれらも包むshellComponentに置く
function AdminDocument({ children }: AdminDocumentProps) {
  return (
    <AppDocument>
      <AdminLayout slots={ADMIN_LAYOUT_SLOTS}>{children}</AdminLayout>
    </AppDocument>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => buildRootHead({ stylesheetHref }),
  shellComponent: AdminDocument,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});
