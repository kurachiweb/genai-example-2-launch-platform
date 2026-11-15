import { createFileRoute } from '@tanstack/react-router';

import { AuthPageLayout } from '../../../../lib/components/auth/auth-page-layout.tsx';
import { PASSWORD_RESET_PAGE_TITLE } from '../../../components/auth/admin-auth-messages.ts';
import { PasswordResetRequestForm } from '../../../components/auth/password-reset-request-form.tsx';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/auth/password-reset/')({
  head: () => buildAdminPageHead({ title: PASSWORD_RESET_PAGE_TITLE }),
  component: PasswordResetRoute,
});

function PasswordResetRoute() {
  return (
    <AuthPageLayout title={PASSWORD_RESET_PAGE_TITLE}>
      <PasswordResetRequestForm />
    </AuthPageLayout>
  );
}
