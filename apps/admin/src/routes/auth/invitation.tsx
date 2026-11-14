import { createFileRoute } from '@tanstack/react-router';

import { AuthPageLayout } from '../../../lib/components/auth/auth-page-layout.tsx';
import { INVITATION_PAGE_TITLE } from '../../components/auth/admin-auth-messages.ts';
import { InvitationCompletion } from '../../components/auth/invitation-completion.tsx';
import { buildAdminPageHead } from '../../head/page-heads.ts';

// 完了の後もリカバリコードを示し続けるため、ログイン画面と違ってログイン中でもダッシュボードへ移さない
export const Route = createFileRoute('/auth/invitation')({
  head: () => buildAdminPageHead({ title: INVITATION_PAGE_TITLE }),
  component: InvitationRoute,
});

function InvitationRoute() {
  return (
    <AuthPageLayout title={INVITATION_PAGE_TITLE}>
      <InvitationCompletion />
    </AuthPageLayout>
  );
}
