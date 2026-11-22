import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';

interface ReportDatedTextProps {
  readonly label: string;
  readonly at: string;
}

export function ReportDatedText({
  label,
  at,
}: ReportDatedTextProps): ReactNode {
  const instant = new Date(at);
  return (
    <Text>
      {`${label}: `}
      <time dateTime={instant.toISOString()}>
        {formatUtcDateTime(instant, { withYear: true })}
      </time>
    </Text>
  );
}
