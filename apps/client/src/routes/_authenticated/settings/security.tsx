import { createFileRoute } from '@tanstack/react-router';

import { loadMySessions } from '../../../components/settings/my-sessions-query.ts';
import { SecuritySettingsPage } from '../../../components/settings/security-settings-page.tsx';
import { SECURITY_SETTINGS_PAGE_TITLE } from '../../../components/settings/settings-messages.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/settings/security')({
  loader: loadMySessions,
  head: () =>
    buildSitePageHead({ title: SECURITY_SETTINGS_PAGE_TITLE, noIndex: true }),
  component: SecuritySettingsRoute,
});

function SecuritySettingsRoute() {
  const { viewer } = Route.useRouteContext();
  return <SecuritySettingsPage viewer={viewer} />;
}
