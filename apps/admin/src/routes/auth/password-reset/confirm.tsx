import { createFileRoute } from '@tanstack/react-router';

import { AuthPageLayout } from '../../../../lib/components/auth/auth-page-layout.tsx';
import { PASSWORD_RESET_CONFIRM_PAGE_TITLE } from '../../../components/auth/admin-auth-messages.ts';
import { NewPasswordForm } from '../../../components/auth/new-password-form.tsx';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/auth/password-reset/confirm')({
  head: () => buildAdminPageHead({ title: PASSWORD_RESET_CONFIRM_PAGE_TITLE }),
  component: PasswordResetConfirmRoute,
});

function PasswordResetConfirmRoute() {
  return (
    <AuthPageLayout title={PASSWORD_RESET_CONFIRM_PAGE_TITLE}>
      <NewPasswordForm />
    </AuthPageLayout>
  );
}
