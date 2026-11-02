import { createFileRoute } from '@tanstack/react-router';

import { REGISTER_PAGE_TITLE } from '../../components/auth/account-messages.ts';
import { AuthPageLayout } from '../../components/auth/auth-page-layout.tsx';
import { redirectSignedInViewer } from '../../components/auth/redirect-signed-in-viewer.ts';
import { RegisterForm } from '../../components/auth/register-form.tsx';
import { buildSitePageHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/auth/register')({
  beforeLoad: redirectSignedInViewer,
  head: () =>
    buildSitePageHead({
      title: REGISTER_PAGE_TITLE,
      canonicalUrl: '/auth/register',
    }),
  component: RegisterRoute,
});

function RegisterRoute() {
  return (
    <AuthPageLayout title={REGISTER_PAGE_TITLE}>
      <RegisterForm />
    </AuthPageLayout>
  );
}
