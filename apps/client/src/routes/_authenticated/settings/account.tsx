import { createFileRoute } from '@tanstack/react-router';

import { AccountSettingsPage } from '../../../components/settings/account-settings-page.tsx';
import { ACCOUNT_SETTINGS_PAGE_TITLE } from '../../../components/settings/settings-messages.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/settings/account')({
  head: () =>
    buildSitePageHead({ title: ACCOUNT_SETTINGS_PAGE_TITLE, noIndex: true }),
  component: AccountSettingsRoute,
});

function AccountSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  return <AccountSettingsPage viewer={viewer} />;
}
