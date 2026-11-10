import type { MatchDecision } from '../../../lib/core/match/match-model.ts';

export type ByeReason = 'absent' | 'forfeit' | 'early';

export interface BoardMatch {
  readonly matchId: string;
  readonly totalUpvotes: number;
  readonly decision: MatchDecision | null;
  readonly endedEarly: boolean;
  readonly entryCount: 1 | 2;
}

export interface BoardBye {
  readonly matchId: string;
  readonly reason: ByeReason;
}

export interface BoardOrder {
  readonly cards: readonly string[];
  readonly byes: readonly BoardBye[];
  // 対戦カードと即時の終了の不戦勝の数
  readonly heldCount: number;
}

type Placement =
  | { readonly kind: 'card' }
  | { readonly kind: 'bye'; readonly reason: ByeReason }
  | { readonly kind: 'hidden' };

const TWO_SIDED_DECISIONS: ReadonlySet<MatchDecision> = new Set([
  'votes',
  'last_upvote',
  'no_votes',
  'walkover',
]);

function placementOf(match: BoardMatch): Placement {
  if (
    match.entryCount === 1 &&
    match.decision !== null &&
    TWO_SIDED_DECISIONS.has(match.decision)
  ) {
    throw new RangeError(
      `側が1つのマッチに2つの側の決着があります: ${match.matchId} ${match.decision}`,
    );
  }
  switch (match.decision) {
    case 'both_forfeited':
      return { kind: 'hidden' };
    case 'bye':
      return { kind: 'bye', reason: 'absent' };
    case 'walkover':
      return { kind: 'bye', reason: match.endedEarly ? 'early' : 'forfeit' };
    default:
      // 開始の記録の前の側が1つのマッチは、開始の日時に不戦勝で確定する
      return match.entryCount === 1
        ? { kind: 'bye', reason: 'absent' }
        : { kind: 'card' };
  }
}

// ULIDの順を保つため、ロケールに依らず文字の符号で比べる
function compareIds(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

function orderCards(cards: readonly BoardMatch[]): readonly string[] {
  const ascending = cards.toSorted(
    (first, second) =>
      first.totalUpvotes - second.totalUpvotes ||
      compareIds(first.matchId, second.matchId),
  );
  const highest = ascending.reduce<BoardMatch | undefined>(
    (best, item) =>
      best === undefined || item.totalUpvotes > best.totalUpvotes ? item : best,
    undefined,
  );
  if (highest === undefined) {
    return [];
  }
  return [
    highest.matchId,
    ...ascending.filter((item) => item !== highest).map((item) => item.matchId),
  ];
}

export function orderBoard(matches: readonly BoardMatch[]): BoardOrder {
  const placed = matches.map((match) => ({
    match,
    placement: placementOf(match),
  }));
  const cards = orderCards(
    placed
      .filter(({ placement }) => placement.kind === 'card')
      .map(({ match }) => match),
  );
  const byes = placed
    .flatMap(({ match, placement }) =>
      placement.kind === 'bye'
        ? [{ matchId: match.matchId, reason: placement.reason }]
        : [],
    )
    .toSorted((first, second) => compareIds(first.matchId, second.matchId));
  const earlyCount = byes.filter((bye) => bye.reason === 'early').length;
  return { cards, byes, heldCount: cards.length + earlyCount };
}
