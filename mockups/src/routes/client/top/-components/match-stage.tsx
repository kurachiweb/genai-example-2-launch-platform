import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { paletteColors } from '#/components/client/art';
import { StadiumPitch } from '#/components/client/stadium-pitch/stadium-pitch';
import type { Side } from '#/components/client/stadium-pitch/stadium-pitch';
import type { User } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { matchWinner } from '../-model';
import type { Match } from '../-model';
import { ProductPanel } from './product-panel';
import {
  BALL_FLIGHT_MS,
  BALL_HOLD_MS,
  BALL_RETURN_MS,
  VoteBar,
} from './vote-bar';
import type { BallShot } from './vote-bar';

type Props = {
  match: Match;
  isLive: boolean;
  user: User | null;
  variant: 'card' | 'final';
  onRequireLogin: () => void;
};

type Interaction = {
  leftVotes: number;
  rightVotes: number;
  upvoted: Side | null;
  excited: Side | null;
  shot: BallShot;
};

const EXCITED_MS = 5000;

function useMatchInteraction(
  match: Match,
  user: User | null,
  onRequireLogin: () => void,
) {
  const [state, setState] = useState<Interaction>({
    leftVotes: match.leftVotes,
    rightVotes: match.rightVotes,
    upvoted: match.upvoted,
    excited: null,
    shot: null,
  });
  const timers = useRef<number[]>([]);
  const shotTimers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  };

  // 演出中に再度Upvoteされた場合、前回のフェーズ切り替えが新しい演出に割り込まないよう取り消してから開始する
  const startShot = (target: Side) => {
    shotTimers.current.forEach((id) => window.clearTimeout(id));
    const setPhase = (phase: NonNullable<BallShot>['phase'] | null) =>
      setState((s) => ({ ...s, shot: phase ? { target, phase } : null }));
    shotTimers.current = [
      later(BALL_FLIGHT_MS, () => setPhase('holding')),
      later(BALL_FLIGHT_MS + BALL_HOLD_MS, () => setPhase('returning')),
      later(BALL_FLIGHT_MS + BALL_HOLD_MS + BALL_RETURN_MS, () =>
        setPhase(null),
      ),
    ];
  };

  const upvote = (side: Side) => {
    if (!user) {
      onRequireLogin();
      return;
    }
    const applyDelta = (
      base: Interaction,
      target: Side,
      amount: number,
    ): Interaction =>
      target === 'left'
        ? { ...base, leftVotes: base.leftVotes + amount }
        : { ...base, rightVotes: base.rightVotes + amount };

    if (state.upvoted === side) {
      setState({ ...applyDelta(state, side, -1), upvoted: null });
      toast('Upvoteを取り消しました');
      return;
    }

    // 1ユーザー1マッチ1Upvoteのため、反対側へのUpvoteは付け替えになる
    const opposite: Side = side === 'left' ? 'right' : 'left';
    const base = state.upvoted ? applyDelta(state, state.upvoted, -1) : state;
    setState({
      ...applyDelta(base, side, 1),
      upvoted: side,
      excited: side,
      shot: { target: opposite, phase: 'flying' },
    });
    toast.success('Upvoteしました');
    startShot(opposite);
    later(EXCITED_MS, () => setState((s) => ({ ...s, excited: null })));
  };

  return { ...state, upvote };
}

export function MatchStage({
  match,
  isLive,
  user,
  variant,
  onRequireLogin,
}: Props) {
  const { leftVotes, rightVotes, upvoted, excited, shot, upvote } =
    useMatchInteraction(match, user, onRequireLogin);
  const winner = isLive
    ? null
    : matchWinner({ ...match, leftVotes, rightVotes });
  const tie = isLive && leftVotes === rightVotes && leftVotes > 0;
  const total = leftVotes + rightVotes;
  const leftRatio = total === 0 ? 0 : leftVotes / total;
  const leftColors = paletteColors(match.left.art.palette);
  const rightColors = paletteColors(match.right.art.palette);
  const isFinal = variant === 'final';

  const winnerLabel = (side: Side): string | null => {
    if (winner !== side) return null;
    return isFinal ? '優勝' : '勝利';
  };

  const disabledReason = (): string | null => {
    if (!isLive) return 'このマッチはUpvoteを受け付けていません。';
    if (match.isOwn)
      return '自身のプロダクトとその対戦相手にはUpvoteできません。';
    return null;
  };

  const pitchProps = {
    leftVotes,
    rightVotes,
    leftColors,
    rightColors,
    excited,
    finishedWinner: winner,
  };

  return (
    <div className="@container relative flex-1">
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <div className="hidden h-full w-full @[768px]:block">
          <StadiumPitch orientation="horizontal" {...pitchProps} />
        </div>
        <div className="h-full w-full bg-(--stand-base) @[768px]:hidden">
          <StadiumPitch orientation="vertical" {...pitchProps} />
        </div>
      </div>

      <div
        className={cn(
          'relative grid gap-4 @[768px]:grid-cols-[1fr_auto_1fr] @[768px]:items-center @[768px]:gap-2',
          isFinal
            ? 'mx-auto max-w-350 px-4 py-8 @[768px]:px-9 @[768px]:py-14 @[1200px]:px-14 @[1200px]:py-32'
            : 'px-3 py-8 @[768px]:px-5 @[768px]:py-4',
        )}
      >
        <ProductPanel
          product={match.left}
          side="left"
          votes={leftVotes}
          pressed={upvoted === 'left'}
          disabledReason={disabledReason()}
          onUpvote={() => upvote('left')}
          winnerLabel={winnerLabel('left')}
          isLoser={winner === 'right' || winner === 'none'}
          isFinal={isFinal}
        />

        <div className="flex min-h-0 flex-col items-center justify-center @max-[768px]:hidden">
          <span
            className={cn(
              'scoreboard-digits rounded-full border border-border/60 bg-card/85 px-3 py-1 text-sm text-muted-foreground backdrop-blur',
              isFinal &&
                'px-2 py-1 text-sm @[1200px]:px-4 @[1200px]:py-2 @[1200px]:text-xl',
            )}
            aria-hidden="true"
          >
            VS
          </span>
        </div>
        <VoteBar
          leftRatio={leftRatio}
          leftColor={leftColors[0]}
          rightColor={rightColors[0]}
          leftVotes={leftVotes}
          rightVotes={rightVotes}
          tie={tie}
          thick={isFinal}
          leftName={match.left.name}
          rightName={match.right.name}
          shot={shot}
          className="@[768px]:hidden"
        />

        <ProductPanel
          product={match.right}
          side="right"
          votes={rightVotes}
          pressed={upvoted === 'right'}
          disabledReason={disabledReason()}
          onUpvote={() => upvote('right')}
          winnerLabel={winnerLabel('right')}
          isLoser={winner === 'left' || winner === 'none'}
          isFinal={isFinal}
        />

        <div className="col-span-3 @max-[768px]:hidden">
          <VoteBar
            leftRatio={leftRatio}
            leftColor={leftColors[0]}
            rightColor={rightColors[0]}
            leftVotes={leftVotes}
            rightVotes={rightVotes}
            tie={tie}
            thick={isFinal}
            leftName={match.left.name}
            rightName={match.right.name}
            shot={shot}
          />
        </div>
      </div>
    </div>
  );
}
