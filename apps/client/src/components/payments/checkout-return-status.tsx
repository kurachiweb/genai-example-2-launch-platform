import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useState } from 'react';

import { CHECKOUT_SESSION_ID_MESSAGES } from '../../../common-lib/payments/payment-input-rules.ts';
import { PAYMENTS_UNAVAILABLE_REASON } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { UnavailableNotice } from '../../../lib/components/state/unavailable-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  type ClientConfirmCheckoutReturnMutation,
  ClientConfirmCheckoutReturnDocument,
} from '../../graphql/generated/graphql.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { BillingHistoryLink } from './billing-history-link.tsx';
import {
  CHECKOUT_CLOSED_MESSAGE,
  CHECKOUT_EXPIRED_MESSAGE,
  CHECKOUT_ITEM_LABEL,
  CHECKOUT_NOT_FOUND_DESCRIPTION,
  CHECKOUT_NOT_FOUND_MESSAGE,
  CHECKOUT_PAID_AMOUNT_LABEL,
  CHECKOUT_PROCESSING_MESSAGE,
  CHECKOUT_QUANTITY_LABEL,
  CHECKOUT_REFUNDING_MESSAGE,
  CHECKOUT_RESTART_HREFS,
  CHECKOUT_RETURN_COMPLETED_MESSAGE,
  CHECKOUT_RETURN_CONFIRMING_MESSAGE,
  CHECKOUT_RETURN_DELAYED_MESSAGE,
  CHECKOUT_RETURN_INCOMPLETE_MESSAGE,
  CHECKOUT_RETURN_PAGE_TITLE,
  CHECKOUT_RETURN_PROCESSING_NOTE,
  CHECKOUT_SERVICE_TIMING_LABEL,
  CHECKOUT_SUMMARY_TITLE,
  PURCHASED_DESTINATIONS,
  refundReasonTextOf,
  RESTART_CHECKOUT_LABEL,
} from './checkout-messages.ts';
import { CheckoutPageFrame } from './checkout-page-frame.tsx';
import {
  CHECKOUT_RETURN_RECHECK_INTERVAL_MS,
  CHECKOUT_RETURN_RECHECK_LIMIT,
} from './checkout-return-rules.ts';
import { CHECKOUT_HEADING_ID } from './use-checkout-retry.ts';

export interface CheckoutReturnStatusProps {
  // 検索パラメータに無いか形式に合わなければundefined
  readonly sessionId: string | undefined;
}

type ReturnCheckout =
  ClientConfirmCheckoutReturnMutation['confirmCheckoutReturn']['checkout'];

type Confirmation =
  | { readonly status: 'confirming' }
  | {
      readonly status: 'confirmed';
      readonly checkout: ReturnCheckout;
      readonly requestId: number;
    }
  | { readonly status: 'failed'; readonly error: unknown };

// 確認の要求ごとに識別子を変え、確かめ直しの回数を数える
interface ConfirmRequest {
  readonly id: number;
  readonly recheck: number;
}

interface ReturnView {
  // 状態の領域で支援技術へ伝える文
  readonly messages: readonly string[];
  readonly actions?: ReactNode;
  readonly content?: ReactNode;
}

const CHECKOUT_NOT_FOUND = 'checkout_not_found';

const VALIDATION_ERROR = 'validation_error';

const SESSION_ID_FIELD = 'sessionId';

const isNotFound = (error: unknown): boolean =>
  error instanceof GraphQLClientError && error.code === CHECKOUT_NOT_FOUND;

const isInvalidSession = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === VALIDATION_ERROR &&
  (error.details ?? []).some(({ field }) => field === SESSION_ID_FIELD);

const INVALID_SESSION_VIEW: ReturnView = {
  messages: [
    CHECKOUT_SESSION_ID_MESSAGES.invalid,
    CHECKOUT_NOT_FOUND_DESCRIPTION,
  ],
  actions: <BillingHistoryLink />,
};

const NOT_FOUND_VIEW: ReturnView = {
  messages: [CHECKOUT_NOT_FOUND_MESSAGE, CHECKOUT_NOT_FOUND_DESCRIPTION],
  actions: <BillingHistoryLink />,
};

function PurchasedSummary({ checkout }: { readonly checkout: ReturnCheckout }) {
  const headingId = useId();
  const items = [
    { term: CHECKOUT_ITEM_LABEL, value: checkout.summary.itemName },
    { term: CHECKOUT_QUANTITY_LABEL, value: checkout.summary.quantityLabel },
    {
      term: CHECKOUT_PAID_AMOUNT_LABEL,
      value: <MoneyText amount={checkout.total.amount} />,
    },
    {
      term: CHECKOUT_SERVICE_TIMING_LABEL,
      value: checkout.summary.serviceTiming,
    },
  ];
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    >
      <h2 id={headingId} className="text-xl font-extrabold">
        {CHECKOUT_SUMMARY_TITLE}
      </h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
        {items.map(({ term, value }) => (
          <div key={term} className="contents">
            <dt className="text-sm font-bold text-muted-foreground">{term}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CompletedActions({ checkout }: { readonly checkout: ReturnCheckout }) {
  const destination = PURCHASED_DESTINATIONS[checkout.kind];
  return (
    <>
      {/* 購入した対象の画面は各購入種別の機能が作るため、型付きのLinkではなくパスで遷移する */}
      {destination === undefined ? null : (
        <Button asChild>
          <PathLink href={destination.href}>{destination.label}</PathLink>
        </Button>
      )}
      <BillingHistoryLink />
    </>
  );
}

function expiredViewOf(checkout: ReturnCheckout): ReturnView {
  return checkout.canRestart
    ? {
        messages: [CHECKOUT_EXPIRED_MESSAGE],
        actions: (
          <Button asChild>
            <PathLink href={CHECKOUT_RESTART_HREFS[checkout.kind]}>
              {RESTART_CHECKOUT_LABEL}
            </PathLink>
          </Button>
        ),
      }
    : { messages: [CHECKOUT_EXPIRED_MESSAGE, CHECKOUT_CLOSED_MESSAGE] };
}

function checkoutViewOf(
  checkout: ReturnCheckout,
  recheckExhausted: boolean,
): ReturnView {
  switch (checkout.status) {
    case 'COMPLETED':
      return {
        messages: [CHECKOUT_RETURN_COMPLETED_MESSAGE],
        actions: <CompletedActions checkout={checkout} />,
        content: <PurchasedSummary checkout={checkout} />,
      };
    case 'PROCESSING':
      return {
        messages: recheckExhausted
          ? [CHECKOUT_RETURN_DELAYED_MESSAGE]
          : [CHECKOUT_PROCESSING_MESSAGE, CHECKOUT_RETURN_PROCESSING_NOTE],
        actions: <BillingHistoryLink />,
      };
    case 'REFUNDING':
      return {
        messages: [
          CHECKOUT_REFUNDING_MESSAGE,
          ...(checkout.rejectionReason === null
            ? []
            : [refundReasonTextOf(checkout.rejectionReason)]),
        ],
        actions: <BillingHistoryLink />,
      };
    case 'EXPIRED':
      return expiredViewOf(checkout);
    case 'OPEN':
      return {
        messages: [CHECKOUT_RETURN_INCOMPLETE_MESSAGE],
        actions: (
          <Button asChild>
            <Link
              to="/checkout/$purchaseId"
              params={{ purchaseId: checkout.purchaseId }}
            >
              {RESTART_CHECKOUT_LABEL}
            </Link>
          </Button>
        ),
      };
    case 'UNAVAILABLE':
      return {
        messages: [],
        actions: <BillingHistoryLink />,
        content: <UnavailableNotice reason={PAYMENTS_UNAVAILABLE_REASON} />,
      };
  }
}

// 決済後のランディングへの到達そのものが確定の操作に当たり、確定は冪等なため、マウントの後に1回呼ぶ。処理中の間は一定の間隔で上限の回数まで呼び直し、アンマウントでタイマーを解除する
function useCheckoutReturnConfirmation(sessionId: string) {
  const { mutate } = useMutation(
    graphqlMutationOptions(ClientConfirmCheckoutReturnDocument),
  );
  const [request, setRequest] = useState<ConfirmRequest>({
    id: 0,
    recheck: 0,
  });
  const [confirmation, setConfirmation] = useState<Confirmation>({
    status: 'confirming',
  });

  useEffect(() => {
    mutate(
      { variables: { sessionId } },
      {
        onSuccess: (data) => {
          setConfirmation({
            status: 'confirmed',
            checkout: data.confirmCheckoutReturn.checkout,
            requestId: request.id,
          });
        },
        onError: (error) => {
          setConfirmation({ status: 'failed', error });
        },
      },
    );
  }, [mutate, sessionId, request]);

  const latest =
    confirmation.status === 'confirmed' &&
    confirmation.requestId === request.id &&
    confirmation.checkout.status === 'PROCESSING';
  const recheckExhausted =
    latest && request.recheck >= CHECKOUT_RETURN_RECHECK_LIMIT;
  const awaitingRecheck = latest && !recheckExhausted;

  useEffect(() => {
    if (!awaitingRecheck) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setRequest((current) => ({
        id: current.id + 1,
        recheck: current.recheck + 1,
      }));
    }, CHECKOUT_RETURN_RECHECK_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [awaitingRecheck]);

  const retry = (): void => {
    setConfirmation({ status: 'confirming' });
    setRequest((current) => ({ id: current.id + 1, recheck: 0 }));
  };

  return { confirmation, recheckExhausted, retry };
}

function ConfirmedReturn({ sessionId }: { readonly sessionId: string }) {
  const { confirmation, recheckExhausted, retry } =
    useCheckoutReturnConfirmation(sessionId);

  // 再試行のボタンは確認し直すと消えるため、押した時点で残り続けるページの見出しへフォーカスを移す
  const handleRetry = (): void => {
    document.getElementById(CHECKOUT_HEADING_ID)?.focus();
    retry();
  };

  const view = ((): ReturnView => {
    switch (confirmation.status) {
      case 'confirming':
        return { messages: [CHECKOUT_RETURN_CONFIRMING_MESSAGE] };
      case 'confirmed':
        return checkoutViewOf(confirmation.checkout, recheckExhausted);
      case 'failed':
        if (isInvalidSession(confirmation.error)) {
          return INVALID_SESSION_VIEW;
        }
        if (isNotFound(confirmation.error)) {
          return NOT_FOUND_VIEW;
        }
        return {
          messages: [],
          content: (
            <ErrorState
              message={errorMessageOf(
                confirmation.error,
                CLIENT_PROFILE.contactAvailable,
              )}
              onRetry={handleRetry}
              contactHref={CONTACT_HREF}
            />
          ),
        };
    }
  })();

  return <ReturnNotice view={view} />;
}

function ReturnNotice({ view }: { readonly view: ReturnView }) {
  return (
    <div className="flex flex-col gap-6">
      {/* 状態が変わるたびに支援技術へ伝えるよう、状態の領域は最初の表示から置き続け、中の文だけを入れ替える */}
      <div role="status" className="flex flex-col gap-2 text-lg font-bold">
        {view.messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
      {view.actions === undefined ? null : (
        <div className="flex flex-wrap gap-3">{view.actions}</div>
      )}
      {view.content}
    </div>
  );
}

// 決済後のランディングで、決済セッションの状態を確かめて結果を示す。他人・存在しない決済セッションは状態を明かさない
export function CheckoutReturnStatus({ sessionId }: CheckoutReturnStatusProps) {
  return (
    <CheckoutPageFrame title={CHECKOUT_RETURN_PAGE_TITLE}>
      {sessionId === undefined ? (
        <ReturnNotice view={INVALID_SESSION_VIEW} />
      ) : (
        <ConfirmedReturn key={sessionId} sessionId={sessionId} />
      )}
    </CheckoutPageFrame>
  );
}
