import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';

interface LinkExpiryTextProps {
  readonly expiresAt: string;
}

export function LinkExpiryText({ expiresAt }: LinkExpiryTextProps): ReactNode {
  const instant = new Date(expiresAt);
  return (
    <Text>
      リンクの有効期限は
      <time dateTime={instant.toISOString()}>{formatUtcDateTime(instant)}</time>
      です。期限を過ぎた場合は、もう一度手続きをしてください。
    </Text>
  );
}
