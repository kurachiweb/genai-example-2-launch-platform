import { inject, injectable } from 'inversify';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { CommentThreadQuery } from '../../../lib/core/engagement/ports.ts';
import type { DirectoryItemMetricSource } from '../directory/item-metric-sources.ts';

// ディレクトリの一覧の項目の「コメント◯件」。コメントの無いプロダクトにも0件を示すため0で補う
@injectable()
export class ThreadQueryCommentCountMetricSource implements DirectoryItemMetricSource {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentThreadQuery)
    private readonly threads: CommentThreadQuery,
  ) {}

  async metrics(input: {
    readonly productIds: readonly string[];
    readonly at: Date;
  }): Promise<ReadonlyMap<string, number>> {
    const counts = await this.threads.countsByProduct(input.productIds);
    return new Map(
      input.productIds.map((productId) => [
        productId,
        counts.get(productId) ?? 0,
      ]),
    );
  }
}
