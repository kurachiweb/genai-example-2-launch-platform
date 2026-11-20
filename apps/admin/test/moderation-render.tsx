import { type ReactNode, useRef } from 'react';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { DisplayPreferencesProvider } from '../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { AdminViewerProvider } from '../src/components/layout/admin-viewer-context.tsx';
import { ModerationDialogHost } from '../src/components/moderation/shared/moderation-dialog-host.tsx';
import { toAdminViewer } from '../src/graphql/admin-viewer.ts';
import type { AdminRole } from '../src/graphql/generated/graphql.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { MODERATION_DISPLAY } from './moderation-fixtures.ts';
import { renderInRouter } from './page-router.tsx';

// 行の措置の操作は一覧の単位の確認のダイアログから開くため、部品を一覧の代わりの領域と確認のダイアログの置き場所の中に置く
function ModerationPartFrame({ children }: { readonly children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <main ref={mainRef} tabIndex={-1} className="p-4">
      <ModerationDialogHost fallbackFocusRef={mainRef}>
        {children}
      </ModerationDialogHost>
    </main>
  );
}

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
        <ModerationPartFrame>{element}</ModerationPartFrame>
      </AdminViewerProvider>
    </DisplayPreferencesProvider>,
    { cachedViewer: adminWithRole(role) },
  );
}

// 確認のダイアログを開いている間は背後の一覧が支援技術から隠れるため、行が消えたことを隠れた要素も含めて確かめる
export const buttonBehindDialog = (name: string) =>
  page.getByRole('button', { name, exact: true, includeHidden: true });
