import { createFileRoute } from '@tanstack/react-router';

import { CheckoutReturnStatus } from '../../../components/payments/checkout-return-status.tsx';
import { toCheckoutReturnSearch } from '../../../components/payments/checkout-return-rules.ts';
import { buildCheckoutReturnHead } from '../../../head/page-heads.ts';

// 決済セッションの確定は変更のため、先読みでも実行されるloaderでは呼ばず、部品のマウントの後に呼ぶ
export const Route = createFileRoute('/_authenticated/checkout/return')({
  validateSearch: toCheckoutReturnSearch,
  head: () => buildCheckoutReturnHead(),
  component: CheckoutReturnRoute,
});

function CheckoutReturnRoute() {
  const { session_id: sessionId } = Route.useSearch();
  return <CheckoutReturnStatus sessionId={sessionId} />;
}
