import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { MatchPreviewEmailInput } from '../../../../../lib/core/email/kinds/notifications.ts';
import { MatchSchedule } from './match-schedule.tsx';
import { NoticeSettingsLink } from './notice-settings-link.tsx';

interface MatchPreviewEmailBodyProps {
  readonly input: MatchPreviewEmailInput;
}

export function MatchPreviewEmailBody({
  input,
}: MatchPreviewEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        {`明日、${input.ownProductName}が${input.opponentProductName}と対戦します(${input.matchLabel})。`}
      </Text>
      <MatchSchedule startsAt={input.startsAt} endsAt={input.endsAt} />
      <NoticeSettingsLink url={input.settingsUrl} />
    </>
  );
}
