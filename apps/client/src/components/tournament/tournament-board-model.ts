import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type {
  MatchByeFragment,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';

// 種類ごとのトップページの行のフラグメントが満たす構造の型
export interface TournamentBoardRound {
  readonly final: boolean;
  readonly matches: readonly MatchFragment[];
  readonly byes: readonly MatchByeFragment[];
}

export interface BoardRoundSplit {
  // 決勝の行はトップページの全幅の注目の区画が描くため、本文の区画は描かない
  readonly final: boolean;
  readonly cards: readonly MatchFragment[];
  readonly byes: readonly MatchByeFragment[];
}

export interface TournamentSectionRound<
  R extends TournamentBoardRound,
> extends BoardRoundSplit {
  readonly round: R;
}

export interface TournamentBoardRefreshInput {
  // 取得の前はundefined
  readonly rounds: readonly TournamentBoardRound[] | undefined;
  readonly autoRefresh: boolean;
  // ページを表示した時点と最後の境界の取り直しのうち後の時点からの、取得の更新の回数
  readonly updatesSinceBaseline: number;
}

// 種類の照会の結果から盤面の行を取り出し、差し替えた行で結果を作り直す関数
export interface TournamentBoardAccess<TData, R extends TournamentBoardRound> {
  readonly roundsOf: (data: TData) => readonly R[];
  readonly withRounds: (data: TData, rounds: readonly R[]) => TData;
}

// サーバーが対戦カードと不戦勝に分け、ブラケットの位置の順に並べた値をそのまま使う
export const splitBoardRound = (
  round: TournamentBoardRound,
): BoardRoundSplit => ({
  final: round.final,
  cards: round.matches,
  byes: round.byes,
});

// 決勝の行と、全てのマッチが両者の不戦敗で描くものが無い行を除き、サーバーの順(1回戦の日の昇順)のまま並べる
export const sectionRoundsOf = <R extends TournamentBoardRound>(
  rounds: readonly R[],
): readonly TournamentSectionRound<R>[] =>
  rounds.flatMap((round) => {
    const split = splitBoardRound(round);
    return split.final || (split.cards.length === 0 && split.byes.length === 0)
      ? []
      : [{ round, ...split }];
  });

const sectionCardsOf = (rounds: readonly TournamentBoardRound[]) =>
  sectionRoundsOf(rounds).flatMap(({ cards }) => cards);

const hasLiveCard = (rounds: readonly TournamentBoardRound[]): boolean =>
  sectionCardsOf(rounds).some(({ phase }) => phase === 'LIVE');

// 日次のジョブの完了で、集計中のマッチの結果が確定するか、開始の前のマッチが始まるのを待っている
export const isBoardAwaitingChange = (
  rounds: readonly TournamentBoardRound[] | undefined,
): boolean =>
  rounds !== undefined &&
  sectionCardsOf(rounds).some(
    ({ phase }) => phase === 'TALLYING' || phase === 'SCHEDULED',
  );

export const canBoardChange = (
  rounds: readonly TournamentBoardRound[] | undefined,
): boolean =>
  rounds !== undefined &&
  (hasLiveCard(rounds) || isBoardAwaitingChange(rounds));

// 自動更新がオンの間はマッチ中と待っている間に取り直し、オフでも待っている間は上限の回数まで取り直す
export const boardRefetchIntervalOf = ({
  rounds,
  autoRefresh,
  updatesSinceBaseline,
}: TournamentBoardRefreshInput): number | false => {
  if (autoRefresh && canBoardChange(rounds)) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  if (
    isBoardAwaitingChange(rounds) &&
    updatesSinceBaseline < FOLLOW_UP_REFETCH_LIMIT
  ) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  return false;
};

export const isBoardFollowUpExhausted = ({
  rounds,
  autoRefresh,
  updatesSinceBaseline,
}: TournamentBoardRefreshInput): boolean =>
  !autoRefresh &&
  isBoardAwaitingChange(rounds) &&
  updatesSinceBaseline >= FOLLOW_UP_REFETCH_LIMIT;

// Upvote・取り消しの結果で、取り直さずに該当のマッチだけを同じ行の同じ位置で差し替える
export function withUpdatedBoardMatch<TData, R extends TournamentBoardRound>(
  data: TData | undefined,
  match: MatchFragment,
  { roundsOf, withRounds }: TournamentBoardAccess<TData, R>,
): TData | undefined {
  if (data === undefined) {
    return data;
  }
  const rounds = roundsOf(data);
  const hasMatch = (round: R): boolean =>
    round.matches.some(({ id }) => id === match.id);
  if (!rounds.some(hasMatch)) {
    return data;
  }
  return withRounds(
    data,
    rounds.map((round) =>
      hasMatch(round)
        ? {
            ...round,
            matches: round.matches.map((current) =>
              current.id === match.id ? match : current,
            ),
          }
        : round,
    ),
  );
}
