import { createFileRoute } from '@tanstack/react-router';

import { LOGIN_PAGE_TITLE } from '../../components/auth/account-messages.ts';
import { AuthPageLayout } from '../../../lib/components/auth/auth-page-layout.tsx';
import { LoginForm } from '../../components/auth/login-form.tsx';
import { redirectSignedInViewer } from '../../components/auth/redirect-signed-in-viewer.ts';
import {
  toLoginSearch,
  toSafeReturnPath,
} from '../../../lib/utilities/auth/return-path.ts';
import { buildSitePageHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/auth/login')({
  validateSearch: toLoginSearch,
  beforeLoad: redirectSignedInViewer,
  head: () =>
    buildSitePageHead({ title: LOGIN_PAGE_TITLE, canonicalUrl: '/auth/login' }),
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect } = Route.useSearch();
  return (
    <AuthPageLayout title={LOGIN_PAGE_TITLE}>
      <LoginForm returnTo={toSafeReturnPath(redirect)} />
    </AuthPageLayout>
  );
}
