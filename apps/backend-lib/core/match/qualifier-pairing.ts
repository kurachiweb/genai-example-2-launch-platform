export interface RandomSource {
  nextInt(exclusiveMax: number): number;
}

export interface PairingCandidate {
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly categoryId: string;
}

export type CandidatePair = readonly [PairingCandidate, PairingCandidate];

export interface PairingResult {
  readonly pairs: readonly CandidatePair[];
  readonly bye: PairingCandidate | null;
}

const UINT32_RANGE = 2 ** 32;

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < UINT32_RANGE;
}

// 2^32がexclusiveMaxで割り切れないと剰余の小さい値が出やすくなるため、端数の範囲の値を捨てて引き直す
export function createUniformRandomSource(
  nextUint32: () => number,
): RandomSource {
  return {
    nextInt(exclusiveMax) {
      if (
        !Number.isInteger(exclusiveMax) ||
        exclusiveMax < 1 ||
        exclusiveMax > UINT32_RANGE
      ) {
        throw new RangeError(
          `乱数の範囲の上限は1〜2^32の整数で指定してください: ${String(exclusiveMax)}`,
        );
      }
      const acceptedLimit = UINT32_RANGE - (UINT32_RANGE % exclusiveMax);
      for (;;) {
        const drawn = nextUint32();
        if (!isUint32(drawn)) {
          throw new RangeError(
            `32ビットの符号なし整数ではない乱数です: ${String(drawn)}`,
          );
        }
        if (drawn < acceptedLimit) {
          return drawn % exclusiveMax;
        }
      }
    },
  };
}

// Fisher–Yates(Durstenfeld)の並べ替え
function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = random.nextInt(index + 1);
    const current = result[index] as T;
    result[index] = result[swapIndex] as T;
    result[swapIndex] = current;
  }
  return result;
}

interface PairedGroup {
  readonly pairs: readonly CandidatePair[];
  readonly leftover: PairingCandidate | null;
}

function pairInOrder(ordered: readonly PairingCandidate[]): PairedGroup {
  const pairs: CandidatePair[] = [];
  for (let index = 0; index + 1 < ordered.length; index += 2) {
    pairs.push([
      ordered[index] as PairingCandidate,
      ordered[index + 1] as PairingCandidate,
    ]);
  }
  const leftover = ordered.length % 2 === 1 ? (ordered.at(-1) ?? null) : null;
  return { pairs, leftover };
}

export function pairQualifiers(
  candidates: readonly PairingCandidate[],
  random: RandomSource,
): PairingResult {
  const byCategory = Map.groupBy(candidates, (entry) => entry.categoryId);
  const categoryIds = [...byCategory.keys()].toSorted();
  const categoryGroups = categoryIds.map((categoryId) =>
    pairInOrder(shuffled(byCategory.get(categoryId) ?? [], random)),
  );
  const leftovers = categoryGroups.flatMap((group) =>
    group.leftover === null ? [] : [group.leftover],
  );
  const crossCategory = pairInOrder(shuffled(leftovers, random));
  return {
    pairs: [
      ...categoryGroups.flatMap((group) => group.pairs),
      ...crossCategory.pairs,
    ],
    bye: crossCategory.leftover,
  };
}
