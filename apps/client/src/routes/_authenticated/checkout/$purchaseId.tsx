import {
  createFileRoute,
  type ErrorComponentProps,
} from '@tanstack/react-router';

import { CheckoutPage } from '../../../components/payments/checkout-page.tsx';
import { CheckoutStatusPage } from '../../../components/payments/checkout-status-page.tsx';
import { useCheckoutRetry } from '../../../components/payments/use-checkout-retry.ts';
import { loadCheckoutPage } from '../../../graphql/checkout.ts';
import { buildCheckoutHead } from '../../../head/page-heads.ts';

// 読み込み中の部品はルートの分割の対象外で主のバンドルに入るため、決済の部品(Stripe.js)を含む決済画面の部品を読み込まない部品にする
export const Route = createFileRoute('/_authenticated/checkout/$purchaseId')({
  loader: loadCheckoutPage,
  head: () => buildCheckoutHead(),
  pendingComponent: CheckoutPending,
  errorComponent: CheckoutError,
  notFoundComponent: CheckoutNotFound,
  component: CheckoutRoute,
});

function CheckoutRoute() {
  const { viewer, runtime } = Route.useRouteContext();
  const { purchaseId } = Route.useParams();
  return (
    <CheckoutPage
      viewer={viewer}
      purchaseId={purchaseId}
      publishableKey={runtime.get().publicConfig.stripePublishableKey}
    />
  );
}

function CheckoutPending() {
  return <CheckoutStatusPage state={{ status: 'pending' }} />;
}

function CheckoutError({ error }: ErrorComponentProps) {
  const retry = useCheckoutRetry();
  return (
    <CheckoutStatusPage state={{ status: 'error', error, onRetry: retry }} />
  );
}

function CheckoutNotFound() {
  return <CheckoutStatusPage state={{ status: 'not-found' }} />;
}
