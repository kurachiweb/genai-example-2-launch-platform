export interface CapacityCandidate {
  readonly ref: string;
  readonly awardedAt: Date;
  readonly tieBreaker: string;
}

export interface CapacitySelection<T extends CapacityCandidate> {
  readonly kept: readonly T[];
  readonly overflow: readonly T[];
}

// 実行環境の照合順序に左右されないよう、符号単位で比べる
function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function byAwardedAtDescending(
  a: CapacityCandidate,
  b: CapacityCandidate,
): number {
  return (
    b.awardedAt.getTime() - a.awardedAt.getTime() ||
    compareCodeUnits(a.tieBreaker, b.tieBreaker) ||
    compareCodeUnits(a.ref, b.ref)
  );
}

export function selectWithinCapacity<T extends CapacityCandidate>(
  entries: readonly T[],
  max: number,
): CapacitySelection<T> {
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new RangeError(`上限は0以上の整数で指定してください: ${String(max)}`);
  }
  const ordered = [...entries].sort(byAwardedAtDescending);
  return Object.freeze({
    kept: ordered.slice(0, max),
    overflow: ordered.slice(max),
  });
}
