import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ClientQualifierBoardQuery } from '../../graphql/generated/graphql.ts';
import { qualifierBoardQueryOptions } from '../../graphql/qualifier-board.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { FullTimeCountdown } from './full-time-countdown.tsx';
import type { TopPageSectionContext } from './top-page-section-types.ts';

const fullTimeAtOf = ({ qualifierBoard }: ClientQualifierBoardQuery): string =>
  qualifierBoard.fullTimeAt;

// 上部の行のカウントダウンの区画。経路のloaderが取得した予選の値を読み、取り直しは経路(境界の時刻)と予選の区画(定期)に任せる。マッチ中は残り時間が毎秒動くため、自動更新の切り替えを描くよう申告する
export function FullTimeCountdownSection({
  board,
  autoRefresh,
  reportAutoUpdating,
}: TopPageSectionContext) {
  const { data: fullTimeAt } = useSuspenseQuery({
    ...qualifierBoardQueryOptions(useViewer()),
    refetchOnMount: false,
    select: fullTimeAtOf,
  });
  const live = board.phase === 'LIVE';
  useEffect(() => {
    reportAutoUpdating(live);
  }, [live, reportAutoUpdating]);
  return (
    <FullTimeCountdown
      phase={board.phase}
      fullTimeAt={fullTimeAt}
      serverTime={board.serverTime}
      autoRefresh={autoRefresh}
    />
  );
}
