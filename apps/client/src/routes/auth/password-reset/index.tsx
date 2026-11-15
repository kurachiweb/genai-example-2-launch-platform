import { createFileRoute } from '@tanstack/react-router';

import { PASSWORD_RESET_PAGE_TITLE } from '../../../components/auth/account-messages.ts';
import { AuthPageLayout } from '../../../../lib/components/auth/auth-page-layout.tsx';
import { PasswordResetRequestForm } from '../../../components/auth/password-reset-request-form.tsx';
import { buildSitePageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/auth/password-reset/')({
  head: () =>
    buildSitePageHead({
      title: PASSWORD_RESET_PAGE_TITLE,
      canonicalUrl: '/auth/password-reset',
    }),
  component: PasswordResetRoute,
});

function PasswordResetRoute() {
  return (
    <AuthPageLayout title={PASSWORD_RESET_PAGE_TITLE}>
      <PasswordResetRequestForm />
    </AuthPageLayout>
  );
}
