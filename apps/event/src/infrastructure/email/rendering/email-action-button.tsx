import { Button, Section } from '@react-email/components';
import type { ReactNode } from 'react';

import type { EmailAction } from './email-template.ts';

interface EmailActionButtonProps {
  readonly action: EmailAction;
}

export function EmailActionButton({
  action,
}: EmailActionButtonProps): ReactNode {
  return (
    <Section>
      <Button href={action.url}>{action.label}</Button>
    </Section>
  );
}
