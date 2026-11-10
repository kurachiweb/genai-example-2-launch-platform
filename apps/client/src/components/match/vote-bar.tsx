import type { CSSProperties } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import { voteBarLabel } from './match-labels.ts';
import { SoccerBall } from './soccer-ball.tsx';
import {
  ballPositionOf,
  ballTransitionOf,
  voteShareOf,
} from './vote-bar-model.ts';
import type { BallShot } from './vote-bar-model.ts';

type VoteBarProps = {
  readonly leftName: string;
  readonly rightName: string;
  readonly leftVotes: number;
  readonly rightVotes: number;
  readonly leftColor: string;
  readonly rightColor: string;
  readonly isThick?: boolean;
  readonly shot?: BallShot;
  readonly className?: string;
};

export function VoteBar({
  leftName,
  rightName,
  leftVotes,
  rightVotes,
  leftColor,
  rightColor,
  isThick = false,
  shot = null,
  className,
}: VoteBarProps) {
  const { isEmpty, leftRatio } = voteShareOf(leftVotes, rightVotes);
  const transition = ballTransitionOf(shot);
  // 演出を動かせるかは祖先の属性と視差効果を減らす設定でCSSが決めるため、止まった時の位置と動く時の位置を両方渡す
  const trackStyle = {
    '--ball-rest': leftRatio,
    '--ball-at': ballPositionOf(shot, leftRatio),
    '--ball-duration': `${String(transition.durationMs)}ms`,
    '--ball-easing': transition.easing,
  } as CSSProperties;

  return (
    <div className={cn('relative', className)}>
      <div
        role="img"
        aria-label={voteBarLabel({
          leftName,
          leftVotes,
          rightName,
          rightVotes,
        })}
        className={cn(
          'flex w-full overflow-hidden rounded-full border border-border/60 bg-card/80 backdrop-blur-sm',
          isThick ? 'h-4' : 'h-2.5',
        )}
      >
        {!isEmpty && (
          <>
            <div
              data-vote-bar-fill=""
              className="h-full"
              style={{
                width: `${String(leftRatio * 100)}%`,
                backgroundColor: leftColor,
              }}
            />
            <div
              data-vote-bar-fill=""
              className="h-full flex-1"
              style={{ backgroundColor: rightColor }}
            />
          </>
        )}
      </div>
      {/* バーと同じ幅のトラックをtranslateXすることで、ボールをバーの幅に対する割合の位置に置く */}
      <div
        data-vote-ball-track=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-full"
        style={trackStyle}
      >
        <div
          data-vote-ball=""
          data-flying={shot?.phase === 'flying' ? 'true' : 'false'}
          className={cn(
            'absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 drop-shadow-sm',
            isThick ? 'size-8' : 'size-5',
          )}
        >
          <div data-vote-ball-spin="" className="size-full">
            <div data-vote-ball-spin-fast="" className="size-full">
              <SoccerBall />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
