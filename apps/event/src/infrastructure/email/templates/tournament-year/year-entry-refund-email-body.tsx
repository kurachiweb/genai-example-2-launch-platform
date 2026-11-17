import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { YearEntryRefundEmailInput } from '../../../../../lib/core/email/kinds/tournament-year.ts';
import { yearEntryRefundLead } from './year-entry-refund-lead.ts';

const REASON_TEXTS: Readonly<
  Record<YearEntryRefundEmailInput['reason'], string>
> = Object.freeze({
  entitlement_lost: '組み合わせ決定前にプロダクトが削除されたため',
  entitlement_suspended:
    '組み合わせ決定の時点でプロダクトが公開されていなかったため',
  capacity_exceeded:
    '参加数が上限の64を超え、Week優勝の日時が古い順に参加の対象外となったため',
});

interface YearEntryRefundEmailBodyProps {
  readonly input: YearEntryRefundEmailInput;
}

export function YearEntryRefundEmailBody({
  input,
}: YearEntryRefundEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{yearEntryRefundLead(input)}</Text>
      <Text>{`対象のProduct of the Week: ${input.weekLabel}`}</Text>
      <Text>{`返金の理由: ${REASON_TEXTS[input.reason]}`}</Text>
      <Text>
        お支払いいただいた参加費の全額を、お支払いに使った支払い方法へ返金します。お手元に反映されるまで数日かかる場合があります。
      </Text>
      <Text>返金の記録は、下のボタンから決済履歴で確認できます。</Text>
    </>
  );
}
