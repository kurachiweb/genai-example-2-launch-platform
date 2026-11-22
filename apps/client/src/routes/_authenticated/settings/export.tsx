import { createFileRoute } from '@tanstack/react-router';
import { useId, useRef } from 'react';

import { DATA_EXPORT_PAGE_TITLE } from '../../../components/data-export/data-export-messages.ts';
import { DataExportPanel } from '../../../components/data-export/data-export-panel.tsx';
import { loadMyDataExports } from '../../../graphql/data-export.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

// 設定の経路のレイアウトがSettingsShellで包むため、ここでは包み直さない。本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/settings/export')({
  loader: loadMyDataExports,
  head: () =>
    buildSitePageHead({ title: DATA_EXPORT_PAGE_TITLE, noIndex: true }),
  component: DataExportSettingsRoute,
});

function DataExportSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {DATA_EXPORT_PAGE_TITLE}
      </h1>
      <DataExportPanel
        viewerId={viewer.id}
        emailVerified={viewer.emailVerified}
        labelledBy={headingId}
        retryFocusRef={headingRef}
      />
    </div>
  );
}
