import {
  PAYMENT_RECORD_KIND_LABELS,
  PAYMENT_RECORD_STATUS_LABELS,
} from '../../../common-lib/payments/payment-record-values.ts';
import { PURCHASE_KIND_LABELS } from '../../../common-lib/payments/purchase-kinds.ts';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import type { PaymentHistoryEntry } from '../../graphql/payment-history.ts';
import {
  PAYMENT_AMOUNT_LABEL,
  PAYMENT_OCCURRED_AT_LABEL,
  PAYMENT_QUANTITY_LABEL,
  PAYMENT_RECORD_KIND_LABEL,
  PAYMENT_STATUS_LABEL,
} from './payment-history-messages.ts';

export interface PaymentHistoryItemProps {
  readonly entry: PaymentHistoryEntry;
}

export function PaymentHistoryItem({ entry }: PaymentHistoryItemProps) {
  return (
    // 続きを読み込んだ後に、加えた最初の記録へフォーカスを移せるよう、プログラムからだけフォーカスできるようにする
    <li
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground"
    >
      <p className="font-bold">{PURCHASE_KIND_LABELS[entry.purpose]}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{PAYMENT_OCCURRED_AT_LABEL}</dt>
        <dd>
          <DateTime value={entry.occurredAt} format="longDateTime" />
        </dd>
        <dt className="text-muted-foreground">{PAYMENT_RECORD_KIND_LABEL}</dt>
        <dd>{PAYMENT_RECORD_KIND_LABELS[entry.kind]}</dd>
        {entry.quantity === null ? null : (
          <>
            <dt className="text-muted-foreground">{PAYMENT_QUANTITY_LABEL}</dt>
            <dd className="tabular-nums">{entry.quantity}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{PAYMENT_AMOUNT_LABEL}</dt>
        <dd className="font-bold tabular-nums">
          <MoneyText amount={entry.amount} signDisplay="exceptZero" />
        </dd>
        <dt className="text-muted-foreground">{PAYMENT_STATUS_LABEL}</dt>
        <dd>{PAYMENT_RECORD_STATUS_LABELS[entry.status]}</dd>
      </dl>
    </li>
  );
}
