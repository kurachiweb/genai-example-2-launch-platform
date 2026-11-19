import { createFileRoute } from '@tanstack/react-router';

import { ApiKeySettingsPage } from '../../../components/public-api/api-key-settings-page.tsx';
import { API_KEY_SETTINGS_PAGE_TITLE } from '../../../components/public-api/api-key-settings-messages.ts';
import { loadMyApiKeys } from '../../../graphql/public-api.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

// 設定の経路のレイアウトがSettingsShellで包むため、ここでは包み直さない。本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/settings/api-keys')({
  loader: loadMyApiKeys,
  head: () =>
    buildSitePageHead({ title: API_KEY_SETTINGS_PAGE_TITLE, noIndex: true }),
  component: ApiKeysSettingsRoute,
});

function ApiKeysSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  return (
    <ApiKeySettingsPage
      viewerId={viewer.id}
      suspended={viewer.status === 'SUSPENDED'}
    />
  );
}
