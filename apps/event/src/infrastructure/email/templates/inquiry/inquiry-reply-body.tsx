import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { formatUtcDateTime } from '../../../../../lib/core/email/format-utc-date-time.ts';
import type { InquiryReplyNotificationInput } from '../../../../../lib/core/email/kinds/inquiry.ts';

interface InquiryReplyBodyProps {
  readonly input: InquiryReplyNotificationInput;
}

export function InquiryReplyBody({ input }: InquiryReplyBodyProps): ReactNode {
  const repliedAt = new Date(input.repliedAt);
  return (
    <>
      <Text>
        <time dateTime={repliedAt.toISOString()}>
          {formatUtcDateTime(repliedAt)}
        </time>
        に、お問い合わせへの返信がありました。
      </Text>
      <Text>
        下のボタンからチャットページを開き、返信の内容を確認してください。
      </Text>
    </>
  );
}
