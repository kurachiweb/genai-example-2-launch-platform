import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { VERSUS_LABEL } from './match-card-messages.ts';
import {
  entryNameOf,
  entryOutcomeOf,
  finishedWinnerOf,
  siteRelOf,
  upvoteDisabledReasonOf,
} from './match-card-model.ts';
import type { MatchEntryView } from './match-card-model.ts';
import type { PitchSide } from './pitch-model.ts';
import { ProductPanel } from './product-panel.tsx';
import { StadiumPitch } from './stadium-pitch.tsx';
import { teamColorsOf } from './team-colors.ts';
import { useUpvoteCelebration } from './use-upvote-celebration.ts';
import { VoteBar } from './vote-bar.tsx';

export interface MatchStageProps {
  readonly match: MatchFragment;
  // 送信中の側。送信中でなければnull
  readonly pendingEntryId?: string | null;
  readonly onToggleUpvote: (entryId: string) => void;
}

interface StageBodyProps extends Required<MatchStageProps> {
  readonly left: MatchEntryView;
  readonly right: MatchEntryView;
}

function StageBody({
  match,
  left,
  right,
  pendingEntryId,
  onToggleUpvote,
}: StageBodyProps) {
  const { excited, shot } = useUpvoteCelebration({
    leftEntryId: left.id,
    rightEntryId: right.id,
    upvotedEntryId: match.viewerUpvotedEntryId,
  });
  const winner = finishedWinnerOf(match);
  const leftColors = teamColorsOf(left.colorIndex);
  const rightColors = teamColorsOf(right.colorIndex);
  const siteRel = siteRelOf(match.kind);
  const disabledReason = upvoteDisabledReasonOf(match.viewerRestriction);

  const pitchProps = {
    leftVotes: left.upvoteCount,
    rightVotes: right.upvoteCount,
    leftColors,
    rightColors,
    excited,
    finishedWinner: winner,
  };
  const barProps = {
    leftName: entryNameOf(left),
    rightName: entryNameOf(right),
    leftVotes: left.upvoteCount,
    rightVotes: right.upvoteCount,
    leftColor: leftColors[0],
    rightColor: rightColors[0],
    shot,
  };
  const panelOf = (entry: MatchEntryView, side: PitchSide) => (
    <ProductPanel
      entry={entry}
      side={side}
      siteRel={siteRel}
      pressed={match.viewerUpvotedEntryId === entry.id}
      pending={pendingEntryId === entry.id}
      disabledReason={disabledReason}
      outcome={entryOutcomeOf(winner, side)}
      onUpvote={() => {
        onToggleUpvote(entry.id);
      }}
    />
  );

  return (
    <div className="@container relative flex-1">
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <div className="hidden size-full @[768px]:block">
          <StadiumPitch orientation="horizontal" {...pitchProps} />
        </div>
        <div className="size-full bg-(--stand-base) @[768px]:hidden">
          <StadiumPitch orientation="vertical" {...pitchProps} />
        </div>
      </div>
      <div className="relative grid gap-4 px-3 py-8 @[768px]:grid-cols-[1fr_auto_1fr] @[768px]:items-center @[768px]:gap-2 @[768px]:px-5 @[768px]:py-4">
        {panelOf(left, 'left')}
        <div className="hidden items-center justify-center @[768px]:flex">
          <span
            aria-hidden="true"
            className="rounded-full border border-border/60 bg-card/85 px-3 py-1 text-sm font-bold text-muted-foreground backdrop-blur"
          >
            {VERSUS_LABEL}
          </span>
        </div>
        {/* 縦に積む配置では比率のバーを2つの側の間に置き、横に並べる配置では下の行に置く。表示しない方はdisplay:noneで読み上げからも外れる */}
        <VoteBar {...barProps} className="@[768px]:hidden" />
        {panelOf(right, 'right')}
        <VoteBar {...barProps} className="col-span-3 hidden @[768px]:block" />
      </div>
    </div>
  );
}

// 両側のパネル・中央のVS・比率のバー・背景のピッチを、カードの幅が768px未満なら縦に積み、それ以上なら横に並べる。画面幅640px未満のカードは常に768px未満のため縦に積む。側が2つ揃わないマッチは対戦カードにしない
export function MatchStage({
  match,
  pendingEntryId = null,
  onToggleUpvote,
}: MatchStageProps) {
  const [left, right] = match.entries;
  if (left === undefined || right === undefined) {
    return null;
  }
  return (
    <StageBody
      match={match}
      left={left}
      right={right}
      pendingEntryId={pendingEntryId}
      onToggleUpvote={onToggleUpvote}
    />
  );
}
