import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';

interface UtcDateTimeItemProps {
  readonly label: string;
  readonly at: string;
}

export function UtcDateTimeItem({
  label,
  at,
}: UtcDateTimeItemProps): ReactNode {
  const instant = new Date(at);
  return (
    <li>
      {`${label}: `}
      <time dateTime={instant.toISOString()}>
        {formatUtcDateTime(instant, { withYear: true })}
      </time>
    </li>
  );
}
