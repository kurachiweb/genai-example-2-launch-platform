import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';

interface ChangedAtTextProps {
  readonly target: string;
  readonly at: string;
  readonly change: string;
}

export function ChangedAtText({
  target,
  at,
  change,
}: ChangedAtTextProps): ReactNode {
  const instant = new Date(at);
  return (
    <Text>
      {`アカウントの${target}が`}
      <time dateTime={instant.toISOString()}>{formatUtcDateTime(instant)}</time>
      {`に${change}。`}
    </Text>
  );
}
