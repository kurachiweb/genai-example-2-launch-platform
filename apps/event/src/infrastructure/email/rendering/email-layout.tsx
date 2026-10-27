import { Body, Container, Head, Html, Preview } from '@react-email/components';
import type { ReactNode } from 'react';

import type { EmailCategory } from '../../../../lib/core/email/email-kind.ts';
import type { SenderInfo } from '../../../../lib/core/email/ports.ts';
import { EmailActionButton } from './email-action-button.tsx';
import { EmailGreeting } from './email-greeting.tsx';
import { EmailSenderInfo } from './email-sender-info.tsx';
import type { EmailAction } from './email-template.ts';
import { EmailUnsubscribeLink } from './email-unsubscribe-link.tsx';

interface EmailLayoutProps {
  readonly category: EmailCategory;
  readonly preview: string;
  readonly greeting: string | undefined;
  readonly action: EmailAction | undefined;
  readonly unsubscribeUrl: string | undefined;
  readonly senderInfo: SenderInfo | undefined;
  readonly children: ReactNode;
}

export function EmailLayout({
  category,
  preview,
  greeting,
  action,
  unsubscribeUrl,
  senderInfo,
  children,
}: EmailLayoutProps): ReactNode {
  // トランザクションメールは配信停止の対象外のため、URLが渡されても区画を置かない
  const shownUnsubscribeUrl =
    category === 'notification' ? unsubscribeUrl : undefined;
  return (
    <Html lang="ja">
      <Head />
      <Preview>{preview}</Preview>
      <Body>
        <Container>
          {greeting !== undefined && <EmailGreeting nickname={greeting} />}
          {children}
          {action !== undefined && <EmailActionButton action={action} />}
          {shownUnsubscribeUrl !== undefined && (
            <EmailUnsubscribeLink url={shownUnsubscribeUrl} />
          )}
          {senderInfo !== undefined && (
            <EmailSenderInfo senderInfo={senderInfo} />
          )}
        </Container>
      </Body>
    </Html>
  );
}
