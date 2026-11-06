import { Heading, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { REFUND_REASON_TEXTS } from '../../../../../common-lib/payments/refund-reason-texts.ts';
import type { AutomaticRefundInput } from '../../../../../lib/core/email/kinds/payments.ts';
import { formatUsdAmount } from './format-usd-amount.ts';
import { UtcDateTimeItem } from './utc-date-time-item.tsx';

interface AutomaticRefundEmailBodyProps {
  readonly input: AutomaticRefundInput;
}

export function AutomaticRefundEmailBody({
  input,
}: AutomaticRefundEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        購入を確定できなかったため、お支払いいただいた金額の全額を返金しました。
      </Text>
      <Text>{`返金の理由: ${REFUND_REASON_TEXTS[input.reason]}`}</Text>
      <Heading as="h2">返金の内容</Heading>
      <ul>
        <li>{`購入: ${input.itemName}`}</li>
        <li>{`分量: ${input.quantityLabel}`}</li>
        <li>{`返金した金額: ${formatUsdAmount(input.amount)}`}</li>
        <UtcDateTimeItem label="お支払いの日時" at={input.purchasedAt} />
        <UtcDateTimeItem label="返金の日時" at={input.refundedAt} />
      </ul>
      <Text>
        返金は、お支払いに使った支払い方法へ戻ります。お手元に反映されるまでの日数は、カード会社などにより異なります。
      </Text>
      <Text>返金の記録は、下のボタンから決済履歴で確認できます。</Text>
    </>
  );
}
