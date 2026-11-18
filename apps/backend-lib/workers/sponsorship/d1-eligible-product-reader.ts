import { inject, injectable } from 'inversify';

import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type { LaunchStatus } from '../../core/product/launch-status.ts';
import type {
  LaunchExport,
  ProductDirectory,
  ProductSummaryRecord,
} from '../../core/product/ports.ts';
import type {
  EligibleProduct,
  EligibleProductReader,
} from '../../core/sponsorship/ports.ts';

const KICKED_OFF_STATUSES: ReadonlySet<LaunchStatus> = new Set([
  'in_progress',
  'finished',
]);

const nameCollator = new Intl.Collator('ja');

function isOwnedBy(
  summary: ProductSummaryRecord | undefined,
  userId: string,
): summary is ProductSummaryRecord {
  return summary !== undefined && summary.ownerUserId === userId;
}

function toEligibleProduct(summary: ProductSummaryRecord): EligibleProduct {
  return {
    productId: summary.productId,
    handle: summary.handle,
    name: summary.name,
    logoFileId: summary.logoFileId,
  };
}

function compareByName(left: EligibleProduct, right: EligibleProduct): number {
  return (
    nameCollator.compare(left.name, right.name) ||
    (left.productId < right.productId ? -1 : 1)
  );
}

@injectable()
export class D1EligibleProductReader implements EligibleProductReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.LaunchExport)
    private readonly launches: LaunchExport,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async list(userId: string, now: Date): Promise<readonly EligibleProduct[]> {
    const launches = await this.launches.listByUser(userId, now);
    const productIds = new Set(
      launches
        .filter(({ status }) => KICKED_OFF_STATUSES.has(status))
        .map(({ productId }) => productId),
    );
    if (productIds.size === 0) {
      return [];
    }
    const summaries = await this.products.findSummaries(
      [...productIds],
      'visible',
    );
    return [...summaries.values()]
      .filter((summary) => isOwnedBy(summary, userId))
      .map(toEligibleProduct)
      .toSorted(compareByName);
  }

  async isEligible(
    userId: string,
    productId: string,
    now: Date,
  ): Promise<boolean> {
    const summaries = await this.products.findSummaries([productId], 'visible');
    if (!isOwnedBy(summaries.get(productId), userId)) {
      return false;
    }
    const launches = await this.products.listLaunches([productId], now);
    return (launches.get(productId) ?? []).some(({ status }) =>
      KICKED_OFF_STATUSES.has(status),
    );
  }
}
