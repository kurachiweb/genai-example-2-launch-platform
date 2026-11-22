import { type ReactNode, useEffect, useRef, useState } from 'react';
import { render } from 'vitest-browser-react';

import { DisplayPreferencesProvider } from '../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { AdminViewerProvider } from '../src/components/layout/admin-viewer-context.tsx';
import { ReportCaseDialogHost } from '../src/components/reporting/shared/report-case-dialog-host.tsx';
import { toAdminViewer } from '../src/graphql/admin-viewer.ts';
import type { AdminRole } from '../src/graphql/generated/graphql.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { MODERATION_DISPLAY } from './moderation-fixtures.ts';
import { renderInRouter } from './page-router.tsx';

export const REPORT_LIST_HEADING = '通報の案件';

// 案件の操作は一覧の単位の確認のダイアログから開くため、部品を一覧の見出しと確認のダイアログの置き場所の中に置く。「remove-host」で開いたまま画面を離れた時のように置き場所ごと外す
function ReportCasePartFrame({
  deferRefresh,
  control,
  children,
}: {
  readonly deferRefresh: boolean;
  readonly control: EventTarget;
  readonly children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    const remove = () => {
      setRemoved(true);
    };
    control.addEventListener('remove-host', remove);
    return () => {
      control.removeEventListener('remove-host', remove);
    };
  }, [control]);
  if (removed) {
    return null;
  }
  return (
    <main className="p-4">
      <h2 ref={headingRef} tabIndex={-1}>
        {REPORT_LIST_HEADING}
      </h2>
      <ReportCaseDialogHost
        fallbackFocusRef={headingRef}
        deferRefresh={deferRefresh}
      >
        {children}
      </ReportCaseDialogHost>
    </main>
  );
}

// 通報管理の画面の部品を、日時の表示設定・ログイン中の管理者・トーストを置いたルーターの中で描く
export async function renderReportCasePart(
  element: ReactNode,
  {
    role,
    deferRefresh = false,
    withHost = true,
    control = new EventTarget(),
  }: {
    readonly role: AdminRole;
    readonly deferRefresh?: boolean;
    readonly withHost?: boolean;
    readonly control?: EventTarget;
  },
) {
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  await render(<Toaster />);
  return renderInRouter(
    <DisplayPreferencesProvider initial={MODERATION_DISPLAY}>
      <AdminViewerProvider viewer={viewer}>
        {withHost ? (
          <ReportCasePartFrame deferRefresh={deferRefresh} control={control}>
            {element}
          </ReportCasePartFrame>
        ) : (
          <main className="p-4">{element}</main>
        )}
      </AdminViewerProvider>
    </DisplayPreferencesProvider>,
    { cachedViewer: adminWithRole(role) },
  );
}
