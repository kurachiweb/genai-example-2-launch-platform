import { NOTIFICATION_MATCH_RESULT_KIND } from '../../../../../lib/core/email/kinds/notifications.ts';
import {
  COMBINED_UNSUBSCRIBE_LABELS,
  matchResultSubject,
} from '../../../../../lib/core/notifications/notice-copy.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { matchResultSentence } from './match-result-copy.ts';
import { MatchResultEmailBody } from './match-result-email-body.tsx';

export const MATCH_RESULT_TEMPLATE = defineEmailTemplate({
  kind: NOTIFICATION_MATCH_RESULT_KIND,
  subject: (input) =>
    matchResultSubject({
      own: input.ownProductName,
      opponent: input.opponentProductName,
      outcome: input.outcome,
      ownVotes: input.ownVotes,
      opponentVotes: input.opponentVotes,
      nextRoundName: input.next?.roundName ?? null,
    }),
  preview: matchResultSentence,
  greeting: (input) => input.nickname,
  action: (input) => input.action,
  unsubscribeLinks: (input) =>
    input.next === null
      ? [{ url: input.unsubscribeUrl }]
      : [
          {
            url: input.unsubscribeUrl,
            label: COMBINED_UNSUBSCRIBE_LABELS.match_result,
          },
          {
            url: input.next.unsubscribeUrl,
            label: COMBINED_UNSUBSCRIBE_LABELS.match_preview,
          },
        ],
  Body: MatchResultEmailBody,
});
