import type {
  MatchFragment,
  MatchKind,
  UpvoteRestriction,
} from '../../graphql/generated/graphql.ts';
import { UPVOTE_DISABLED_REASONS } from './match-card-messages.ts';
import {
  HIDDEN_PRODUCT_NAME,
  matchResultLabel,
  TALLYING_LABEL,
} from './match-labels.ts';
import type { PitchSide, PitchWinner } from './pitch-model.ts';

export type MatchEntryView = MatchFragment['entries'][number];

export type MatchHeadline =
  | { readonly kind: 'caption' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'none' };

export type EntryOutcome = 'won' | 'lost' | null;

const WINNING_RESULTS: ReadonlySet<MatchEntryView['result']> = new Set([
  'WON',
  'WALKOVER',
  'BYE',
]);

// 予選は未審査のプロダクトのためugcを付け、トーナメントは勝ち上がったWebサイトの評価を妨げないよう付けない
export function siteRelOf(kind: MatchKind): string {
  return kind === 'QUALIFIER' ? 'noopener ugc' : 'noopener';
}

export function entryNameOf(entry: MatchEntryView): string {
  return entry.product?.name ?? HIDDEN_PRODUCT_NAME;
}

export function upvoteDisabledReasonOf(
  restriction: UpvoteRestriction | null,
): string | null {
  return restriction === null || restriction === 'GUEST'
    ? null
    : UPVOTE_DISABLED_REASONS[restriction];
}

const sidesOf = (
  match: MatchFragment,
): readonly [MatchEntryView, MatchEntryView] | null => {
  const [left, right] = match.entries;
  return left === undefined || right === undefined ? null : [left, right];
};

export function finishedWinnerOf(match: MatchFragment): PitchWinner | null {
  const sides = sidesOf(match);
  if (match.phase !== 'FINISHED' || sides === null) {
    return null;
  }
  const [left, right] = sides;
  if (WINNING_RESULTS.has(left.result)) {
    return 'left';
  }
  return WINNING_RESULTS.has(right.result) ? 'right' : 'none';
}

export function entryOutcomeOf(
  winner: PitchWinner | null,
  side: PitchSide,
): EntryOutcome {
  if (winner === null) {
    return null;
  }
  return winner === side ? 'won' : 'lost';
}

const resultTextOf = (match: MatchFragment): string | null => {
  const sides = sidesOf(match);
  if (sides === null) {
    return null;
  }
  const { decision } = match;
  if (decision === 'NO_VOTES') {
    return matchResultLabel({ decision });
  }
  if (decision !== 'VOTES' && decision !== 'LAST_UPVOTE') {
    return null;
  }
  const winner = sides.find((entry) => WINNING_RESULTS.has(entry.result));
  const loser = sides.find((entry) => entry !== winner);
  if (winner === undefined || loser === undefined) {
    return null;
  }
  return matchResultLabel({
    decision,
    winnerName: entryNameOf(winner),
    winnerVotes: winner.upvoteCount,
    loserVotes: loser.upvoteCount,
  });
};

// 不戦勝・相手の該当・両方の側の該当の決着は対戦カードにしないため、見出しの行に結果を示さない
export function matchHeadlineOf(match: MatchFragment): MatchHeadline {
  switch (match.phase) {
    case 'LIVE':
      return { kind: 'caption' };
    case 'TALLYING':
      return { kind: 'text', text: TALLYING_LABEL };
    case 'FINISHED': {
      const text = resultTextOf(match);
      return text === null ? { kind: 'none' } : { kind: 'text', text };
    }
    case 'SCHEDULED':
      return { kind: 'none' };
  }
}
