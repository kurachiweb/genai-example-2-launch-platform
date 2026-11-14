import type { ProductPageView } from '../../graphql/product-page.ts';

export type ProductPageLaunchView = ProductPageView['launches'][number];

export type ProductPageMatchView = ProductPageLaunchView['matches'][number];

// byeは開始時点で相手がいない・相手が該当した不戦勝、earlyはマッチ中の相手の該当による早期の不戦勝
export type HistoryOutcome = 'won' | 'bye' | 'early' | 'lost' | 'both-lost';

// liveは予選マッチの開催中、upcomingはキックオフ前、noneは表示する案内が無い
export type EmptyMatchesState = 'live' | 'upcoming' | 'none';

const BOTH_LOST_DECISIONS: ReadonlySet<ProductPageMatchView['decision']> =
  new Set(['NO_VOTES', 'BOTH_FORFEITED']);

export function historyOutcomeOf({
  result,
  decision,
  endedEarly,
}: ProductPageMatchView): HistoryOutcome {
  switch (result) {
    case 'WON':
      return 'won';
    case 'BYE':
      return 'bye';
    case 'WALKOVER':
      return endedEarly ? 'early' : 'bye';
    case 'LOST':
      return BOTH_LOST_DECISIONS.has(decision) ? 'both-lost' : 'lost';
  }
}

export const isCloseMatch = ({ decision }: ProductPageMatchView): boolean =>
  decision === 'LAST_UPVOTE';

// 結果の確定したマッチが無いブロックの案内。終了したローンチは照会の間の紐付けの解除でしか行が無くならず、待てば表示される勝敗も無いため案内を出さない
export function emptyMatchesStateOf({
  kickedOff,
  status,
}: ProductPageLaunchView): EmptyMatchesState {
  if (!kickedOff) {
    return 'upcoming';
  }
  return status === 'IN_PROGRESS' ? 'live' : 'none';
}

export const matchCountOf = (
  launches: readonly ProductPageLaunchView[],
): number => launches.reduce((total, { matches }) => total + matches.length, 0);
