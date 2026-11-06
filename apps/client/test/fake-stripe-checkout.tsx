import type {
  CheckoutElementsProvider,
  StripeCheckoutElementsValue,
  StripeUseCheckoutElementsResult,
} from '@stripe/react-stripe-js/checkout';
import type { StripeCheckoutConfirmResult } from '@stripe/stripe-js';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';

type ProviderProps = ComponentProps<typeof CheckoutElementsProvider>;

interface FakeStripeCheckoutRecord {
  readonly providers: Omit<ProviderProps, 'children'>[];
  result: StripeUseCheckoutElementsResult;
}

const record: FakeStripeCheckoutRecord = {
  providers: [],
  result: { type: 'loading' },
};

export const fakeConfirm =
  vi.fn<(...args: unknown[]) => Promise<StripeCheckoutConfirmResult>>();

export const FAKE_PAYMENT_ELEMENT_LABEL = '支払い方法の入力欄';

export const FAKE_BILLING_ADDRESS_LABEL = '請求先住所の入力欄';

export function resetFakeStripeCheckout(): void {
  record.providers.length = 0;
  record.result = { type: 'loading' };
  fakeConfirm.mockReset();
}

// 決済セッションの状態のうち、画面が読む確定の可否と確定の操作だけを持つ値にする
export function succeedFakeCheckout({
  canConfirm = true,
}: { readonly canConfirm?: boolean } = {}): void {
  record.result = {
    type: 'success',
    checkout: {
      canConfirm,
      confirm: fakeConfirm,
    } as unknown as StripeCheckoutElementsValue,
  };
}

export function failFakeCheckout(message: string): void {
  record.result = { type: 'error', error: { message } };
}

export function lastProviderProps(): Omit<ProviderProps, 'children'> {
  const props = record.providers.at(-1);
  if (props === undefined) {
    throw new Error('決済セッションの文脈の部品が描画されていません。');
  }
  return props;
}

function FakeCheckoutElementsProvider({ children, ...props }: ProviderProps) {
  record.providers.push(props);
  return <>{children}</>;
}

function FakePaymentElement() {
  return (
    <div role="group" aria-label={FAKE_PAYMENT_ELEMENT_LABEL}>
      <p>カード番号</p>
    </div>
  );
}

function FakeBillingAddressElement() {
  return (
    <div role="group" aria-label={FAKE_BILLING_ADDRESS_LABEL}>
      <p>国または地域</p>
    </div>
  );
}

const readFakeCheckoutElements = (): StripeUseCheckoutElementsResult =>
  record.result;

// @stripe/react-stripe-js/checkoutの代わりにvi.mockで返すモジュール。Stripe.jsとの通信やiframeを使わず、決済セッションの状態をテストから決める
export const fakeStripeCheckoutModule = Object.freeze({
  CheckoutElementsProvider: FakeCheckoutElementsProvider,
  useCheckoutElements: readFakeCheckoutElements,
  PaymentElement: FakePaymentElement,
  BillingAddressElement: FakeBillingAddressElement,
});
