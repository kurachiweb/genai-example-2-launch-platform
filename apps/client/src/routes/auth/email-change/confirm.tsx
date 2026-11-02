import { createFileRoute } from '@tanstack/react-router';

import { EMAIL_CHANGE_PAGE_TITLE } from '../../../components/auth/account-messages.ts';
import { AuthPageLayout } from '../../../components/auth/auth-page-layout.tsx';
import { EmailChangeConfirmation } from '../../../components/auth/email-change-confirmation.tsx';
import { buildSitePageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/auth/email-change/confirm')({
  head: () =>
    buildSitePageHead({ title: EMAIL_CHANGE_PAGE_TITLE, noIndex: true }),
  component: EmailChangeConfirmRoute,
});

function EmailChangeConfirmRoute() {
  return (
    <AuthPageLayout title={EMAIL_CHANGE_PAGE_TITLE}>
      <EmailChangeConfirmation />
    </AuthPageLayout>
  );
}
