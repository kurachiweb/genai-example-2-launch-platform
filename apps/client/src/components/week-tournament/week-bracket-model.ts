import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type { ClientWeekBracketQuery } from '../../graphql/generated/graphql.ts';
import type { BracketViewProps } from '../bracket/bracket-view-props.ts';

export type WeekBracketView = NonNullable<
  ClientWeekBracketQuery['weekBracket']
>;

export interface WeekBracketRefreshQuery {
  readonly state: { readonly data?: ClientWeekBracketQuery | undefined };
}

// 受賞の有無は終了の前にnullのため、受賞でないものとして共用の部品へ渡す
export const bracketViewPropsOf = ({
  rounds,
  champion,
  tournament,
}: WeekBracketView): BracketViewProps => ({
  rounds,
  champion,
  awarded: tournament.awarded === true,
  finished: tournament.status === 'FINISHED',
});

// 終了したトーナメントはUpvote数も結果も変わらないため、終了の前だけを開催中とする
export const isWeekBracketLive = (
  data: ClientWeekBracketQuery | undefined,
): boolean =>
  data?.weekBracket !== undefined &&
  data.weekBracket !== null &&
  data.weekBracket.tournament.status !== 'FINISHED';

// 自動更新がオフの間は定期の取り直しだけを止め、画面へ戻ったときの取り直しは続ける
export const weekBracketRefetchIntervalOf = (
  query: WeekBracketRefreshQuery,
  autoRefresh: boolean,
): number | false =>
  autoRefresh && isWeekBracketLive(query.state.data)
    ? LIVE_REFRESH_QUERY_OPTIONS.refetchInterval
    : false;
