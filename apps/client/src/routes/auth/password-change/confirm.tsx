import { createFileRoute } from '@tanstack/react-router';

import { PASSWORD_CHANGE_PAGE_TITLE } from '../../../components/auth/account-messages.ts';
import { AuthPageLayout } from '../../../../lib/components/auth/auth-page-layout.tsx';
import { PasswordChangeConfirmation } from '../../../components/auth/password-change-confirmation.tsx';
import { buildSitePageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/auth/password-change/confirm')({
  head: () =>
    buildSitePageHead({ title: PASSWORD_CHANGE_PAGE_TITLE, noIndex: true }),
  component: PasswordChangeConfirmRoute,
});

function PasswordChangeConfirmRoute() {
  return (
    <AuthPageLayout title={PASSWORD_CHANGE_PAGE_TITLE}>
      <PasswordChangeConfirmation />
    </AuthPageLayout>
  );
}
