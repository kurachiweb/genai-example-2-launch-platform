import { createFileRoute } from '@tanstack/react-router';

import { DASHBOARD_TITLE } from '../../components/dashboard/dashboard-messages.ts';
import { DashboardPage } from '../../components/pages/dashboard-page.tsx';
import { buildAdminPageHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/')({
  head: () => buildAdminPageHead({ title: DASHBOARD_TITLE }),
  component: DashboardPage,
});
