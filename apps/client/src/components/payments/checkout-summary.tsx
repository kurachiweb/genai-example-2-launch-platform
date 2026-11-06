import { useId } from 'react';

import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import type { ClientCheckoutQuery } from '../../graphql/generated/graphql.ts';
import {
  CHECKOUT_CONDITIONS_TITLE,
  CHECKOUT_ITEM_LABEL,
  CHECKOUT_PAYMENT_METHOD_LABEL,
  CHECKOUT_PAYMENT_METHODS,
  CHECKOUT_PAYMENT_TIMING_LABEL,
  CHECKOUT_PRICE_LABEL,
  CHECKOUT_QUANTITY_LABEL,
  CHECKOUT_SERVICE_TIMING_LABEL,
  CHECKOUT_SUMMARY_TITLE,
  ONE_TIME_PAYMENT_TIMING,
  SUBSCRIPTION_PAYMENT_TIMING,
} from './checkout-messages.ts';

type Checkout = ClientCheckoutQuery['checkout'];

export interface CheckoutSummaryProps {
  readonly summary: Checkout['summary'];
  readonly total: Checkout['total'];
}

const TERM_CLASS_NAME = 'text-sm font-bold text-muted-foreground';

// 特定商取引法の最終確認画面の表示事項を、決済情報の入力欄より上に置く
export function CheckoutSummary({ summary, total }: CheckoutSummaryProps) {
  const headingId = useId();
  const conditionsId = useId();
  const items = [
    { term: CHECKOUT_ITEM_LABEL, value: summary.itemName },
    { term: CHECKOUT_QUANTITY_LABEL, value: summary.quantityLabel },
    { term: CHECKOUT_PRICE_LABEL, value: <MoneyText amount={total.amount} /> },
    { term: CHECKOUT_PAYMENT_METHOD_LABEL, value: CHECKOUT_PAYMENT_METHODS },
    {
      term: CHECKOUT_PAYMENT_TIMING_LABEL,
      value: summary.isSubscription
        ? SUBSCRIPTION_PAYMENT_TIMING
        : ONE_TIME_PAYMENT_TIMING,
    },
    { term: CHECKOUT_SERVICE_TIMING_LABEL, value: summary.serviceTiming },
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
            <dt className={TERM_CLASS_NAME}>{term}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.additionalNotes.length === 0 ? null : (
        <>
          <h3 id={conditionsId} className="text-base font-extrabold">
            {CHECKOUT_CONDITIONS_TITLE}
          </h3>
          <ul
            aria-labelledby={conditionsId}
            className="list-disc space-y-1 pl-5 text-sm"
          >
            {summary.additionalNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
