import { Body, Container, Head, Html, Preview } from '@react-email/components';
import type { ReactNode } from 'react';

import type { EmailCategory } from '../../../../lib/core/email/email-kind.ts';
import type { SenderInfo } from '../../../../lib/core/email/ports.ts';
import { EmailActionButton } from './email-action-button.tsx';
import { EmailGreeting } from './email-greeting.tsx';
import { EmailSenderInfo } from './email-sender-info.tsx';
import type {
  EmailAction,
  EmailUnsubscribeLinkList,
} from './email-template.ts';
import { EmailUnsubscribeLinks } from './email-unsubscribe-links.tsx';

interface EmailLayoutProps {
  readonly category: EmailCategory;
  readonly preview: string;
  readonly greeting: string | undefined;
  readonly action: EmailAction | undefined;
  readonly unsubscribeLinks: EmailUnsubscribeLinkList;
  readonly senderInfo: SenderInfo | undefined;
  readonly children: ReactNode;
}

export function EmailLayout({
  category,
  preview,
  greeting,
  action,
  unsubscribeLinks,
  senderInfo,
  children,
}: EmailLayoutProps): ReactNode {
  // トランザクションメールは配信停止の対象外のため、リンクが渡されても区画を置かない
  const shownUnsubscribeLinks =
    category === 'notification' ? unsubscribeLinks : [];
  return (
    <Html lang="ja">
      <Head />
      <Preview>{preview}</Preview>
      <Body>
        <Container>
          {greeting !== undefined && <EmailGreeting nickname={greeting} />}
          {children}
          {action !== undefined && <EmailActionButton action={action} />}
          {shownUnsubscribeLinks.length > 0 && (
            <EmailUnsubscribeLinks links={shownUnsubscribeLinks} />
          )}
          {senderInfo !== undefined && (
            <EmailSenderInfo senderInfo={senderInfo} />
          )}
        </Container>
      </Body>
    </Html>
  );
}
