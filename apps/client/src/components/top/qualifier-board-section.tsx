import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type {
  ClientQualifierBoardQuery,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import {
  qualifierBoardQueryOptions,
  withUpdatedMatch,
} from '../../graphql/qualifier-board.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { updateCountOf } from '../match/follow-up-refetch.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import {
  canQualifierBoardChange,
  isFollowUpExhausted,
  orderMatchesBy,
  qualifierRefetchIntervalOf,
} from './qualifier-refresh.ts';
import { FOLLOW_UP_EXHAUSTED_MESSAGE } from './qualifier-section-messages.ts';
import { QualifierSection } from './qualifier-section.tsx';
import type {
  QualifierListInsert,
  TopPageSectionContext,
} from './top-page-section-types.ts';

interface QualifierBoardSectionProps extends TopPageSectionContext {
  readonly inserts: readonly QualifierListInsert[];
}

interface OrderedQualifierSectionProps {
  readonly board: ClientQualifierBoardQuery['qualifierBoard'];
  readonly signedIn: boolean;
  readonly onUpdated: (match: MatchFragment) => void;
  readonly statusMessage: string | null;
  readonly inserts: readonly QualifierListInsert[];
}

// 並び替えはページを表示した時だけ行うため、最初に描いた対戦カードの順を保って取り直した値だけを差し替える。業務日付が変わると呼び出し元のkeyで作り直し、翌日の予選はサーバーの順で並べる
function OrderedQualifierSection({
  board,
  signedIn,
  onUpdated,
  statusMessage,
  inserts,
}: OrderedQualifierSectionProps) {
  const [order] = useState(() => board.matches.map(({ id }) => id));
  return (
    <QualifierSection
      board={{ ...board, matches: orderMatchesBy(order, board.matches) }}
      signedIn={signedIn}
      onUpdated={onUpdated}
      statusMessage={statusMessage}
      inserts={inserts}
    />
  );
}

// 予選の取得の購読を持つ区画。定期の取り直しの判定と、結果の反映を待つ取り直しの回数の数えをここに集める。
// 回数は、ページを表示した時点と最後の境界の時刻のうち後の時点の取得の更新の回数を基準にして数える。境界の時刻の取り直しそのものは、区画の失敗で止まらないようページの経路が行う
function QualifierBoardSection({
  viewer,
  autoRefresh,
  reportAutoUpdating,
  inserts,
}: QualifierBoardSectionProps) {
  const queryClient = useQueryClient();
  const clientViewer = useViewer();
  const options = useMemo(
    () => qualifierBoardQueryOptions(clientViewer),
    [clientViewer],
  );
  const updateCountNow = (): number =>
    updateCountOf(queryClient.getQueryState(options.queryKey));
  const [baseline, setBaseline] = useState(updateCountNow);
  const { data } = useSuspenseQuery({
    ...options,
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: (query) =>
      qualifierRefetchIntervalOf({
        board: query.state.data?.qualifierBoard,
        autoRefresh,
        updatesSinceBaseline: updateCountOf(query.state) - baseline,
      }),
    refetchOnWindowFocus: (query) =>
      canQualifierBoardChange(query.state.data?.qualifierBoard),
    refetchOnMount: false,
    // 値が変わらない取り直しや失敗も回数に数えて上限の案内を出すため、更新の日時と失敗の回数の変化でも描き直す
    notifyOnChangeProps: ['data', 'dataUpdatedAt', 'errorUpdateCount'],
  });
  const board = data.qualifierBoard;

  const { queryKey } = options;
  // 経路が同じ境界の時刻に取り直すため、ここでは数えの基準だけを境界の時点の回数に置き直し、境界の取り直しを10回の1回目に数える
  const resetBaseline = useCallback(() => {
    setBaseline(updateCountOf(queryClient.getQueryState(queryKey)));
  }, [queryClient, queryKey]);
  useBoundaryRefresh([board.fullTimeAt, board.nextKickoffAt], resetBaseline);

  const onUpdated = useCallback(
    (match: MatchFragment) => {
      queryClient.setQueryData(queryKey, (current) =>
        withUpdatedMatch(current, match),
      );
    },
    [queryClient, queryKey],
  );

  const autoUpdating =
    board.matches.length > 0 || canQualifierBoardChange(board);
  useEffect(() => {
    reportAutoUpdating(autoUpdating);
  }, [autoUpdating, reportAutoUpdating]);

  const exhausted = isFollowUpExhausted({
    board,
    autoRefresh,
    updatesSinceBaseline: updateCountNow() - baseline,
  });
  return (
    <OrderedQualifierSection
      key={board.date}
      board={board}
      signedIn={viewer.signedIn}
      onUpdated={onUpdated}
      statusMessage={exhausted ? FOLLOW_UP_EXHAUSTED_MESSAGE : null}
      inserts={inserts}
    />
  );
}

// 差し込みの登録口は区画の登録口と同じ合成の箇所にあり、区画の部品から読み込むと循環するため、登録する側が差し込みを渡して区画の部品を作る
export const qualifierBoardSectionOf = (
  inserts: readonly QualifierListInsert[],
): ComponentType<TopPageSectionContext> =>
  function QualifierBoardSectionWithInserts(context: TopPageSectionContext) {
    return <QualifierBoardSection {...context} inserts={inserts} />;
  };
