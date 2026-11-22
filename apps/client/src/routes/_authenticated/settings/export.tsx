import { createFileRoute } from '@tanstack/react-router';

import { DATA_EXPORT_PAGE_TITLE } from '../../../components/data-export/data-export-messages.ts';
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
  return (
    <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
      {DATA_EXPORT_PAGE_TITLE}
    </h1>
  );
}
