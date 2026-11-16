import { type BracketShape, bracketShape } from './bracket-shape.ts';

export type Comparator<T> = (a: T, b: T) => number;

export interface DrawCandidate<T> {
  readonly ref: string;
  readonly tieBreaker: string;
  readonly value: T;
}

export interface DrawnParticipant {
  readonly ref: string;
  readonly participantNo: number;
}

export interface DrawOrder<T> {
  readonly seed: Comparator<T>;
  readonly nonSeed: Comparator<T>;
}

export interface BracketDrawResult {
  readonly shape: BracketShape;
  readonly participants: readonly DrawnParticipant[];
}

// 実行環境の照合順序に左右されないよう、符号単位で比べる
function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function sortCandidates<T>(
  candidates: readonly DrawCandidate<T>[],
  compare: Comparator<T>,
): readonly DrawCandidate<T>[] {
  return [...candidates].sort(
    (a, b) =>
      compare(a.value, b.value) ||
      compareCodeUnits(a.tieBreaker, b.tieBreaker) ||
      compareCodeUnits(a.ref, b.ref),
  );
}

function assertUniqueRefs<T>(candidates: readonly DrawCandidate<T>[]): void {
  const refs = new Set<string>();
  for (const { ref } of candidates) {
    if (refs.has(ref)) {
      throw new RangeError(`候補のrefが重複しています: ${ref}`);
    }
    refs.add(ref);
  }
}

export function drawBracket<T>(
  candidates: readonly DrawCandidate<T>[],
  order: DrawOrder<T>,
): BracketDrawResult {
  assertUniqueRefs(candidates);
  const shape = bracketShape(candidates.length);
  const bySeedOrder = sortCandidates(candidates, order.seed);
  const seeds = bySeedOrder.slice(0, shape.seedCount);
  const nonSeeds = sortCandidates(
    bySeedOrder.slice(shape.seedCount),
    order.nonSeed,
  );
  return {
    shape,
    participants: [...seeds, ...nonSeeds].map(({ ref }, index) => ({
      ref,
      participantNo: index + 1,
    })),
  };
}
