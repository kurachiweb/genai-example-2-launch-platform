import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import { UpvoteBotProtection } from '../components/match/upvote-bot-protection.tsx';
import { useBoundaryRefresh } from '../components/time/use-boundary-refresh.ts';
import { TopPage } from '../components/top/top-page.tsx';
import { TopPageError } from '../components/top/top-page-error.tsx';
import { TopPageSkeleton } from '../components/top/top-page-skeleton.tsx';
import { TOP_PAGE_SECTIONS } from '../composition/top-page-sections.ts';
import {
  loadQualifierBoard,
  QUALIFIER_BOARD_QUERY_PREFIX,
  qualifierBoardQueryOptions,
  toTopPageView,
} from '../graphql/qualifier-board.ts';
import { buildSitePageHead } from '../head/page-heads.ts';

export const Route = createFileRoute('/')({
  loader: loadQualifierBoard,
  head: () => buildSitePageHead({ title: '', canonicalUrl: '/' }),
  pendingComponent: TopPageSkeleton,
  errorComponent: TopPageError,
  component: TopPageRoute,
});

// 区画の文脈に渡す時間帯とサーバーの時刻を読み、定期の取り直しは予選の区画の購読に任せる。
// 境界の時刻の取り直しは、区画の描画の失敗でカウントダウンと区画の文脈が止まらないよう、区画のエラーの境界の外のここで行う。対戦カードのUpvoteが使うbot判定のウィジェットをページに1つ置く
function TopPageRoute() {
  const { viewer } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery({
    ...qualifierBoardQueryOptions(viewer),
    refetchOnMount: false,
    select: toTopPageView,
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: QUALIFIER_BOARD_QUERY_PREFIX,
    });
  }, [queryClient]);
  useBoundaryRefresh(data.boundaries, refresh);
  return (
    <UpvoteBotProtection>
      <TopPage
        sections={TOP_PAGE_SECTIONS}
        board={data.board}
        signedIn={viewer !== null}
        hasQualifierMatches={data.hasQualifierMatches}
      />
    </UpvoteBotProtection>
  );
}
