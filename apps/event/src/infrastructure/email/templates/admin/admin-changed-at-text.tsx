import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';

interface AdminChangedAtTextProps {
  readonly target: string;
  readonly at: string;
  readonly change: string;
}

export function AdminChangedAtText({
  target,
  at,
  change,
}: AdminChangedAtTextProps): ReactNode {
  const instant = new Date(at);
  return (
    <Text>
      {`管理者アカウントの${target}が`}
      <time dateTime={instant.toISOString()}>{formatUtcDateTime(instant)}</time>
      {`に${change}。`}
    </Text>
  );
}
