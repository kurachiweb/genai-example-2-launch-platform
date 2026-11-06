import {
  BillingAddressElement,
  CheckoutElementsProvider,
  PaymentElement,
  type StripeCheckoutElementsValue,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout';
import type { Stripe } from '@stripe/stripe-js';
import { LoaderCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { useTheme } from '../../../lib/components/theme/use-theme.ts';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { UnavailableNotice } from '../../../lib/components/state/unavailable-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { checkoutAppearanceOf } from './checkout-appearance.ts';
import {
  PAY_LABEL,
  PAY_PENDING_LABEL,
  PAYMENT_UNAVAILABLE_REASON,
} from './checkout-messages.ts';
import { loadStripeOnce } from './stripe-loader.ts';

export interface CheckoutPaymentFormProps {
  readonly publishableKey: string;
  readonly clientSecret: string;
  readonly consentGiven: boolean;
  // 同意の記録の成否。偽なら支払いを確定しない
  readonly onBeforeConfirm: () => Promise<boolean>;
  // 同意の記録の失敗の文言。確定の失敗と同じ位置に示す
  readonly consentFailure?: string | undefined;
}

type StripeLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly stripe: Stripe }
  | { readonly status: 'failed' };

const reportPaymentFailure = (error: unknown): void => {
  reportUnexpectedErrorInBrowser(error, 'render');
};

function PaymentUnavailable() {
  return <UnavailableNotice reason={PAYMENT_UNAVAILABLE_REASON} />;
}

interface ConfirmSectionProps {
  readonly checkout: StripeCheckoutElementsValue;
  readonly consentGiven: boolean;
  readonly onBeforeConfirm: () => Promise<boolean>;
  readonly consentFailure: string | undefined;
  readonly onUnexpectedFailure: (error: unknown) => void;
}

function ConfirmSection({
  checkout,
  consentGiven,
  onBeforeConfirm,
  consentFailure,
  onUnexpectedFailure,
}: ConfirmSectionProps) {
  const [pending, setPending] = useState(false);
  const [confirmFailure, setConfirmFailure] = useState<string>();
  const failure = consentFailure ?? confirmFailure;

  // aria-disabledは押下を止めないため、確定中の押下はここで無視する。成功するとStripeが決済後のランディングへ移すため、確定中の表示のままにする
  const handleConfirm = async (): Promise<void> => {
    if (pending) {
      return;
    }
    setConfirmFailure(undefined);
    setPending(true);
    try {
      if (!(await onBeforeConfirm())) {
        setPending(false);
        return;
      }
      const result = await checkout.confirm();
      if (result.type === 'error') {
        setConfirmFailure(result.error.message);
        setPending(false);
      }
    } catch (error: unknown) {
      onUnexpectedFailure(error);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PaymentElement />
      <BillingAddressElement />
      {failure === undefined ? null : (
        <FormMessage role="alert">{failure}</FormMessage>
      )}
      <Button
        type="button"
        size="lg"
        className="self-start"
        disabled={!pending && (!consentGiven || !checkout.canConfirm)}
        aria-busy={pending ? true : undefined}
        aria-disabled={pending ? true : undefined}
        onClick={() => {
          void handleConfirm();
        }}
      >
        {pending ? (
          <>
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            {PAY_PENDING_LABEL}
          </>
        ) : (
          PAY_LABEL
        )}
      </Button>
    </div>
  );
}

type CheckoutFieldsProps = Omit<ConfirmSectionProps, 'checkout'>;

function CheckoutFields({
  onUnexpectedFailure,
  ...props
}: CheckoutFieldsProps) {
  const state = useCheckoutElements();
  const errorMessage = state.type === 'error' ? state.error.message : undefined;

  useEffect(() => {
    if (errorMessage !== undefined) {
      onUnexpectedFailure(new Error(errorMessage));
    }
  }, [errorMessage, onUnexpectedFailure]);

  switch (state.type) {
    case 'loading':
      return <LoadingSkeleton />;
    case 'error':
      return null;
    case 'success':
      return (
        <ConfirmSection
          {...props}
          checkout={state.checkout}
          onUnexpectedFailure={onUnexpectedFailure}
        />
      );
  }
}

// Payment Elementと請求先住所の入力欄を置き、同意の記録が成功したときだけ支払いを確定する。Stripe.jsの読み込みと確定の想定外の失敗はエラートラッキングへ送り、入力欄の代わりに決済を利用できない旨を示す
export function CheckoutPaymentForm({
  publishableKey,
  clientSecret,
  consentGiven,
  onBeforeConfirm,
  consentFailure,
}: CheckoutPaymentFormProps) {
  const [loadState, setLoadState] = useState<StripeLoadState>({
    status: 'loading',
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const fail = (error: unknown): void => {
      if (active) {
        reportPaymentFailure(error);
        setLoadState({ status: 'failed' });
      }
    };
    loadStripeOnce(publishableKey).then((stripe) => {
      if (stripe === null) {
        fail(new Error('Stripe.jsの読み込みの結果が空でした。'));
        return;
      }
      if (active) {
        setLoadState({ status: 'ready', stripe });
      }
    }, fail);
    return () => {
      active = false;
    };
  }, [publishableKey]);

  // 入力欄はStripeのiframeの中に透過で描かれ文字を外観の色で塗るため、配色を切り替えたら外観を組み立て直す。決済セッションの文脈は外観の内容が変わった時だけ入力欄へ反映する
  const { theme } = useTheme();
  const options = useMemo(
    () =>
      loadState.status === 'ready'
        ? {
            clientSecret,
            elementsOptions: {
              appearance: checkoutAppearanceOf(document.documentElement, theme),
            },
            adaptivePricing: { allowed: false },
          }
        : undefined,
    [loadState.status, clientSecret, theme],
  );

  const handleUnexpectedFailure = useCallback((error: unknown): void => {
    reportPaymentFailure(error);
    setFailed(true);
  }, []);

  if (failed || loadState.status === 'failed') {
    return <PaymentUnavailable />;
  }
  if (loadState.status === 'loading' || options === undefined) {
    return <LoadingSkeleton />;
  }
  return (
    <CheckoutElementsProvider stripe={loadState.stripe} options={options}>
      <CheckoutFields
        consentGiven={consentGiven}
        onBeforeConfirm={onBeforeConfirm}
        consentFailure={consentFailure}
        onUnexpectedFailure={handleUnexpectedFailure}
      />
    </CheckoutElementsProvider>
  );
}
