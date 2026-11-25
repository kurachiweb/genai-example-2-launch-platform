import { Link, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { SponsorshipTerminationNoticeInput } from '../../../../../lib/core/email/kinds/sponsorship.ts';
import { SponsorshipDateText } from './sponsorship-date-text.tsx';
import {
  LIST_GUIDE_SENTENCE,
  REFUND_TIMING_SENTENCE,
  stoppedRefundLine,
  terminationNoticeLead,
  unexposedRefundLine,
} from './sponsorship-notice-copy.ts';
import { SponsorshipPeriodText } from './sponsorship-period-text.tsx';

interface SponsorshipTerminationNoticeEmailBodyProps {
  readonly input: SponsorshipTerminationNoticeInput;
}

export function SponsorshipTerminationNoticeEmailBody({
  input,
}: SponsorshipTerminationNoticeEmailBodyProps): ReactNode {
  const { terminationRefund, stopRefund } = input;
  const hasRefund = terminationRefund !== null || stopRefund !== null;
  return (
    <>
      <Text>{terminationNoticeLead(input)}</Text>
      <Text>
        {'掲載期間: '}
        <SponsorshipPeriodText
          startsOn={input.startsOn}
          endsOn={input.endsOn}
          days={input.days}
        />
      </Text>
      <Text>
        {'強制終了日: '}
        <SponsorshipDateText date={input.terminatedOn} />
      </Text>
      <Text>{`理由: ${input.reason}`}</Text>
      {hasRefund && (
        <>
          <Text>
            {`次の金額を、決済に使った支払い方法へ自動で返金します。${REFUND_TIMING_SENTENCE}`}
          </Text>
          <ul>
            {terminationRefund !== null && (
              <li>
                {unexposedRefundLine(
                  terminationRefund.days,
                  terminationRefund.amount,
                )}
              </li>
            )}
            {stopRefund !== null && (
              <li>{stoppedRefundLine(stopRefund.days, stopRefund.amount)}</li>
            )}
          </ul>
        </>
      )}
      <Text>返金の扱いは、法的通知の返金ポリシーをご覧ください。</Text>
      <Text>
        <Link href={input.legalUrl}>法的通知を見る</Link>
      </Text>
      <Text>{LIST_GUIDE_SENTENCE}</Text>
    </>
  );
}
