import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type {
  MatchPhase,
  WeekBoardRoundFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import { entryNameOf, finishedWinnerOf } from '../match/match-card-model.ts';
import { HIDDEN_PRODUCT_NAME } from '../match/match-labels.ts';
import {
  type BoardRoundSplit,
  splitBoardRound,
  type WeekBoard,
  type WeekBoardRefreshInput,
  type WeekSectionRound,
  weekBoardRefetchIntervalOf,
} from './week-board-model.ts';

export type WeekFinalOutcome =
  | { readonly kind: 'awarded'; readonly productName: string }
  | { readonly kind: 'no-award' };

// 決勝の行のうち、対戦カードか不戦勝を持つもの(両者の不戦敗でないもの)を、サーバーの順のまま並べる
export const weekFinalRoundsOf = (
  rounds: readonly WeekBoardRoundFieldsFragment[],
): readonly WeekSectionRound[] =>
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

const finalCardsOf = (board: WeekBoard) =>
  weekFinalRoundsOf(board.rounds).flatMap(({ cards }) => cards);

export const isWeekFinalRoundAwaitingChange = ({
  cards,
}: Pick<BoardRoundSplit, 'cards'>): boolean =>
  cards.some(({ phase }) => AWAITING_PHASES.has(phase));

// 日次のジョブの完了で、集計中の決勝の結果が確定するか、開始の前の決勝が始まるのを待っている
export const isWeekFinalAwaitingChange = (
  board: WeekBoard | undefined,
): boolean =>
  board !== undefined &&
  isWeekFinalRoundAwaitingChange({ cards: finalCardsOf(board) });

export const canWeekFinalChange = (board: WeekBoard | undefined): boolean =>
  board !== undefined &&
  (finalCardsOf(board).some(({ phase }) => phase === 'LIVE') ||
    isWeekFinalAwaitingChange(board));

// 自動更新がオンの間は決勝のマッチ中と待っている間に取り直し、オフでも待っている間は上限の回数まで取り直す。
// 本文のWeekトーナメントの区画(同じ登録口の本文の20)が同じ盤面を同じ間隔で取り直す間は、その取り直しで決勝の行も更新されるため重ねない
export const weekFinalRefetchIntervalOf = (
  input: WeekBoardRefreshInput,
): number | false => {
  if (weekBoardRefetchIntervalOf(input) !== false) {
    return false;
  }
  const { board, autoRefresh, updatesSinceBaseline } = input;
  if (autoRefresh && canWeekFinalChange(board)) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  if (
    isWeekFinalAwaitingChange(board) &&
    updatesSinceBaseline < FOLLOW_UP_REFETCH_LIMIT
  ) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  return false;
};

export const isWeekFinalFollowUpExhausted = ({
  board,
  autoRefresh,
  updatesSinceBaseline,
}: WeekBoardRefreshInput): boolean =>
  !autoRefresh &&
  isWeekFinalAwaitingChange(board) &&
  updatesSinceBaseline >= FOLLOW_UP_REFETCH_LIMIT;

// 確定した決勝の対戦カードは勝った側の受賞か、0対0の両者敗北による受賞なしにする。不戦勝・早期勝利の決勝はその側の受賞にする
export function weekFinalOutcomeOf({
  cards,
  byes,
}: BoardRoundSplit): WeekFinalOutcome | null {
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
