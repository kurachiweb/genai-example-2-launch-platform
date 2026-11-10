import type { MatchRecord } from '../../../lib/core/match/ports.ts';

export type BaseWinKind = 'victory' | 'bye' | 'early';

// 基準勝利は予選の勝ちの結果(won・bye・walkover)の記録から選ぶため、マッチを読めないときも記録のUpvote数を出す勝利として扱う
export function classifyBaseWin(
  match: MatchRecord | undefined,
  launchId: string,
): BaseWinKind {
  const own = match?.entries.find((entry) => entry.launchId === launchId);
  if (match === undefined || own === undefined) {
    return 'victory';
  }
  switch (own.result) {
    case 'won':
      return 'victory';
    case 'bye':
      return 'bye';
    case 'walkover':
      return match.endedEarly ? 'early' : 'bye';
    default:
      throw new RangeError(
        `予選の勝ちでない側を基準勝利にできません: ${match.matchId} ${String(own.result)}`,
      );
  }
}
