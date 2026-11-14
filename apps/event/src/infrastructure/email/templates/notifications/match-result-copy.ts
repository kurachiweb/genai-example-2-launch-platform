import type { MatchResultEmailInput } from '../../../../../lib/core/email/kinds/notifications.ts';
import { matchScore } from '../../../../../lib/core/notifications/notice-copy.ts';

type NextMatch = NonNullable<MatchResultEmailInput['next']>;

export function matchResultSentence(input: MatchResultEmailInput): string {
  const {
    ownProductName: own,
    opponentProductName: opponent,
    matchLabel,
  } = input;
  const score = matchScore(input.ownVotes, input.opponentVotes);
  switch (input.outcome) {
    case 'won':
      return `${own}は${score}で${opponent}に勝利しました(${matchLabel})。`;
    case 'lost':
      return `${own}は${score}で${opponent}に敗れました(${matchLabel})。`;
    case 'no_votes':
      return `Upvoteが無かったため、両者敗北(0対0)となりました(${matchLabel})。`;
    case 'bye':
      return `対戦相手がいないため不戦勝となりました(${matchLabel})。`;
  }
}

// 最終Upvote時間で決まるのは票が同数の勝利と敗北だけ
export function lastUpvoteSentence(
  input: MatchResultEmailInput,
): string | undefined {
  if (!input.decidedByLastUpvote) {
    return undefined;
  }
  if (input.outcome === 'won') {
    return '同数でしたが、最終Upvote時刻が早いため勝利しました。';
  }
  if (input.outcome === 'lost') {
    return '同数でしたが、最終Upvote時刻が遅かったため敗れました。';
  }
  return undefined;
}

export function nextMatchSentence(next: NextMatch): string {
  return `明日は${next.roundName}です。${next.opponentProductName}と対戦します。`;
}
