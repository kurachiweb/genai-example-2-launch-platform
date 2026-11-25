import type { ReactNode } from 'react';

import { formatSponsorshipDate } from './sponsorship-date-label.ts';

interface SponsorshipDateTextProps {
  readonly date: string;
}

export function SponsorshipDateText({
  date,
}: SponsorshipDateTextProps): ReactNode {
  return (
    <>
      <time dateTime={date}>{formatSponsorshipDate(date)}</time>
      (UTC-08:00の日付)
    </>
  );
}
