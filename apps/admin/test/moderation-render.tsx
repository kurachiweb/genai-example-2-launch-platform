import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';

import { DisplayPreferencesProvider } from '../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { AdminViewerProvider } from '../src/components/layout/admin-viewer-context.tsx';
import { toAdminViewer } from '../src/graphql/admin-viewer.ts';
import type { AdminRole } from '../src/graphql/generated/graphql.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { MODERATION_DISPLAY } from './moderation-fixtures.ts';
import { renderInRouter } from './page-router.tsx';

// UGC管理の画面の部品を、日時の表示設定・ログイン中の管理者・トーストを置いたルーターの中で描く
export async function renderModerationPart(
  element: ReactNode,
  { role }: { readonly role: AdminRole },
) {
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  await render(<Toaster />);
  return renderInRouter(
    <DisplayPreferencesProvider initial={MODERATION_DISPLAY}>
      <AdminViewerProvider viewer={viewer}>
        <main className="p-4">{element}</main>
      </AdminViewerProvider>
    </DisplayPreferencesProvider>,
    { cachedViewer: adminWithRole(role) },
  );
}
