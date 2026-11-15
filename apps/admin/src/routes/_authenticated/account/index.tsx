import { createFileRoute } from '@tanstack/react-router';

import { ACCOUNT_PAGE_TITLE } from '../../../components/account/account-messages.ts';
import { AccountPage } from '../../../components/pages/account-page.tsx';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/account/')({
  head: () => buildAdminPageHead({ title: ACCOUNT_PAGE_TITLE }),
  component: AccountPage,
});
