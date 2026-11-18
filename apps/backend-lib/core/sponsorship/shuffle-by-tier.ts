const UINT32_RANGE = 2 ** 32;

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < UINT32_RANGE;
}

function assertBound(bound: number): void {
  if (!Number.isInteger(bound) || bound < 1 || bound > UINT32_RANGE) {
    throw new RangeError(
      `乱数の範囲の上限は1〜2^32の整数で指定してください: ${String(bound)}`,
    );
  }
}

// 2^32がboundで割り切れないと剰余の小さい値が出やすくなるため、端数の範囲の値を捨てて引き直す
export function createUniformRandom(
  nextUint32: () => number,
): (bound: number) => number {
  return (bound) => {
    assertBound(bound);
    const acceptedLimit = UINT32_RANGE - (UINT32_RANGE % bound);
    for (;;) {
      const drawn = nextUint32();
      if (!isUint32(drawn)) {
        throw new RangeError(
          `32ビットの符号なし整数ではない乱数です: ${String(drawn)}`,
        );
      }
      if (drawn < acceptedLimit) {
        return drawn % bound;
      }
    }
  };
}

function assertDrawn(value: number, bound: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= bound) {
    throw new RangeError(
      `乱数は0以上${String(bound)}未満の整数で返してください: ${String(value)}`,
    );
  }
}

// Fisher–Yates(Durstenfeld)の並べ替え。randomは0以上bound未満の整数を返す
export function shuffleByTier<T>(
  items: readonly T[],
  random: (bound: number) => number,
): readonly T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = random(index + 1);
    assertDrawn(swapIndex, index + 1);
    const current = result[index] as T;
    result[index] = result[swapIndex] as T;
    result[swapIndex] = current;
  }
  return result;
}
