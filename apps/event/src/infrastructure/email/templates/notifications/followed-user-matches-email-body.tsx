import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { FollowedUserMatchesEmailInput } from '../../../../../lib/core/email/kinds/notifications.ts';
import {
  FOLLOWED_MATCHES_LEAD_SENTENCE,
  followedMatchItemLine,
  omittedItemsLine,
} from './followed-user-matches-copy.ts';
import { NoticeSettingsLink } from './notice-settings-link.tsx';

interface FollowedUserMatchesEmailBodyProps {
  readonly input: FollowedUserMatchesEmailInput;
}

export function FollowedUserMatchesEmailBody({
  input,
}: FollowedUserMatchesEmailBodyProps): ReactNode {
  return (
    <>
      <Text>{FOLLOWED_MATCHES_LEAD_SENTENCE}</Text>
      <ul>
        {input.items.map((item, index) => {
          const line = followedMatchItemLine(item);
          return <li key={`${String(index)}:${line}`}>{line}</li>;
        })}
      </ul>
      {input.omittedCount > 0 && (
        <Text>{omittedItemsLine(input.omittedCount)}</Text>
      )}
      <NoticeSettingsLink url={input.settingsUrl} />
    </>
  );
}
