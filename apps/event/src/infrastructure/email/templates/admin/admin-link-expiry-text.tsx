import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';

interface AdminLinkExpiryTextProps {
  readonly expiresAt: string;
  readonly afterExpiry: string;
}

export function AdminLinkExpiryText({
  expiresAt,
  afterExpiry,
}: AdminLinkExpiryTextProps): ReactNode {
  const instant = new Date(expiresAt);
  return (
    <Text>
      リンクの有効期限は
      <time dateTime={instant.toISOString()}>{formatUtcDateTime(instant)}</time>
      {`です。${afterExpiry}`}
    </Text>
  );
}
