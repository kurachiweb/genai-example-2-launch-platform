import { RelativeTime } from '../../../lib/components/datetime/relative-time.tsx';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { toDateTimeValue } from '../../../lib/utilities/datetime/date-time-value.ts';
import { yearInTimeZone } from './year-in-time-zone.ts';
import { useCurrentYear } from './use-current-year.ts';

export interface RemainingDateTimeProps {
  readonly at: string;
}

// 基準時刻で決まる先の日時を、利用者のタイムゾーンの日時と残りの相対表現で示す。今年の日時は年を省く
export function RemainingDateTime({ at }: RemainingDateTimeProps) {
  const { timeZone } = useDisplayPreferences();
  const currentYear = useCurrentYear();
  const sameYear =
    yearInTimeZone(toDateTimeValue(at), timeZone) === currentYear;
  return (
    <RelativeTime
      target={at}
      kind="remaining"
      format={sameYear ? 'dateTime' : 'longDateTime'}
    />
  );
}
