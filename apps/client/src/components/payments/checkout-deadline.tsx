import { RelativeTime } from '../../../lib/components/datetime/relative-time.tsx';
import {
  CHECKOUT_DEADLINE_DESCRIPTION,
  CHECKOUT_DEADLINE_LABEL,
} from './checkout-messages.ts';

export interface CheckoutDeadlineProps {
  readonly acceptUntil: string;
}

// 申込みの期間に定めのある購入の受付期限を、閲覧者のタイムゾーンの日時と残り時間で示す
export function CheckoutDeadline({ acceptUntil }: CheckoutDeadlineProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3">
      <p className="font-bold">
        {`${CHECKOUT_DEADLINE_LABEL}: `}
        <RelativeTime
          target={acceptUntil}
          kind="remaining"
          format="longDateTime"
        />
      </p>
      <p className="text-sm text-muted-foreground">
        {CHECKOUT_DEADLINE_DESCRIPTION}
      </p>
    </div>
  );
}
