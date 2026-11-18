import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';

import {
  myYearEntryQueryOptions,
  startYearTournamentCheckoutMutationOptions,
} from '../../graphql/year-tournament.ts';
import type { ClientStartYearTournamentCheckoutMutation } from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import type { TournamentEntryCheckoutStart } from '../tournament/tournament-entry-checkout.tsx';
import { TournamentEntryPanelBody } from '../tournament/tournament-entry-panel-body.tsx';
import {
  formatYearFinalDateLabel,
  YEAR_ENTRY_COPY,
  yearEntryIntroMessage,
} from './year-entry-messages.ts';
import {
  type YearEntryPanelView,
  yearEntryInputOf,
} from './year-entry-view.ts';

export interface YearEntryPanelProps {
  // 現在のハンドル
  readonly productHandle: string;
}

interface PanelContentProps extends YearEntryPanelProps {
  readonly viewer: ClientViewer;
}

const YEAR_ENTRY_CHECKOUT: TournamentEntryCheckoutStart<ClientStartYearTournamentCheckoutMutation> =
  Object.freeze({
    mutationOptions: startYearTournamentCheckoutMutationOptions(),
    purchaseIdOf: ({
      startYearTournamentCheckout,
    }: ClientStartYearTournamentCheckoutMutation) =>
      startYearTournamentCheckout.purchaseId,
  });

function YearEntryIntro({ entry }: { readonly entry: YearEntryPanelView }) {
  const { before, after } = yearEntryIntroMessage(
    entry.weekLabel,
    entry.yearLabel,
  );
  return (
    <>
      {before}
      <time dateTime={entry.finalDate}>
        {formatYearFinalDateLabel(entry.finalDate)}
      </time>
      {after}
    </>
  );
}

function YearEntryPanelContent({ viewer, productHandle }: PanelContentProps) {
  const queryClient = useQueryClient();
  const options = myYearEntryQueryOptions(viewer, productHandle);
  const { data } = useSuspenseQuery(options);
  const entry = data.myYearEntry;
  return (
    <TournamentEntryPanelBody
      entry={entry === null ? null : yearEntryInputOf(entry)}
      copy={YEAR_ENTRY_COPY}
      countdown={false}
      autoRefresh={false}
      checkout={YEAR_ENTRY_CHECKOUT}
      onBoundaryReached={() => {
        void queryClient.invalidateQueries({ queryKey: options.queryKey });
      }}
      payableIntro={
        entry === null ? undefined : <YearEntryIntro entry={entry} />
      }
    />
  );
}

// 投稿者本人のプロダクトの直近のローンチのYearトーナメントの参加の枠を、状態ごとに示す。枠が無い・本人でなければ何も描かない。
// Week優勝から受付期限までが長いため秒読みと注意色を添えず、受付期限に取り直して受付の終了へ切り替える。取得の失敗と読み込み中は置き場所の区画のエラーの境界に任せる
export function YearEntryPanel({ productHandle }: YearEntryPanelProps) {
  const viewer = useViewer();
  if (viewer === null) {
    return null;
  }
  return (
    <YearEntryPanelContent viewer={viewer} productHandle={productHandle} />
  );
}
