import { stageForSlotCount } from '../../../common-lib/tournament/round-name.ts';
import type { MatchStage } from '../match/match-model.ts';

export interface BracketShape {
  readonly participantCount: number;
  readonly secondRoundSize: number;
  readonly seedCount: number;
  readonly firstRoundMatchCount: number;
  readonly roundCount: number;
}

const MIN_PARTICIPANTS_FOR_MATCH = 2;

export function bracketShape(participantCount: number): BracketShape {
  if (!Number.isSafeInteger(participantCount) || participantCount < 0) {
    throw new RangeError(
      `参加数は0以上の整数で指定してください: ${String(participantCount)}`,
    );
  }
  if (participantCount < MIN_PARTICIPANTS_FOR_MATCH) {
    return {
      participantCount,
      secondRoundSize: 0,
      seedCount: 0,
      firstRoundMatchCount: 0,
      roundCount: 0,
    };
  }
  let secondRoundSize = 1;
  let roundCount = 1;
  while (secondRoundSize * 2 < participantCount) {
    secondRoundSize *= 2;
    roundCount += 1;
  }
  const seedCount = secondRoundSize * 2 - participantCount;
  return {
    participantCount,
    secondRoundSize,
    seedCount,
    firstRoundMatchCount: (participantCount - seedCount) / 2,
    roundCount,
  };
}

export function roundSlotCount(shape: BracketShape, round: number): number {
  if (!Number.isInteger(round) || round < 1 || round > shape.roundCount) {
    throw new RangeError(
      `ラウンドは1以上${String(shape.roundCount)}以下の整数で指定してください: ${String(round)}`,
    );
  }
  if (round === 1) {
    return shape.participantCount;
  }
  return shape.secondRoundSize / 2 ** (round - 2);
}

export function roundStage(
  shape: BracketShape,
  round: number,
): MatchStage | null {
  return stageForSlotCount(roundSlotCount(shape, round));
}

function isPowerOfTwo(size: number): boolean {
  if (!Number.isSafeInteger(size) || size < 1) {
    return false;
  }
  let power = 1;
  while (power < size) {
    power *= 2;
  }
  return power === size;
}

// 長さを倍にするたびに、各番号の直後へ「新しい長さ+1−その番号」を挿入する
export function seedPlacementOrder(size: number): readonly number[] {
  if (!isPowerOfTwo(size)) {
    throw new RangeError(
      `枠の数は1以上の2の冪で指定してください: ${String(size)}`,
    );
  }
  let order: readonly number[] = [1];
  while (order.length < size) {
    const pairSum = order.length * 2 + 1;
    order = order.flatMap((slot) => [slot, pairSum - slot]);
  }
  return order;
}
