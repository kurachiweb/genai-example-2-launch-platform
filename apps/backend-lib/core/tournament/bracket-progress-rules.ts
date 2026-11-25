import {
  type BracketShape,
  roundSlotCount,
  seedPlacementOrder,
} from './bracket-shape.ts';

export interface PlannedNode {
  readonly round: number;
  readonly position: number;
  readonly participants: readonly [number] | readonly [number, number];
}

export interface RecordedNode extends PlannedNode {
  readonly outcome:
    | { readonly kind: 'winner'; readonly participantNo: number }
    | { readonly kind: 'none' }
    | null;
}

export interface BracketState {
  readonly shape: BracketShape;
  readonly nodes: readonly RecordedNode[];
}

export type ProgressDecision =
  | { readonly kind: 'wait' }
  | {
      readonly kind: 'schedule';
      readonly round: number;
      readonly nodes: readonly PlannedNode[];
    }
  | { readonly kind: 'finish'; readonly championNo: number | null };

const FIRST_ROUND = 1;
const SECOND_ROUND = 2;
const FINAL_POSITION = 1;

const WAIT: ProgressDecision = { kind: 'wait' };

function finish(championNo: number | null): ProgressDecision {
  return { kind: 'finish', championNo };
}

function winnerOf(node: RecordedNode | undefined): number | null {
  if (node?.outcome?.kind !== 'winner') {
    return null;
  }
  const { participantNo } = node.outcome;
  if (!node.participants.includes(participantNo)) {
    throw new RangeError(
      `${String(node.round)}回戦の位置${String(node.position)}の勝者${String(participantNo)}はそのマッチの参加者ではありません`,
    );
  }
  return participantNo;
}

function winnerAt(
  state: BracketState,
  round: number,
  position: number,
): number | null {
  return winnerOf(
    state.nodes.find(
      (node) => node.round === round && node.position === position,
    ),
  );
}

// 2回戦はシード1〜Sに続けて1回戦の勝者を置き、3回戦以降は前ラウンドの位置kの勝者をk番の枠に置く
function occupantOfSlot(
  state: BracketState,
  round: number,
  slot: number,
): number | null {
  const { seedCount } = state.shape;
  if (round !== FIRST_ROUND) {
    return winnerAt(state, round, slot);
  }
  if (slot <= seedCount) {
    return slot;
  }
  return winnerAt(state, round, slot - seedCount);
}

export function nextRoundOccupants(
  state: BracketState,
  round: number,
): ReadonlyMap<number, number | null> {
  if (
    !Number.isInteger(round) ||
    round < FIRST_ROUND ||
    round >= state.shape.roundCount
  ) {
    throw new RangeError(
      `次ラウンドのあるラウンドを指定してください: ${String(round)}`,
    );
  }
  const slotCount = roundSlotCount(state.shape, round + 1);
  return new Map(
    Array.from({ length: slotCount }, (_, index) => {
      const slot = index + 1;
      return [slot, occupantOfSlot(state, round, slot)] as const;
    }),
  );
}

function slotOrder(round: number, slotCount: number): readonly number[] {
  if (round === SECOND_ROUND) {
    return seedPlacementOrder(slotCount);
  }
  return Array.from({ length: slotCount }, (_, index) => index + 1);
}

function pairedNode(
  round: number,
  position: number,
  occupants: readonly (number | null)[],
): PlannedNode | null {
  const [first, second] = occupants.filter(
    (occupant): occupant is number => occupant !== null,
  );
  if (first === undefined) {
    return null;
  }
  return {
    round,
    position,
    participants: second === undefined ? [first] : [first, second],
  };
}

function firstRoundNodes(shape: BracketShape): readonly PlannedNode[] {
  return Array.from({ length: shape.firstRoundMatchCount }, (_, index) => {
    const position = index + 1;
    return {
      round: FIRST_ROUND,
      position,
      participants: [
        shape.seedCount + position * 2 - 1,
        shape.seedCount + position * 2,
      ],
    };
  });
}

function decideWithoutRecords(shape: BracketShape): ProgressDecision {
  if (shape.roundCount === 0) {
    return finish(shape.participantCount === 1 ? 1 : null);
  }
  return {
    kind: 'schedule',
    round: FIRST_ROUND,
    nodes: firstRoundNodes(shape),
  };
}

function decideAfterRound(
  state: BracketState,
  round: number,
): ProgressDecision {
  if (round === state.shape.roundCount) {
    return finish(winnerAt(state, round, FINAL_POSITION));
  }
  const occupants = nextRoundOccupants(state, round);
  const remaining = [...occupants.values()].filter(
    (occupant): occupant is number => occupant !== null,
  );
  if (remaining.length <= 1) {
    return finish(remaining[0] ?? null);
  }
  const nextRound = round + 1;
  const order = slotOrder(nextRound, occupants.size);
  const nodes = Array.from({ length: order.length / 2 }, (_, index) =>
    pairedNode(
      nextRound,
      index + 1,
      order
        .slice(index * 2, index * 2 + 2)
        .map((slot) => occupants.get(slot) ?? null),
    ),
  ).filter((node): node is PlannedNode => node !== null);
  return { kind: 'schedule', round: nextRound, nodes };
}

export function decideNext(state: BracketState): ProgressDecision {
  if (state.nodes.length === 0) {
    return decideWithoutRecords(state.shape);
  }
  const currentRound = Math.max(...state.nodes.map(({ round }) => round));
  const current = state.nodes.filter(({ round }) => round === currentRound);
  if (current.some(({ outcome }) => outcome === null)) {
    return WAIT;
  }
  for (const node of current) {
    winnerOf(node);
  }
  return decideAfterRound(state, currentRound);
}
