import type { Product } from '#/lib/mock-data';

export type Round = 'r1' | 'qf' | 'sf' | 'final';
export type MatchKind = 'qualifier' | 'week' | 'year';

export type Match = {
  id: string;
  kind: MatchKind;
  left: Product;
  right: Product;
  leftVotes: number;
  rightVotes: number;
  isOwn: boolean;
  upvoted: 'left' | 'right' | null;
  // 詳細ページへ遷移させるのはディレクトリ掲載済みまたは自身のプロダクトのみ(FR-GAME-007)
  linked: { left: boolean; right: boolean };
};

export const ROUND_LABEL: Record<Round, string> = {
  r1: '1回戦',
  qf: '準々決勝',
  sf: '準決勝',
  final: '決勝',
};

export function matchWinner(
  match: Pick<Match, 'leftVotes' | 'rightVotes'>,
): 'left' | 'right' | 'none' {
  if (match.leftVotes === 0 && match.rightVotes === 0) return 'none';
  if (match.leftVotes === match.rightVotes) return 'left';
  return match.leftVotes > match.rightVotes ? 'left' : 'right';
}
