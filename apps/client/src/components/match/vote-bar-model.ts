import type { PitchSide } from './pitch-model.ts';

export const BALL_FLIGHT_MS = 400;
export const BALL_HOLD_MS = 1000;
export const BALL_RETURN_MS = 2500;

// Upvoteの演出のボール。targetはボールが飛び込む側(Upvoteしたプロダクトの反対側)
export type BallShot = {
  readonly target: PitchSide;
  readonly phase: 'flying' | 'holding' | 'returning';
} | null;

export type VoteShare = {
  readonly isEmpty: boolean;
  readonly leftRatio: number;
};

export type BallTransition = {
  readonly durationMs: number;
  readonly easing: string;
};

const EMPTY_BOUNDARY = 0.5;

export function voteShareOf(leftVotes: number, rightVotes: number): VoteShare {
  const total = leftVotes + rightVotes;
  return total === 0
    ? { isEmpty: true, leftRatio: EMPTY_BOUNDARY }
    : { isEmpty: false, leftRatio: leftVotes / total };
}

export function ballPositionOf(shot: BallShot, boundary: number): number {
  const isAtGoal = shot?.phase === 'flying' || shot?.phase === 'holding';
  if (!isAtGoal) {
    return boundary;
  }
  return shot.target === 'left' ? 0 : 1;
}

export function ballTransitionOf(shot: BallShot): BallTransition {
  return shot?.phase === 'returning'
    ? { durationMs: BALL_RETURN_MS, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' }
    : { durationMs: BALL_FLIGHT_MS, easing: 'cubic-bezier(0.5, 0, 1, 1)' };
}
