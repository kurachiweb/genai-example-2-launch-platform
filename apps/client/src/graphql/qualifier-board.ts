import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import type { TopPageSectionContext } from '../components/top/top-page-section-types.ts';
import {
  ClientQualifierBoardDocument,
  type ClientQualifierBoardQuery,
  type MatchFragment,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export interface TopPageView {
  readonly board: TopPageSectionContext['board'];
  readonly hasQualifierMatches: boolean;
  // 表示中に取り直す業務時刻の境界(当日の終了の時刻と翌日の開始の時刻)
  readonly boundaries: readonly [string, string];
}

const GUEST_SCOPE = 'guest';

// 閲覧者ごとの項目(Upvote済みの側・自分のプロダクト・Upvoteできない理由)を含むため、同じタブでログイン・ログアウトした後に前の閲覧者の値を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const qualifierBoardQueryOptions = (viewer: ClientViewer | null) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientQualifierBoardDocument, {}),
      viewer === null ? GUEST_SCOPE : viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientQualifierBoardDocument, {}, { signal }),
      ),
  });

export const QUALIFIER_BOARD_QUERY_PREFIX = Object.freeze([
  documentIdOf(ClientQualifierBoardDocument),
] as const);

// 定期の取り直しと組で、表示した時点の最新を示すため毎回取得する。失敗はエラーの画面にするため、そのまま投げる
export async function loadQualifierBoard({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer | null;
  };
}): Promise<void> {
  await context.queryClient.query({
    ...qualifierBoardQueryOptions(context.viewer),
    staleTime: 0,
  });
}

export const toTopPageView = ({
  qualifierBoard: {
    date,
    phase,
    serverTime,
    matches,
    fullTimeAt,
    nextKickoffAt,
  },
}: ClientQualifierBoardQuery): TopPageView => ({
  board: { date, phase, serverTime },
  hasQualifierMatches: matches.length > 0,
  boundaries: [fullTimeAt, nextKickoffAt],
});

// Upvote・取り消しの結果で、取り直さずに該当のマッチだけを同じ位置で差し替える
export function withUpdatedMatch(
  data: ClientQualifierBoardQuery,
  match: MatchFragment,
): ClientQualifierBoardQuery;
export function withUpdatedMatch(
  data: ClientQualifierBoardQuery | undefined,
  match: MatchFragment,
): ClientQualifierBoardQuery | undefined;
export function withUpdatedMatch(
  data: ClientQualifierBoardQuery | undefined,
  match: MatchFragment,
): ClientQualifierBoardQuery | undefined {
  if (
    data === undefined ||
    !data.qualifierBoard.matches.some(({ id }) => id === match.id)
  ) {
    return data;
  }
  return {
    ...data,
    qualifierBoard: {
      ...data.qualifierBoard,
      matches: data.qualifierBoard.matches.map((current) =>
        current.id === match.id ? match : current,
      ),
    },
  };
}
