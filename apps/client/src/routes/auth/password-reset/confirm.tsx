import { createFileRoute } from '@tanstack/react-router';

import { PASSWORD_RESET_CONFIRM_PAGE_TITLE } from '../../../components/auth/account-messages.ts';
import { AuthPageLayout } from '../../../components/auth/auth-page-layout.tsx';
import { PasswordResetForm } from '../../../components/auth/password-reset-form.tsx';
import { buildSitePageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/auth/password-reset/confirm')({
  head: () =>
    buildSitePageHead({
      title: PASSWORD_RESET_CONFIRM_PAGE_TITLE,
      noIndex: true,
    }),
  component: PasswordResetConfirmRoute,
});

function PasswordResetConfirmRoute() {
  return (
    <AuthPageLayout title={PASSWORD_RESET_CONFIRM_PAGE_TITLE}>
      <PasswordResetForm />
    </AuthPageLayout>
  );
}
