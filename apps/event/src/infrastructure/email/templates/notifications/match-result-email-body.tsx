import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { MatchResultEmailInput } from '../../../../../lib/core/email/kinds/notifications.ts';
import { MatchSchedule } from './match-schedule.tsx';
import {
  lastUpvoteSentence,
  matchResultSentence,
  nextMatchSentence,
} from './match-result-copy.ts';
import { NoticeSettingsLink } from './notice-settings-link.tsx';
import { ResultSupplementBlock } from './result-supplement-block.tsx';

interface MatchResultEmailBodyProps {
  readonly input: MatchResultEmailInput;
}

export function MatchResultEmailBody({
  input,
}: MatchResultEmailBodyProps): ReactNode {
  const tieBreak = lastUpvoteSentence(input);
  const { next } = input;
  return (
    <>
      <Text>{matchResultSentence(input)}</Text>
      {tieBreak !== undefined && <Text>{tieBreak}</Text>}
      {next !== null && (
        <>
          <Text>{nextMatchSentence(next)}</Text>
          <MatchSchedule startsAt={next.startsAt} endsAt={next.endsAt} />
        </>
      )}
      {input.supplements.map((supplement, index) => (
        <ResultSupplementBlock
          key={`${String(index)}:${supplement.title}`}
          supplement={supplement}
        />
      ))}
      <NoticeSettingsLink url={input.settingsUrl} />
    </>
  );
}
