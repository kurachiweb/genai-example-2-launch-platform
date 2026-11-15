import { createFileRoute } from '@tanstack/react-router';

import { AuthPageLayout } from '../../../lib/components/auth/auth-page-layout.tsx';
import {
  toLoginSearch,
  toSafeReturnPath,
} from '../../../lib/utilities/auth/return-path.ts';
import { LOGIN_PAGE_TITLE } from '../../components/auth/admin-auth-messages.ts';
import { LoginForm } from '../../components/auth/login-form.tsx';
import { redirectSignedInAdmin } from '../../components/auth/redirect-signed-in-admin.ts';
import { buildAdminPageHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/auth/login')({
  validateSearch: toLoginSearch,
  beforeLoad: redirectSignedInAdmin,
  head: () => buildAdminPageHead({ title: LOGIN_PAGE_TITLE }),
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
