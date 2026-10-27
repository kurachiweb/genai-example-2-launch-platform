import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';
import type { EmailDeliverySmokeInput } from '../../../../../lib/core/email/kinds/email-delivery-smoke.ts';

interface SmokeEmailBodyProps {
  readonly input: EmailDeliverySmokeInput;
}

export function SmokeEmailBody({ input }: SmokeEmailBodyProps): ReactNode {
  const requestedAt = new Date(input.requestedAt);
  return (
    <>
      <Text>メール送信の確認のために送信したメールです。</Text>
      <Text>
        受付日時は
        <time dateTime={requestedAt.toISOString()}>
          {formatUtcDateTime(requestedAt)}
        </time>
        です。
      </Text>
      <Text>このメールへの返信は不要です。</Text>
    </>
  );
}
