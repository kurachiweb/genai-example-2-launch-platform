import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { resolveProductPage } from '../directory/product-page-resolution.ts';
import { callDecisionSources } from '../product/decision-sources.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../week-tournament/week-tournament-api-types.ts';
import type {
  RegisteredTrophySource,
  TrophyKind,
  TrophyRecord,
} from './trophy-source.ts';

export interface ProductTrophyReader {
  // 詳細ページの公開範囲で見えなければnull。Yearを先頭に、同じ種類は受賞の新しい順
  read(
    productHandle: string,
    viewer: CurrentUser | undefined,
  ): Promise<readonly TrophyRecord[] | null>;
}

const KIND_RANK: Readonly<Record<TrophyKind, number>> = {
  year: 0,
  week: 1,
};

const compareTrophies = (left: TrophyRecord, right: TrophyRecord): number =>
  KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
  right.awardedAt.getTime() - left.awardedAt.getTime() ||
  right.period.localeCompare(left.period);

@injectable()
export class SourcedProductTrophyReader implements ProductTrophyReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(WEEK_TOURNAMENT_API_TYPES.TrophySources)
    private readonly sources: readonly RegisteredTrophySource[],
  ) {}

  async read(
    productHandle: string,
    viewer: CurrentUser | undefined,
  ): Promise<readonly TrophyRecord[] | null> {
    const resolution = await resolveProductPage(
      this.products,
      productHandle,
      viewer,
    );
    if (resolution.kind !== 'render') {
      return null;
    }
    if (this.sources.length === 0) {
      return [];
    }
    const { productId } = resolution.product;
    const { results } = await callDecisionSources(this.sources, (source) =>
      source.listTrophies(productId),
    );
    return results.flat().toSorted(compareTrophies);
  }
}
