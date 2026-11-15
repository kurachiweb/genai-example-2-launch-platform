import { formatBusinessDateLabel } from '../../../common-lib/time/business-date-label.ts';
import { useCurrentYear } from './use-current-year.ts';

export interface LaunchDateTextProps {
  // 業務日付(YYYY-MM-DD)
  readonly date: string;
}

export function LaunchDateText({ date }: LaunchDateTextProps) {
  const currentYear = useCurrentYear();
  return (
    <time dateTime={date}>{formatBusinessDateLabel(date, currentYear)}</time>
  );
}
