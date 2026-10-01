import { SoccerBallArt } from '#/components/client/art';
import type { Side } from '#/components/client/stadium-pitch/stadium-pitch';
import { Badge } from '#/components/ui/badge';
import { cn } from '#/lib/utils';

export const BALL_FLIGHT_MS = 400;
export const BALL_HOLD_MS = 1000;
export const BALL_RETURN_MS = 2500;

// Upvote時のボール演出。targetはボールが飛び込む側(Upvoteしたプロダクトの反対側)
export type BallShot = {
  target: Side;
  phase: 'flying' | 'holding' | 'returning';
} | null;

type Props = {
  leftRatio: number;
  leftColor: string;
  rightColor: string;
  leftVotes: number;
  rightVotes: number;
  tie: boolean;
  thick: boolean;
  leftName: string;
  rightName: string;
  shot: BallShot;
  className?: string;
};

export function VoteBar({
  leftRatio,
  leftColor,
  rightColor,
  leftVotes,
  rightVotes,
  tie,
  thick,
  leftName,
  rightName,
  shot,
  className = '',
}: Props) {
  const empty = leftVotes + rightVotes === 0;
  const boundary = empty ? 0.5 : leftRatio;
  const atEnd = shot?.phase === 'flying' || shot?.phase === 'holding';
  const ballPosition = atEnd ? (shot.target === 'left' ? 0 : 1) : boundary;
  const ballTransition =
    shot?.phase === 'returning'
      ? `transform ${BALL_RETURN_MS}ms cubic-bezier(0.45, 0, 0.2, 1)`
      : `transform ${BALL_FLIGHT_MS}ms cubic-bezier(0.5, 0, 1, 1)`;

  return (
    <div className={`relative ${className}`}>
      <div
        role="img"
        aria-label={`Upvote数の比率: ${leftName} ${leftVotes}対${rightVotes} ${rightName}`}
        className={cn(
          'flex w-full overflow-hidden rounded-full border border-border/60 bg-card/80 backdrop-blur-sm',
          thick ? 'h-4' : 'h-2.5',
          tie && 'tie-pulse',
        )}
      >
        {!empty && (
          <>
            <div
              className="h-full transition-[width] duration-700 ease-out"
              style={{
                width: `${leftRatio * 100}%`,
                backgroundColor: leftColor,
              }}
            />
            <div
              className="h-full flex-1"
              style={{ backgroundColor: rightColor }}
            />
          </>
        )}
      </div>
      {/* バーと同じ幅のトラックをtranslateXすることで、ボールをバー幅に対する割合の位置に置く */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-full"
        style={{
          transform: `translateX(${ballPosition * 100}%)`,
          transition: ballTransition,
        }}
      >
        <div
          className={cn(
            'vote-ball absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 drop-shadow-sm',
            thick ? 'size-8' : 'size-5',
          )}
          data-flying={shot?.phase === 'flying' ? 'true' : 'false'}
        >
          <div className="vote-ball-spin size-full">
            <div className="vote-ball-spin-fast size-full">
              <SoccerBallArt />
            </div>
          </div>
        </div>
      </div>
      {tie && (
        <Badge className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-0 bg-primary text-primary-foreground shadow-md">
          同点
        </Badge>
      )}
    </div>
  );
}
