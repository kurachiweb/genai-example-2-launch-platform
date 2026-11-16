import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { WeekEntryRefundEmailInput } from '../../../../../lib/core/email/kinds/tournament-week.ts';
import { LaunchDateText } from './launch-date-text.tsx';
import { weekEntryRefundLead } from './week-entry-refund-lead.ts';

const REASON_TEXTS: Readonly<
  Record<WeekEntryRefundEmailInput['reason'], string>
> = Object.freeze({
  entitlement_lost: '組み合わせ決定前にプロダクトが削除されたため',
  entitlement_suspended:
    '組み合わせ決定の時点でプロダクトが公開されていなかったため',
});

interface WeekEntryRefundEmailBodyProps {
  readonly input: WeekEntryRefundEmailInput;
}

export function WeekEntryRefundEmailBody({
  input,
}: WeekEntryRefundEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{weekEntryRefundLead(input)}</Text>
      <Text>
        対象のローンチ: <LaunchDateText date={input.launchDate} />
      </Text>
      <Text>{`返金の理由: ${REASON_TEXTS[input.reason]}`}</Text>
      <Text>
        お支払いいただいた参加費の全額を、お支払いに使った支払い方法へ返金します。お手元に反映されるまで数日かかる場合があります。
      </Text>
      <Text>返金の記録は、下のボタンから決済履歴で確認できます。</Text>
    </>
  );
}
