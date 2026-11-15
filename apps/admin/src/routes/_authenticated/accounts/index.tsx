import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_ACCOUNTS_TITLE } from '../../../components/admins/admin-accounts-messages.ts';
import { AdminsPage } from '../../../components/pages/admins-page.tsx';
import { loadAdminAccounts } from '../../../graphql/admin-accounts.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/accounts/')({
  loader: loadAdminAccounts,
  head: () => buildAdminPageHead({ title: ADMIN_ACCOUNTS_TITLE }),
  component: AdminsPage,
});
