import { CopyIcon } from 'lucide-react';
import { type ReactNode, type Ref, useId } from 'react';

import { formatBusinessDateWithWeekdayLabel } from '../../../common-lib/time/business-date-label.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { writeToClipboard } from '../../../lib/utilities/clipboard/write-to-clipboard.ts';
import type { AdminSponsorshipTerminationResult } from '../../graphql/admin-sponsorships.ts';
import type { SponsorshipRefundStatus } from '../../graphql/generated/graphql.ts';
import {
  COPY_PURCHASE_ID_LABEL,
  PURCHASE_ID_COPIED,
  PURCHASE_ID_COPY_FAILED,
  REFUND_RESULT_MESSAGES,
  REMAINING_FULL_REFUND_LABEL,
  TERMINATION_RESULT_LABELS,
  terminationDaysLabel,
  terminationResultTitleOf,
} from './termination-messages.ts';

interface RefundMoney {
  readonly amount: number;
}

interface RefundAmountProps {
  readonly amount: RefundMoney;
  readonly status: SponsorshipRefundStatus | null;
  // 残りの全額で依頼したとき・依頼しなかったときはnull
  readonly requested: RefundMoney | null;
}

// 返金の金額に、依頼した返金額と依頼の結果を添える。返金額が0・返金不要(状態がnull)の返金は結果を示さない
function RefundAmount({ amount, status, requested }: RefundAmountProps) {
  return (
    <>
      <MoneyText amount={amount.amount} />
      {status === null ? null : (
        <div className="mt-1 flex flex-col gap-1 text-sm">
          {status === 'REQUESTED' ? (
            <dl>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">
                  {TERMINATION_RESULT_LABELS.requested}
                </dt>
                <dd className="tabular-nums">
                  {requested === null ? (
                    REMAINING_FULL_REFUND_LABEL
                  ) : (
                    <MoneyText amount={requested.amount} />
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
          <p className={status === 'REJECTED' ? 'text-destructive' : undefined}>
            {REFUND_RESULT_MESSAGES[status]}
          </p>
        </div>
      )}
    </>
  );
}

interface ResultItemProps {
  readonly label: string;
  readonly children: ReactNode;
}

function ResultItem({ label, children }: ResultItemProps) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export interface TerminationResultNoticeProps {
  readonly result: AdminSponsorshipTerminationResult;
  // 確定の後にフォーカスを移す見出し
  readonly headingRef?: Ref<HTMLHeadingElement>;
}

// 強制終了の確定の結果と、Stripeのダッシュボードで決済を探すための購入IDを示す
export function TerminationResultNotice({
  result,
  headingRef,
}: TerminationResultNoticeProps) {
  const headingId = useId();
  const showsStopRefund =
    result.stoppedDays > 0 || result.stopRefundStatus !== null;

  const copyPurchaseId = async (): Promise<void> => {
    if (await writeToClipboard(result.purchaseId)) {
      notify.success(PURCHASE_ID_COPIED);
    } else {
      notify.error(PURCHASE_ID_COPY_FAILED);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold wrap-anywhere"
      >
        {terminationResultTitleOf(result.id)}
      </h2>
      <dl className="flex flex-col gap-3 text-sm">
        <ResultItem label={TERMINATION_RESULT_LABELS.terminatedOn}>
          <time dateTime={result.terminatedOn}>
            {formatBusinessDateWithWeekdayLabel(result.terminatedOn)}
          </time>
        </ResultItem>
        <ResultItem label={TERMINATION_RESULT_LABELS.unexposedDays}>
          {terminationDaysLabel(result.unexposedDays)}
        </ResultItem>
        <ResultItem label={TERMINATION_RESULT_LABELS.refundEstimate}>
          <RefundAmount
            amount={result.refundEstimate}
            status={result.terminationRefundStatus ?? null}
            requested={result.terminationRefundRequested ?? null}
          />
        </ResultItem>
        {showsStopRefund ? (
          <ResultItem label={TERMINATION_RESULT_LABELS.stopRefundAmount}>
            <RefundAmount
              amount={result.stopRefundAmount}
              status={result.stopRefundStatus ?? null}
              requested={result.stopRefundRequested ?? null}
            />
          </ResultItem>
        ) : null}
        <ResultItem label={TERMINATION_RESULT_LABELS.purchaseId}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span translate="no" className="font-mono text-xs break-all">
              {result.purchaseId}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void copyPurchaseId();
              }}
            >
              <CopyIcon aria-hidden="true" />
              {COPY_PURCHASE_ID_LABEL}
            </Button>
          </div>
        </ResultItem>
      </dl>
    </section>
  );
}
