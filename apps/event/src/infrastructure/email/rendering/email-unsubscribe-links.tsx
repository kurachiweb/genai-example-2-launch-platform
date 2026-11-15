import { Link, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { EmailUnsubscribeLink } from './email-template.ts';

const SINGLE_LINK_LABEL = 'この通知を配信停止';

interface EmailUnsubscribeLinksProps {
  readonly links: readonly EmailUnsubscribeLink[];
}

function labelOf(
  link: EmailUnsubscribeLink,
  links: readonly EmailUnsubscribeLink[],
): string {
  if (link.label !== undefined) {
    return link.label;
  }
  // 型の検査を経ずに渡された値でも、どの通知の配信停止か分からないリンクを並べない
  if (links.length > 1) {
    throw new Error(
      '配信停止のリンクが複数あるときは、すべてのリンクにラベルが必要です',
    );
  }
  return SINGLE_LINK_LABEL;
}

export function EmailUnsubscribeLinks({
  links,
}: EmailUnsubscribeLinksProps): ReactNode {
  return (
    <Section>
      {links.map((link, index) => (
        <Text key={`${String(index)}:${link.url}`}>
          <Link href={link.url}>{labelOf(link, links)}</Link>
        </Text>
      ))}
    </Section>
  );
}
