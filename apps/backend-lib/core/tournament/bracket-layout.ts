import {
  type BracketShape,
  roundSlotCount,
  seedPlacementOrder,
} from './bracket-shape.ts';

export type SlotFeed =
  | { readonly kind: 'participant'; readonly participantNo: number }
  | {
      readonly kind: 'winner_of';
      readonly round: number;
      readonly position: number;
    };

export interface LayoutNode {
  readonly round: number;
  readonly position: number;
  readonly feeds: readonly [SlotFeed, SlotFeed];
}

const FIRST_ROUND = 1;
const SECOND_ROUND = 2;

function participant(participantNo: number): SlotFeed {
  return { kind: 'participant', participantNo };
}

function winnerOf(round: number, position: number): SlotFeed {
  return { kind: 'winner_of', round, position };
}

function firstRoundNodes(shape: BracketShape): readonly LayoutNode[] {
  return Array.from({ length: shape.firstRoundMatchCount }, (_, index) => {
    const position = index + 1;
    return {
      round: FIRST_ROUND,
      position,
      feeds: [
        participant(shape.seedCount + position * 2 - 1),
        participant(shape.seedCount + position * 2),
      ],
    };
  });
}

// 2回戦の枠iは、i ≤ Sならシードi、i > Sなら1回戦の位置i−Sの勝者
function secondRoundFeed(shape: BracketShape, slot: number): SlotFeed {
  if (slot <= shape.seedCount) {
    return participant(slot);
  }
  return winnerOf(FIRST_ROUND, slot - shape.seedCount);
}

function secondRoundNodes(shape: BracketShape): readonly LayoutNode[] {
  const order = seedPlacementOrder(shape.secondRoundSize);
  return Array.from({ length: order.length / 2 }, (_, index) => {
    const [first = 0, second = 0] = order.slice(index * 2, index * 2 + 2);
    return {
      round: SECOND_ROUND,
      position: index + 1,
      feeds: [secondRoundFeed(shape, first), secondRoundFeed(shape, second)],
    };
  });
}

function laterRoundNodes(
  shape: BracketShape,
  round: number,
): readonly LayoutNode[] {
  const previousRound = round - 1;
  return Array.from(
    { length: roundSlotCount(shape, round) / 2 },
    (_, index) => {
      const position = index + 1;
      return {
        round,
        position,
        feeds: [
          winnerOf(previousRound, position * 2 - 1),
          winnerOf(previousRound, position * 2),
        ],
      };
    },
  );
}

function roundNodes(shape: BracketShape, round: number): readonly LayoutNode[] {
  if (round === FIRST_ROUND) {
    return firstRoundNodes(shape);
  }
  if (round === SECOND_ROUND) {
    return secondRoundNodes(shape);
  }
  return laterRoundNodes(shape, round);
}

export function bracketLayout(shape: BracketShape): readonly LayoutNode[] {
  return Array.from({ length: shape.roundCount }, (_, index) =>
    roundNodes(shape, index + 1),
  ).flat();
}
