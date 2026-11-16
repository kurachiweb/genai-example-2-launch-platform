import type { DateTimeFormatName } from '../../utilities/datetime/date-time-formats.ts';
import { toDateTimeValue } from '../../utilities/datetime/date-time-value.ts';
import {
  formatElapsed,
  formatRemaining,
} from '../../utilities/datetime/relative-time.ts';
import { DateTime } from './date-time.tsx';
import { useNow } from './use-now.ts';

export interface RelativeTimeProps {
  readonly target: string | Date;
  readonly kind: 'remaining' | 'elapsed';
  readonly format: DateTimeFormatName;
}

const relativeTextOf = (
  kind: RelativeTimeProps['kind'],
  target: Date,
  now: Date,
): string | null =>
  kind === 'remaining'
    ? formatRemaining(target, now)
    : formatElapsed(target, now);

// 相対表現はハイドレーションの後にだけ出す
export function RelativeTime({ target, kind, format }: RelativeTimeProps) {
  const now = useNow();
  const date = toDateTimeValue(target);
  const relative =
    now === null ? null : relativeTextOf(kind, date, new Date(now));
  return (
    <>
      <DateTime value={date} format={format} />
      {relative !== null && <span className="ml-1">({relative})</span>}
    </>
  );
}
