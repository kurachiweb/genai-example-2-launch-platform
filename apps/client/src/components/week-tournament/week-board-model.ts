import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type {
  ClientWeekTournamentBoardQuery,
  MatchFragment,
  WeekBoardRoundFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';

type WeekBoard = ClientWeekTournamentBoardQuery['weekTournamentBoard'];

export interface BoardRoundSplit {
  // 決勝の行はトップページの全幅の注目の区画が描くため、本文の区画は描かない
  readonly final: boolean;
  readonly cards: readonly WeekBoardRoundFieldsFragment['matches'][number][];
  readonly byes: readonly WeekBoardRoundFieldsFragment['byes'][number][];
}

export interface WeekSectionRound extends BoardRoundSplit {
  readonly round: WeekBoardRoundFieldsFragment;
}

export interface WeekBoardRefreshInput {
  readonly board: WeekBoard | undefined;
  readonly autoRefresh: boolean;
  // ページを表示した時点と最後の境界の取り直しのうち後の時点からの、取得の更新の回数
  readonly updatesSinceBaseline: number;
}

// サーバーが対戦カードと不戦勝に分け、ブラケットの位置の順に並べた値をそのまま使う
export const splitBoardRound = (
  round: WeekBoardRoundFieldsFragment,
): BoardRoundSplit => ({
  final: round.final,
  cards: round.matches,
  byes: round.byes,
});

// 決勝の行と、全てのマッチが両者の不戦敗で描くものが無い行を除き、サーバーの順(1回戦の日の昇順)のまま並べる
export const weekSectionRoundsOf = (
  rounds: readonly WeekBoardRoundFieldsFragment[],
): readonly WeekSectionRound[] =>
  rounds.flatMap((round) => {
    const split = splitBoardRound(round);
    return split.final || (split.cards.length === 0 && split.byes.length === 0)
      ? []
      : [{ round, ...split }];
  });

const sectionCardsOf = (board: WeekBoard) =>
  weekSectionRoundsOf(board.rounds).flatMap(({ cards }) => cards);

const hasLiveCard = (board: WeekBoard): boolean =>
  sectionCardsOf(board).some(({ phase }) => phase === 'LIVE');

// 日次のジョブの完了で、集計中のマッチの結果が確定するか、開始の前のマッチが始まるのを待っている
export const isWeekBoardAwaitingChange = (
  board: WeekBoard | undefined,
): boolean =>
  board !== undefined &&
  sectionCardsOf(board).some(
    ({ phase }) => phase === 'TALLYING' || phase === 'SCHEDULED',
  );

export const canWeekBoardChange = (board: WeekBoard | undefined): boolean =>
  board !== undefined &&
  (hasLiveCard(board) || isWeekBoardAwaitingChange(board));

// 自動更新がオンの間はマッチ中と待っている間に取り直し、オフでも待っている間は上限の回数まで取り直す
export const weekBoardRefetchIntervalOf = ({
  board,
  autoRefresh,
  updatesSinceBaseline,
}: WeekBoardRefreshInput): number | false => {
  if (autoRefresh && canWeekBoardChange(board)) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  if (
    isWeekBoardAwaitingChange(board) &&
    updatesSinceBaseline < FOLLOW_UP_REFETCH_LIMIT
  ) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  return false;
};

export const isWeekFollowUpExhausted = ({
  board,
  autoRefresh,
  updatesSinceBaseline,
}: WeekBoardRefreshInput): boolean =>
  !autoRefresh &&
  isWeekBoardAwaitingChange(board) &&
  updatesSinceBaseline >= FOLLOW_UP_REFETCH_LIMIT;

// Upvote・取り消しの結果で、取り直さずに該当のマッチだけを同じ行の同じ位置で差し替える
export function withUpdatedWeekBoardMatch(
  data: ClientWeekTournamentBoardQuery | undefined,
  match: MatchFragment,
): ClientWeekTournamentBoardQuery | undefined {
  const { rounds } = data?.weekTournamentBoard ?? { rounds: [] };
  if (
    data === undefined ||
    !rounds.some(({ matches }) => matches.some(({ id }) => id === match.id))
  ) {
    return data;
  }
  return {
    ...data,
    weekTournamentBoard: {
      ...data.weekTournamentBoard,
      rounds: rounds.map((round) =>
        round.matches.some(({ id }) => id === match.id)
          ? {
              ...round,
              matches: round.matches.map((current) =>
                current.id === match.id ? match : current,
              ),
            }
          : round,
      ),
    },
  };
}
