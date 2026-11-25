import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { SponsorshipStartNoticeInput } from '../../../../../lib/core/email/kinds/sponsorship.ts';
import {
  LIST_GUIDE_SENTENCE,
  startNoticeLead,
} from './sponsorship-notice-copy.ts';
import { SponsorshipPeriodText } from './sponsorship-period-text.tsx';

interface SponsorshipStartNoticeEmailBodyProps {
  readonly input: SponsorshipStartNoticeInput;
}

export function SponsorshipStartNoticeEmailBody({
  input,
}: SponsorshipStartNoticeEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{startNoticeLead(input)}</Text>
      <Text>
        {'掲載期間: '}
        <SponsorshipPeriodText
          startsOn={input.startsOn}
          endsOn={input.endsOn}
          days={input.days}
        />
      </Text>
      <Text>{LIST_GUIDE_SENTENCE}</Text>
    </>
  );
}
