import { createFileRoute } from '@tanstack/react-router';

import { VERIFY_EMAIL_PAGE_TITLE } from '../../components/auth/account-messages.ts';
import { AuthPageLayout } from '../../components/auth/auth-page-layout.tsx';
import { VerifyEmailConfirmation } from '../../components/auth/verify-email-confirmation.tsx';
import { buildSitePageHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/auth/verify-email')({
  head: () =>
    buildSitePageHead({ title: VERIFY_EMAIL_PAGE_TITLE, noIndex: true }),
  component: VerifyEmailRoute,
});

function VerifyEmailRoute() {
  return (
    <AuthPageLayout title={VERIFY_EMAIL_PAGE_TITLE}>
      <VerifyEmailConfirmation />
    </AuthPageLayout>
  );
}
