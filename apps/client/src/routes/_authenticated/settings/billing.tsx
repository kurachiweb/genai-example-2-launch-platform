import { createFileRoute } from '@tanstack/react-router';

import { PaymentHistoryList } from '../../../components/payments/payment-history-list.tsx';
import { PAYMENT_HISTORY_PAGE_TITLE } from '../../../components/payments/payment-history-messages.ts';
import { loadPaymentHistory } from '../../../graphql/payment-history.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/settings/billing')({
  loader: loadPaymentHistory,
  head: () =>
    buildSitePageHead({ title: PAYMENT_HISTORY_PAGE_TITLE, noIndex: true }),
  component: BillingSettingsRoute,
});

function BillingSettingsRoute() {
  const { viewer, runtime } = Route.useRouteContext();
  return (
    <PaymentHistoryList
      viewerId={viewer.id}
      environment={runtime.get().publicConfig.environment}
    />
  );
}
