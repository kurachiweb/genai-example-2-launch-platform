import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { FollowedUserAwardEmailInput } from '../../../../../lib/core/email/kinds/notifications.ts';
import { awardSentence } from './followed-user-award-copy.ts';
import { NoticeSettingsLink } from './notice-settings-link.tsx';

interface FollowedUserAwardEmailBodyProps {
  readonly input: FollowedUserAwardEmailInput;
}

export function FollowedUserAwardEmailBody({
  input,
}: FollowedUserAwardEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{awardSentence(input)}</Text>
      <NoticeSettingsLink url={input.settingsUrl} />
    </>
  );
}
