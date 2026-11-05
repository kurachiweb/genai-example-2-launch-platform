import { Heading, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { REFUND_POLICY_SUMMARY } from '../../../../../common-lib/payments/refund-policy-summary.ts';
import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';
import type { PurchaseConfirmationInput } from '../../../../../lib/core/email/kinds/payments.ts';
import { formatUsdAmount } from './format-usd-amount.ts';
import { UtcDateTimeItem } from './utc-date-time-item.tsx';

interface PurchaseConfirmationEmailBodyProps {
  readonly input: PurchaseConfirmationInput;
}

export function PurchaseConfirmationEmailBody({
  input,
}: PurchaseConfirmationEmailBodyProps): ReactNode {
  const consentedAt = new Date(input.consentedAt);
  const hasAdditionalNotes = input.additionalNotes.length > 0;
  return (
    <>
      <Text>
        ご購入ありがとうございます。お支払いを確認し、購入が確定しました。このメールは購入の控えです。大切に保管してください。
      </Text>
      <Heading as="h2">購入の内容</Heading>
      <ul>
        <li>{`購入: ${input.itemName}`}</li>
        <li>{`分量: ${input.quantityLabel}`}</li>
        <li>{`お支払い金額: ${formatUsdAmount(input.amount)}(税込)`}</li>
        <UtcDateTimeItem label="購入日時" at={input.purchasedAt} />
        <li>{`役務の提供時期: ${input.serviceTiming}`}</li>
      </ul>
      {hasAdditionalNotes && (
        <>
          <Heading as="h2">購入の条件</Heading>
          <ul>
            {input.additionalNotes.map((note, index) => (
              // 追加事項は並びが変わらない文の一覧で、同じ文が重なり得るため位置を鍵にする
              <li key={index}>{note}</li>
            ))}
          </ul>
        </>
      )}
      <Heading as="h2">役務の即時提供への同意</Heading>
      <Text>
        <time dateTime={consentedAt.toISOString()}>
          {formatUtcDateTime(consentedAt, { withYear: true })}
        </time>
        に、購入の画面で次の内容に同意いただきました。
      </Text>
      <Text>{`「${input.consentText}」`}</Text>
      <Heading as="h2">返金ポリシー</Heading>
      <Text>{REFUND_POLICY_SUMMARY}</Text>
      <Text>購入と返金の記録は、下のボタンから決済履歴で確認できます。</Text>
    </>
  );
}
