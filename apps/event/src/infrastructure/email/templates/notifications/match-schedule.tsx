import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';

interface MatchScheduleProps {
  readonly startsAt: string;
  readonly endsAt: string;
}

function UtcDateTimeLine({
  label,
  at,
}: {
  readonly label: string;
  readonly at: string;
}): ReactNode {
  const instant = new Date(at);
  return (
    <Text>
      {`${label}: `}
      <time dateTime={instant.toISOString()}>{formatUtcDateTime(instant)}</time>
    </Text>
  );
}

export function MatchSchedule({
  startsAt,
  endsAt,
}: MatchScheduleProps): ReactNode {
  return (
    <>
      <UtcDateTimeLine label="キックオフ" at={startsAt} />
      <UtcDateTimeLine label="フルタイム" at={endsAt} />
    </>
  );
}
