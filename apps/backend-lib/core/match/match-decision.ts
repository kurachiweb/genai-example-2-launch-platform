import type { EntryResult, MatchDecision } from './match-model.ts';

export interface EntryTally {
  readonly entryId: string;
  readonly upvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  readonly lastUpvoteSeq: number | null;
}

export interface EntryStanding {
  readonly entryId: string;
  readonly forfeited: boolean;
}

export interface MatchOutcome {
  readonly decision: MatchDecision;
  readonly results: ReadonlyMap<string, EntryResult>;
}

export type KickoffOutcome =
  | { readonly kind: 'start' }
  | { readonly kind: 'decided'; readonly outcome: MatchOutcome };

const MAX_ENTRIES_PER_MATCH = 2;

function outcomeOf(
  decision: MatchDecision,
  results: readonly (readonly [string, EntryResult])[],
): MatchOutcome {
  return { decision, results: new Map(results) };
}

function decided(
  decision: MatchDecision,
  results: readonly (readonly [string, EntryResult])[],
): KickoffOutcome {
  return { kind: 'decided', outcome: outcomeOf(decision, results) };
}

export function decideAtKickoff(
  entries: readonly EntryStanding[],
): KickoffOutcome {
  if (entries.length === 0 || entries.length > MAX_ENTRIES_PER_MATCH) {
    throw new RangeError(
      `マッチの側は1つか2つで指定してください: ${String(entries.length)}`,
    );
  }
  const forfeitedCount = entries.filter((entry) => entry.forfeited).length;
  if (forfeitedCount === 0 && entries.length === MAX_ENTRIES_PER_MATCH) {
    return { kind: 'start' };
  }
  if (forfeitedCount === 0) {
    return decided(
      'bye',
      entries.map((entry) => [entry.entryId, 'bye'] as const),
    );
  }
  if (forfeitedCount === entries.length) {
    return decided(
      'both_forfeited',
      entries.map((entry) => [entry.entryId, 'lost'] as const),
    );
  }
  return decided(
    'walkover',
    entries.map(
      (entry) =>
        [entry.entryId, entry.forfeited ? 'lost' : 'walkover'] as const,
    ),
  );
}

function assertTieBreakable(entry: EntryTally): {
  readonly lastUpvotedAt: number;
  readonly lastUpvoteSeq: number | null;
} {
  if (entry.lastUpvotedAt === null) {
    throw new RangeError(
      `Upvoteのある側に最終Upvote時間がありません: ${entry.entryId}`,
    );
  }
  return {
    lastUpvotedAt: entry.lastUpvotedAt.getTime(),
    lastUpvoteSeq: entry.lastUpvoteSeq,
  };
}

// 同数のときは最終Upvote時間が早い側、それも一致すれば先に記録されたUpvoteの側を前にする
function compareTiedEntries(first: EntryTally, second: EntryTally): number {
  const a = assertTieBreakable(first);
  const b = assertTieBreakable(second);
  if (a.lastUpvotedAt !== b.lastUpvotedAt) {
    return a.lastUpvotedAt - b.lastUpvotedAt;
  }
  if (
    a.lastUpvoteSeq === null ||
    b.lastUpvoteSeq === null ||
    a.lastUpvoteSeq === b.lastUpvoteSeq
  ) {
    throw new RangeError(
      `最終Upvote時間が一致する側の記録の順で勝者を決められません: ${first.entryId}, ${second.entryId}`,
    );
  }
  return a.lastUpvoteSeq - b.lastUpvoteSeq;
}

export function decideAtFullTime(
  entries: readonly [EntryTally, EntryTally],
): MatchOutcome {
  const [first, second] = entries;
  if (first.upvoteCount === 0 && second.upvoteCount === 0) {
    return outcomeOf('no_votes', [
      [first.entryId, 'lost'],
      [second.entryId, 'lost'],
    ]);
  }
  const isTied = first.upvoteCount === second.upvoteCount;
  const firstWins = isTied
    ? compareTiedEntries(first, second) < 0
    : first.upvoteCount > second.upvoteCount;
  return outcomeOf(isTied ? 'last_upvote' : 'votes', [
    [first.entryId, firstWins ? 'won' : 'lost'],
    [second.entryId, firstWins ? 'lost' : 'won'],
  ]);
}
