import { createFileRoute } from '@tanstack/react-router';

import { AdminSettingsPage } from '../../../components/pages/admin-settings-page.tsx';
import { SETTINGS_TITLE } from '../../../components/settings/settings-messages.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/settings/')({
  head: () => buildAdminPageHead({ title: SETTINGS_TITLE }),
  component: AdminSettingsPage,
});
