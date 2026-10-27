import { Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { SenderInfo } from '../../../../lib/core/email/ports.ts';

interface EmailSenderInfoProps {
  readonly senderInfo: SenderInfo;
}

export function EmailSenderInfo({
  senderInfo,
}: EmailSenderInfoProps): ReactNode {
  return (
    <Section>
      <Text>{senderInfo.businessName}</Text>
      <Text>{senderInfo.contactEmail}</Text>
      <Text>{senderInfo.postalAddress}</Text>
    </Section>
  );
}
