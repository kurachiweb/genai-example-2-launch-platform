import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MatchPhase } from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import { entryNameOf, finishedWinnerOf } from '../match/match-card-model.ts';
import { HIDDEN_PRODUCT_NAME } from '../match/match-labels.ts';
import {
  boardRefetchIntervalOf,
  type BoardRoundSplit,
  splitBoardRound,
  type TournamentBoardRefreshInput,
  type TournamentBoardRound,
  type TournamentSectionRound,
} from './tournament-board-model.ts';

export type TournamentFinalOutcome =
  | { readonly kind: 'awarded'; readonly productName: string }
  | { readonly kind: 'no-award' };

// 決勝の行のうち、対戦カードか不戦勝を持つもの(両者の不戦敗でないもの)を、サーバーの順のまま並べる
export const finalRoundsOf = <R extends TournamentBoardRound>(
  rounds: readonly R[],
): readonly TournamentSectionRound<R>[] =>
  rounds.flatMap((round) => {
    const split = splitBoardRound(round);
    return split.final && (split.cards.length > 0 || split.byes.length > 0)
      ? [{ round, ...split }]
      : [];
  });

const AWAITING_PHASES: ReadonlySet<MatchPhase> = new Set([
  'TALLYING',
  'SCHEDULED',
]);

const finalCardsOf = (rounds: readonly TournamentBoardRound[]) =>
  finalRoundsOf(rounds).flatMap(({ cards }) => cards);

export const isFinalRoundAwaitingChange = ({
  cards,
}: Pick<BoardRoundSplit, 'cards'>): boolean =>
  cards.some(({ phase }) => AWAITING_PHASES.has(phase));

// 日次のジョブの完了で、集計中の決勝の結果が確定するか、開始の前の決勝が始まるのを待っている
export const isFinalAwaitingChange = (
  rounds: readonly TournamentBoardRound[] | undefined,
): boolean =>
  rounds !== undefined &&
  isFinalRoundAwaitingChange({ cards: finalCardsOf(rounds) });

export const canFinalChange = (
  rounds: readonly TournamentBoardRound[] | undefined,
): boolean =>
  rounds !== undefined &&
  (finalCardsOf(rounds).some(({ phase }) => phase === 'LIVE') ||
    isFinalAwaitingChange(rounds));

// 自動更新がオンの間は決勝のマッチ中と待っている間に取り直し、オフでも待っている間は上限の回数まで取り直す。
// 本文の区画が同じ盤面を同じ間隔で取り直す間は、その取り直しで決勝の行も更新されるため重ねない
export const finalRefetchIntervalOf = (
  input: TournamentBoardRefreshInput,
): number | false => {
  if (boardRefetchIntervalOf(input) !== false) {
    return false;
  }
  const { rounds, autoRefresh, updatesSinceBaseline } = input;
  if (autoRefresh && canFinalChange(rounds)) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  if (
    isFinalAwaitingChange(rounds) &&
    updatesSinceBaseline < FOLLOW_UP_REFETCH_LIMIT
  ) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  return false;
};

export const isFinalFollowUpExhausted = ({
  rounds,
  autoRefresh,
  updatesSinceBaseline,
}: TournamentBoardRefreshInput): boolean =>
  !autoRefresh &&
  isFinalAwaitingChange(rounds) &&
  updatesSinceBaseline >= FOLLOW_UP_REFETCH_LIMIT;

// 確定した決勝の対戦カードは勝った側の受賞か、0対0の両者敗北による受賞なしにする。不戦勝・早期勝利の決勝はその側の受賞にする
export function finalOutcomeOf({
  cards,
  byes,
}: BoardRoundSplit): TournamentFinalOutcome | null {
  const [card] = cards;
  if (card !== undefined) {
    const winner = finishedWinnerOf(card);
    if (winner === null) {
      return null;
    }
    if (winner === 'none') {
      return { kind: 'no-award' };
    }
    const entry = card.entries[winner === 'left' ? 0 : 1];
    return entry === undefined
      ? null
      : { kind: 'awarded', productName: entryNameOf(entry) };
  }
  const [bye] = byes;
  return bye === undefined
    ? null
    : {
        kind: 'awarded',
        productName: bye.entry.product?.name ?? HIDDEN_PRODUCT_NAME,
      };
}
