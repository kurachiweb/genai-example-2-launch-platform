import {
  type DateTimeFormatName,
  formatDateTime,
} from '../../utilities/datetime/date-time-formats.ts';
import { toDateTimeValue } from '../../utilities/datetime/date-time-value.ts';
import { useDisplayPreferences } from './use-display-preferences.ts';

export interface DateTimeProps {
  readonly value: string | Date;
  readonly format: DateTimeFormatName;
}

export function DateTime({ value, format }: DateTimeProps) {
  const preferences = useDisplayPreferences();
  const date = toDateTimeValue(value);
  return (
    <time dateTime={date.toISOString()}>
      {formatDateTime(date, format, preferences)}
    </time>
  );
}
