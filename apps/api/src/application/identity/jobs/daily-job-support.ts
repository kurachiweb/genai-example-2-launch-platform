export const HOUR_MS = 3_600_000;

export const DAY_MS = 24 * HOUR_MS;

export class IdentityDailyJobError extends Error {
  override readonly name = 'IdentityDailyJobError';
}

export interface LimitedBatch<T> {
  readonly targets: readonly T[];
  readonly hasMore: boolean;
}

// 残りの有無を知るために上限より1件多く照会し、先頭の上限件数だけを扱う
export async function limitedBatch<T>(
  limit: number,
  find: (limit: number) => Promise<readonly T[]>,
): Promise<LimitedBatch<T>> {
  const candidates = await find(limit + 1);
  return {
    targets: candidates.slice(0, limit),
    hasMore: candidates.length > limit,
  };
}

// ストアは期限を「より前」で比べるため、ちょうど1時間前の記録も含めるよう1ミリ秒後を渡す
export function atLeastOneHourBefore(scheduledTime: Date): Date {
  return new Date(scheduledTime.getTime() - HOUR_MS + 1);
}

// 1件の失敗で残りの処理を止めず、失敗はまとめて1件の例外にしてディスパッチャからエラートラッキングへ送る
export function throwIfFailed(
  errors: readonly unknown[],
  message: string,
): void {
  if (errors.length > 0) {
    throw new IdentityDailyJobError(message, { cause: errors[0] });
  }
}
