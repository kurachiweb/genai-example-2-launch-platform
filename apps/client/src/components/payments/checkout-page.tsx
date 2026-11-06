import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';

import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
} from '../../../common-lib/legal/legal-documents.ts';
import { PAYMENTS_UNAVAILABLE_REASON } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import { REFUND_POLICY_SUMMARY } from '../../../common-lib/payments/refund-policy-summary.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { UnavailableNotice } from '../../../lib/components/state/unavailable-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { checkoutQueryOptions } from '../../graphql/checkout.ts';
import {
  type ClientCheckoutQuery,
  ClientRecordCheckoutConsentDocument,
} from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { BillingHistoryLink } from './billing-history-link.tsx';
import { CheckoutConsent } from './checkout-consent.tsx';
import { CheckoutDeadline } from './checkout-deadline.tsx';
import {
  CHECKOUT_CLOSED_MESSAGE,
  CHECKOUT_COMPLETED_MESSAGE,
  CHECKOUT_EXPIRED_MESSAGE,
  CHECKOUT_PAYMENT_TITLE,
  CHECKOUT_PROCESSING_MESSAGE,
  CHECKOUT_REFUNDING_MESSAGE,
  CHECKOUT_RESTART_HREFS,
  REFUND_POLICY_TITLE,
  refundReasonTextOf,
  RESTART_CHECKOUT_LABEL,
} from './checkout-messages.ts';
import { CheckoutPageFrame } from './checkout-page-frame.tsx';
import { CheckoutPaymentForm } from './checkout-payment-form.tsx';
import { CheckoutSummary } from './checkout-summary.tsx';

export interface CheckoutPageProps {
  readonly viewer: ClientViewer;
  readonly purchaseId: string;
  // 公開キーを置いていない環境ではundefined
  readonly publishableKey: string | undefined;
}

type Checkout = ClientCheckoutQuery['checkout'];

const CHECKOUT_NOT_OPEN = 'checkout_not_open';

const isCheckoutNotOpen = (error: unknown): boolean =>
  error instanceof GraphQLClientError && error.code === CHECKOUT_NOT_OPEN;

function StatusNotice({
  messages,
  action,
}: {
  readonly messages: readonly string[];
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
      {action}
    </div>
  );
}

function RefundPolicy() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-xl font-extrabold">
        {REFUND_POLICY_TITLE}
      </h2>
      <p className="text-sm leading-relaxed">{REFUND_POLICY_SUMMARY}</p>
      <p className="text-sm">
        <PathLink
          href={LEGAL_DOCUMENT_PATHS['legal-notice']}
          className="font-bold text-primary underline underline-offset-4"
        >
          {LEGAL_DOCUMENT_LABELS['legal-notice']}
        </PathLink>
      </p>
    </section>
  );
}

interface OpenCheckoutProps {
  readonly viewer: ClientViewer;
  readonly checkout: Checkout;
  readonly clientSecret: string;
  readonly publishableKey: string | undefined;
}

function OpenCheckout({
  viewer,
  checkout,
  clientSecret,
  publishableKey,
}: OpenCheckoutProps) {
  const paymentHeadingId = useId();
  const queryClient = useQueryClient();
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentFailure, setConsentFailure] = useState<string>();
  const recordConsent = useMutation(
    graphqlMutationOptions(ClientRecordCheckoutConsentDocument),
  );

  const recordConsentBeforeConfirm = async (): Promise<boolean> => {
    setConsentFailure(undefined);
    try {
      await recordConsent.mutateAsync({
        variables: { purchaseId: checkout.purchaseId },
      });
      return true;
    } catch (error: unknown) {
      setConsentFailure(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      // 別のタブでの支払いや失効で状態が変わっているため、画面を最新の状態の案内へ切り替える
      if (isCheckoutNotOpen(error)) {
        void queryClient.invalidateQueries({
          queryKey: checkoutQueryOptions(viewer, checkout.purchaseId).queryKey,
        });
      }
      return false;
    }
  };

  return (
    <>
      <CheckoutSummary summary={checkout.summary} total={checkout.total} />
      {checkout.acceptUntil === null ? null : (
        <CheckoutDeadline acceptUntil={checkout.acceptUntil} />
      )}
      <RefundPolicy />
      <section
        aria-labelledby={paymentHeadingId}
        className="flex flex-col gap-5"
      >
        <h2 id={paymentHeadingId} className="text-xl font-extrabold">
          {CHECKOUT_PAYMENT_TITLE}
        </h2>
        {/* 公開キーの無い環境は設定の結果で想定内のため、エラートラッキングへ送らない */}
        {publishableKey === undefined ? (
          <UnavailableNotice reason={PAYMENTS_UNAVAILABLE_REASON} />
        ) : (
          <>
            <CheckoutConsent
              checked={consentGiven}
              onCheckedChange={setConsentGiven}
            />
            <CheckoutPaymentForm
              publishableKey={publishableKey}
              clientSecret={clientSecret}
              consentGiven={consentGiven}
              onBeforeConfirm={recordConsentBeforeConfirm}
              consentFailure={consentFailure}
            />
          </>
        )}
      </section>
    </>
  );
}

function ExpiredNotice({ checkout }: { readonly checkout: Checkout }) {
  return checkout.canRestart ? (
    <StatusNotice
      messages={[CHECKOUT_EXPIRED_MESSAGE]}
      action={
        <Button asChild>
          <PathLink href={CHECKOUT_RESTART_HREFS[checkout.kind]}>
            {RESTART_CHECKOUT_LABEL}
          </PathLink>
        </Button>
      }
    />
  ) : (
    <StatusNotice
      messages={[CHECKOUT_EXPIRED_MESSAGE, CHECKOUT_CLOSED_MESSAGE]}
    />
  );
}

function CheckoutContent({
  viewer,
  purchaseId,
  publishableKey,
}: CheckoutPageProps) {
  const {
    data: { checkout },
  } = useSuspenseQuery(checkoutQueryOptions(viewer, purchaseId));

  switch (checkout.status) {
    case 'OPEN':
      // 支払える状態でもclientSecretが無ければ入力欄を出せないため、Stripeに到達できないときと同じ案内にする
      return checkout.clientSecret === null ? (
        <UnavailableNotice reason={PAYMENTS_UNAVAILABLE_REASON} />
      ) : (
        <OpenCheckout
          viewer={viewer}
          checkout={checkout}
          clientSecret={checkout.clientSecret}
          publishableKey={publishableKey}
        />
      );
    case 'PROCESSING':
      return (
        <StatusNotice
          messages={[CHECKOUT_PROCESSING_MESSAGE]}
          action={<BillingHistoryLink />}
        />
      );
    case 'COMPLETED':
      return (
        <StatusNotice
          messages={[CHECKOUT_COMPLETED_MESSAGE]}
          action={<BillingHistoryLink />}
        />
      );
    case 'REFUNDING':
      return (
        <StatusNotice
          messages={[
            CHECKOUT_REFUNDING_MESSAGE,
            ...(checkout.rejectionReason === null
              ? []
              : [refundReasonTextOf(checkout.rejectionReason)]),
          ]}
          action={<BillingHistoryLink />}
        />
      );
    case 'EXPIRED':
      return <ExpiredNotice checkout={checkout} />;
    case 'UNAVAILABLE':
      return <UnavailableNotice reason={PAYMENTS_UNAVAILABLE_REASON} />;
  }
}

// 購入の状態ごとに、最終確認画面の事項・同意・入力欄か、状態の案内を出し分ける
export function CheckoutPage(props: CheckoutPageProps) {
  return (
    <CheckoutPageFrame>
      <CheckoutContent {...props} />
    </CheckoutPageFrame>
  );
}
