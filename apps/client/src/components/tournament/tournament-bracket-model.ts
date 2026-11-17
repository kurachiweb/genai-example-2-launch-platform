import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type { BracketViewProps } from '../bracket/bracket-view-props.ts';

// 種類の照会のブラケットの値が満たす構造の型
export interface TournamentBracketView {
  readonly rounds: BracketViewProps['rounds'];
  readonly champion: BracketViewProps['champion'];
  readonly tournament: {
    // 終了の前はnull
    readonly awarded: boolean | null;
    readonly status: string;
  };
}

export interface TournamentBracketPageView extends TournamentBracketView {
  readonly participantCount: number;
  readonly seedCount: number;
}

const FINISHED_STATUS = 'FINISHED';

// 受賞の有無は終了の前にnullのため、受賞でないものとして共用の部品へ渡す
export const bracketViewPropsOf = ({
  rounds,
  champion,
  tournament,
}: TournamentBracketView): BracketViewProps => ({
  rounds,
  champion,
  awarded: tournament.awarded === true,
  finished: tournament.status === FINISHED_STATUS,
});

// 終了したトーナメントはUpvote数も結果も変わらないため、終了の前だけを開催中とする
export const isTournamentBracketLive = (
  bracket: TournamentBracketView | null | undefined,
): boolean =>
  bracket !== undefined &&
  bracket !== null &&
  bracket.tournament.status !== FINISHED_STATUS;

// 自動更新がオフの間は定期の取り直しだけを止め、画面へ戻ったときの取り直しは続ける
export const tournamentBracketRefetchIntervalOf = (
  bracket: TournamentBracketView | null | undefined,
  autoRefresh: boolean,
): number | false =>
  autoRefresh && isTournamentBracketLive(bracket)
    ? LIVE_REFRESH_QUERY_OPTIONS.refetchInterval
    : false;
