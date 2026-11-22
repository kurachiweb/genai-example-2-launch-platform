export const DATA_EXPORT_JOB_BATCH_SIZE = 100;

export const DATA_EXPORT_JOB_MAX_BATCHES = 10;

export type DrainOutcome = 'resolved' | 'retained';

export interface DrainSummary {
  readonly handled: number;
  readonly retained: number;
  readonly batches: number;
  readonly limitReached: boolean;
}

// 4:21の起動の時間の予算を他の機能のジョブと共有するため、1回の起動で処理する件数に上限を置き、残りは翌日の起動に任せる
export async function drainInBatches<T extends { readonly id: string }>(input: {
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly list: (limit: number) => Promise<readonly T[]>;
  readonly handle: (item: T) => Promise<DrainOutcome>;
}): Promise<DrainSummary> {
  const seen = new Set<string>();
  let retained = 0;
  let batches = 0;
  let limitReached = false;
  while (batches < input.maxBatches) {
    // 失敗して読み取りに残り続ける項目が先頭を埋めても後ろの項目へ進めるよう、残った件数だけ読む件数を増やす
    const limit = input.batchSize + retained;
    const items = await input.list(limit);
    batches += 1;
    const fresh = items.filter(({ id }) => !seen.has(id));
    for (const item of fresh) {
      seen.add(item.id);
      if ((await input.handle(item)) === 'retained') {
        retained += 1;
      }
    }
    if (fresh.length === 0 || items.length < limit) {
      break;
    }
    limitReached = batches === input.maxBatches;
  }
  return { handled: seen.size, retained, batches, limitReached };
}
