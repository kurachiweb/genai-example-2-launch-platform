import { useEffect, useRef, useState } from 'react';

import type { PitchSide } from './pitch-model.ts';
import {
  BALL_FLIGHT_MS,
  BALL_HOLD_MS,
  BALL_RETURN_MS,
} from './vote-bar-model.ts';
import type { BallShot } from './vote-bar-model.ts';

const EXCITED_MS = 5000;

export interface UpvoteCelebrationInput {
  readonly leftEntryId: string;
  readonly rightEntryId: string;
  readonly upvotedEntryId: string | null;
}

export interface UpvoteCelebration {
  readonly excited: PitchSide | null;
  readonly shot: BallShot;
}

const oppositeOf = (side: PitchSide): PitchSide =>
  side === 'left' ? 'right' : 'left';

const sideOf = (
  entryId: string | null,
  leftEntryId: string,
  rightEntryId: string,
): PitchSide | null => {
  if (entryId === leftEntryId) {
    return 'left';
  }
  return entryId === rightEntryId ? 'right' : null;
};

// 閲覧者のUpvoteがサーバーの結果として別の側へ移った時だけ、その側の観客を盛り上げ、ボールを相手のゴールへ飛ばす。取り消しや次のUpvoteが反映されると演出を終える。演出を動かすかはCSSが祖先の属性と視差効果を減らす設定で決める
export function useUpvoteCelebration({
  leftEntryId,
  rightEntryId,
  upvotedEntryId,
}: UpvoteCelebrationInput): UpvoteCelebration {
  const [excited, setExcited] = useState<PitchSide | null>(null);
  const [shot, setShot] = useState<BallShot>(null);
  const previousRef = useRef(upvotedEntryId);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = upvotedEntryId;
    const side = sideOf(upvotedEntryId, leftEntryId, rightEntryId);
    if (upvotedEntryId === previous || side === null) {
      return undefined;
    }
    const target = oppositeOf(side);
    setShot({ target, phase: 'flying' });
    // ゴールへ飛ばした後、ゴールで止め、比率の境目へ戻して演出を終える
    const holdTimer = window.setTimeout(() => {
      setShot({ target, phase: 'holding' });
    }, BALL_FLIGHT_MS);
    const returnTimer = window.setTimeout(() => {
      setShot({ target, phase: 'returning' });
    }, BALL_FLIGHT_MS + BALL_HOLD_MS);
    const restTimer = window.setTimeout(
      () => {
        setShot(null);
      },
      BALL_FLIGHT_MS + BALL_HOLD_MS + BALL_RETURN_MS,
    );
    let excitedTimer: number | undefined;
    // 同じ側が続けて盛り上がる場合もCSSのアニメーションをやり直させるため、止めた状態を描画した次のフレームで盛り上げる
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        setExcited(side);
        excitedTimer = window.setTimeout(() => {
          setExcited(null);
        }, EXCITED_MS);
      });
    });
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(returnTimer);
      window.clearTimeout(restTimer);
      window.clearTimeout(excitedTimer);
      window.cancelAnimationFrame(frame);
      setShot(null);
      setExcited(null);
    };
  }, [leftEntryId, rightEntryId, upvotedEntryId]);

  return { excited, shot };
}
