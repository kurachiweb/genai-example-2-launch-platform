import { createFileRoute } from '@tanstack/react-router';

import { AuthPageLayout } from '../../../../lib/components/auth/auth-page-layout.tsx';
import { EMAIL_CHANGE_PAGE_TITLE } from '../../../components/auth/admin-auth-messages.ts';
import { EmailChangeConfirmation } from '../../../components/auth/email-change-confirmation.tsx';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/auth/email-change/confirm')({
  head: () => buildAdminPageHead({ title: EMAIL_CHANGE_PAGE_TITLE }),
  component: EmailChangeConfirmRoute,
});

function EmailChangeConfirmRoute() {
  return (
    <AuthPageLayout title={EMAIL_CHANGE_PAGE_TITLE}>
      <EmailChangeConfirmation />
    </AuthPageLayout>
  );
}
