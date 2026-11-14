import { Link, Text } from '@react-email/components';
import type { ReactNode } from 'react';

const SETTINGS_LINK_LABEL = '通知設定を変更する';

interface NoticeSettingsLinkProps {
  readonly url: string;
}

export function NoticeSettingsLink({
  url,
}: NoticeSettingsLinkProps): ReactNode {
  return (
    <Text>
      <Link href={url}>{SETTINGS_LINK_LABEL}</Link>
    </Text>
  );
}
