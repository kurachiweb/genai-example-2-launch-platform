import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';

import {
  myWeekEntryQueryOptions,
  startWeekTournamentCheckoutMutationOptions,
} from '../../graphql/week-tournament.ts';
import type { ClientStartWeekTournamentCheckoutMutation } from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import type { TournamentEntryCheckoutStart } from '../tournament/tournament-entry-checkout.tsx';
import { TournamentEntryPanelBody } from '../tournament/tournament-entry-panel-body.tsx';
import { WEEK_ENTRY_COPY } from './week-entry-messages.ts';
import { weekEntryInputOf } from './week-entry-view.ts';

export interface WeekEntryPanelProps {
  // 現在のハンドル
  readonly productHandle: string;
  // ページの「自動更新」の状態。偽の間は受付期限の秒読みの毎秒の更新を止める。境界の時刻の取り直しは止めない
  readonly autoRefresh: boolean;
  // 秒読みを持つ間(受付中で受付期限まで48時間未満)は自動更新の状態によらずtrue、それ以外はfalseを申告する。ページは切り替えを描くかの判定に使う
  readonly onAutoUpdatingChange?: (active: boolean) => void;
}

interface PanelContentProps extends WeekEntryPanelProps {
  readonly viewer: ClientViewer;
}

const WEEK_ENTRY_CHECKOUT: TournamentEntryCheckoutStart<ClientStartWeekTournamentCheckoutMutation> =
  Object.freeze({
    mutationOptions: startWeekTournamentCheckoutMutationOptions(),
    purchaseIdOf: ({
      startWeekTournamentCheckout,
    }: ClientStartWeekTournamentCheckoutMutation) =>
      startWeekTournamentCheckout.purchaseId,
  });

function WeekEntryPanelContent({
  viewer,
  productHandle,
  autoRefresh,
  onAutoUpdatingChange,
}: PanelContentProps) {
  const queryClient = useQueryClient();
  const options = myWeekEntryQueryOptions(viewer, productHandle);
  const { data } = useSuspenseQuery(options);
  const entry = data.myWeekEntry;
  return (
    <TournamentEntryPanelBody
      entry={entry === null ? null : weekEntryInputOf(entry)}
      copy={WEEK_ENTRY_COPY}
      countdown
      autoRefresh={autoRefresh}
      checkout={WEEK_ENTRY_CHECKOUT}
      onBoundaryReached={() => {
        void queryClient.invalidateQueries({ queryKey: options.queryKey });
      }}
      onAutoUpdatingChange={onAutoUpdatingChange}
    />
  );
}

// 投稿者本人のプロダクトの直近のローンチのWeekトーナメントの参加の枠を、状態ごとに示す。枠が無い・本人でなければ何も描かない。
// 受付期限の48時間前と受付期限に取り直して注意色・秒読みと受付の終了へ切り替える。取得の失敗と読み込み中は置き場所の区画のエラーの境界に任せる
export function WeekEntryPanel({
  productHandle,
  autoRefresh,
  onAutoUpdatingChange,
}: WeekEntryPanelProps) {
  const viewer = useViewer();
  if (viewer === null) {
    return null;
  }
  return (
    <WeekEntryPanelContent
      viewer={viewer}
      productHandle={productHandle}
      autoRefresh={autoRefresh}
      onAutoUpdatingChange={onAutoUpdatingChange}
    />
  );
}
