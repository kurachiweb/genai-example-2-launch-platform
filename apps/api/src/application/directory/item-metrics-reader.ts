import { inject, injectable } from 'inversify';

import { DIRECTORY_PAGE_SIZE } from '../../../common-lib/directory/directory-query-rules.ts';
import { callDecisionSources } from '../product/decision-sources.ts';
import { DIRECTORY_TYPES } from './directory-types.ts';
import type { RegisteredItemMetricSource } from './item-metric-sources.ts';

// 供給元へ1回に渡すプロダクトの数の上限。一覧の1ページの件数に合わせる
export const ITEM_METRICS_BATCH_MAX = DIRECTORY_PAGE_SIZE;

export interface ItemMetric {
  readonly key: string;
  readonly value: number;
}

export interface ItemMetricsReader {
  // productId → 登録の順の値。渡した全てのプロダクトを持ち、供給元の失敗はその値だけを欠落させる。上限を超えるプロダクトはRangeError
  read(
    productIds: readonly string[],
    at: Date,
  ): Promise<ReadonlyMap<string, readonly ItemMetric[]>>;
}

interface KeyedMetrics {
  readonly key: string;
  readonly values: ReadonlyMap<string, number>;
}

@injectable()
export class SourcedItemMetricsReader implements ItemMetricsReader {
  constructor(
    @inject(DIRECTORY_TYPES.ItemMetricSources)
    private readonly sources: readonly RegisteredItemMetricSource[],
  ) {}

  async read(
    productIds: readonly string[],
    at: Date,
  ): Promise<ReadonlyMap<string, readonly ItemMetric[]>> {
    if (productIds.length > ITEM_METRICS_BATCH_MAX) {
      throw new RangeError(
        `一覧の項目の値は1回に${String(ITEM_METRICS_BATCH_MAX)}件までのプロダクトで読んでください: ${String(productIds.length)}`,
      );
    }
    const results = await this.#collect(productIds, at);
    return new Map(
      productIds.map((productId) => [
        productId,
        results.flatMap(({ key, values }) => {
          const value = values.get(productId);
          return value === undefined ? [] : [{ key, value }];
        }),
      ]),
    );
  }

  async #collect(
    productIds: readonly string[],
    at: Date,
  ): Promise<readonly KeyedMetrics[]> {
    if (productIds.length === 0 || this.sources.length === 0) {
      return [];
    }
    const { results } = await callDecisionSources(
      this.sources.map(({ name, key, source }) => ({
        name,
        source: { key, source },
      })),
      async ({ key, source }): Promise<KeyedMetrics> => ({
        key,
        values: await source.metrics({ productIds, at }),
      }),
    );
    return results;
  }
}
