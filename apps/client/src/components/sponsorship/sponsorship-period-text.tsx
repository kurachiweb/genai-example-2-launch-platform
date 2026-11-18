import type { BusinessDateString } from '../../../common-lib/sponsorship/sponsorship-period.ts';
import { countBusinessDaysInclusive } from '../../../common-lib/time/business-date-arithmetic.ts';
import { formatBusinessDateLabel } from '../../../common-lib/time/business-date-label.ts';
import { useCurrentYear } from '../product/use-current-year.ts';
import {
  SPONSORSHIP_PERIOD_SEPARATOR,
  sponsorshipDaysLabel,
} from './sponsorship-messages.ts';

export interface SponsorshipPeriodTextProps {
  readonly startsOn: BusinessDateString;
  readonly endsOn: BusinessDateString;
}

// 読み上げで終了日と日数の数字が続けて読まれないよう、間に読点を置く
const DAYS_SEPARATOR = '、';

// 掲載期間は時刻を持たない業務日付のため、日時の表示部品に渡さず暦日のまま示す
export function SponsorshipPeriodText({
  startsOn,
  endsOn,
}: SponsorshipPeriodTextProps) {
  const currentYear = useCurrentYear();
  return (
    <span>
      <time dateTime={startsOn}>
        {formatBusinessDateLabel(startsOn, currentYear)}
      </time>
      {SPONSORSHIP_PERIOD_SEPARATOR}
      <time dateTime={endsOn}>
        {formatBusinessDateLabel(endsOn, currentYear)}
      </time>
      {DAYS_SEPARATOR}
      <span>
        {sponsorshipDaysLabel(countBusinessDaysInclusive(startsOn, endsOn))}
      </span>
    </span>
  );
}
