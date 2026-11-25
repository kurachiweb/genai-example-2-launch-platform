import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { SponsorshipEndNoticeInput } from '../../../../../lib/core/email/kinds/sponsorship.ts';
import {
  endNoticeLead,
  LIST_GUIDE_SENTENCE,
  REFUND_TIMING_SENTENCE,
  stoppedRefundLine,
} from './sponsorship-notice-copy.ts';
import { SponsorshipPeriodText } from './sponsorship-period-text.tsx';

interface SponsorshipEndNoticeEmailBodyProps {
  readonly input: SponsorshipEndNoticeInput;
}

export function SponsorshipEndNoticeEmailBody({
  input,
}: SponsorshipEndNoticeEmailBodyProps): ReactNode {
  const { stopRefund } = input;
  return (
    <>
      <Text>{endNoticeLead(input)}</Text>
      <Text>
        {'掲載期間: '}
        <SponsorshipPeriodText
          startsOn={input.startsOn}
          endsOn={input.endsOn}
          days={input.days}
        />
      </Text>
      {stopRefund !== null && (
        <>
          <Text>
            {`プロダクトの公開停止またはアカウントの停止により表示を止めた日数分の広告料金を、決済に使った支払い方法へ自動で返金します。${REFUND_TIMING_SENTENCE}`}
          </Text>
          <ul>
            <li>{stoppedRefundLine(stopRefund.days, stopRefund.amount)}</li>
          </ul>
        </>
      )}
      <Text>{LIST_GUIDE_SENTENCE}</Text>
    </>
  );
}
