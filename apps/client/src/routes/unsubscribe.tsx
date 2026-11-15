import { createFileRoute } from '@tanstack/react-router';

import { AuthPageLayout } from '../../lib/components/auth/auth-page-layout.tsx';
import { UNSUBSCRIBE_PAGE_TITLE } from '../components/notifications/notification-messages.ts';
import { UnsubscribeConfirmation } from '../components/notifications/unsubscribe-confirmation.tsx';
import { buildSitePageHead } from '../head/page-heads.ts';

// メールのリンクからログインせずに開くページのため、認証の経路の下に置かない
export const Route = createFileRoute('/unsubscribe')({
  head: () =>
    buildSitePageHead({ title: UNSUBSCRIBE_PAGE_TITLE, noIndex: true }),
  component: UnsubscribeRoute,
});

function UnsubscribeRoute() {
  return (
    <AuthPageLayout title={UNSUBSCRIBE_PAGE_TITLE}>
      <UnsubscribeConfirmation />
    </AuthPageLayout>
  );
}
