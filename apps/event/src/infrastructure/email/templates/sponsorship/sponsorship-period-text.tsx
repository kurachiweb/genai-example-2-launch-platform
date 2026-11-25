import type { ReactNode } from 'react';

import {
  formatSponsorshipDate,
  formatSponsorshipEndDate,
} from './sponsorship-date-label.ts';

interface SponsorshipPeriodTextProps {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
}

export function SponsorshipPeriodText({
  startsOn,
  endsOn,
  days,
}: SponsorshipPeriodTextProps): ReactNode {
  return (
    <>
      <time dateTime={startsOn}>{formatSponsorshipDate(startsOn)}</time>〜
      <time dateTime={endsOn}>
        {formatSponsorshipEndDate(startsOn, endsOn)}
      </time>
      {`(UTC-08:00の日付)、${String(days)}日間`}
    </>
  );
}
