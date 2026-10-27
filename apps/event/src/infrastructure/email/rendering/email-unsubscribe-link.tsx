import { Link, Section } from '@react-email/components';
import type { ReactNode } from 'react';

interface EmailUnsubscribeLinkProps {
  readonly url: string;
}

export function EmailUnsubscribeLink({
  url,
}: EmailUnsubscribeLinkProps): ReactNode {
  return (
    <Section>
      <Link href={url}>この種類の通知メールの配信停止</Link>
    </Section>
  );
}
