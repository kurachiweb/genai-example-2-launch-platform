import { inject, injectable } from 'inversify';

import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  LaunchRecord,
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { canViewProduct } from '../../domain/engagement/engagement-access.ts';

export interface EngagementTarget {
  readonly product: ProductSummaryRecord;
  // 指定したローンチが別のプロダクトのもの・取消・存在しなければundefined
  readonly launch: LaunchRecord | undefined;
  readonly viewerIsOwner: boolean;
}

export interface EngagementTargetInput {
  readonly productId: string;
  readonly launchId?: string;
  readonly viewerUserId: string | undefined;
  readonly now: Date;
}

export interface EngagementTargetResolver {
  // 閲覧できなければundefined
  resolve(input: EngagementTargetInput): Promise<EngagementTarget | undefined>;
}

const NO_LAUNCHES: ReadonlyMap<string, readonly LaunchRecord[]> = new Map();

@injectable()
export class DirectoryEngagementTargetResolver implements EngagementTargetResolver {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async resolve(
    input: EngagementTargetInput,
  ): Promise<EngagementTarget | undefined> {
    const { productId, launchId, viewerUserId, now } = input;
    const [summaries, launches] = await Promise.all([
      this.products.findSummaries([productId], 'visible'),
      launchId === undefined
        ? NO_LAUNCHES
        : this.products.listLaunches([productId], now),
    ]);
    const product = summaries.get(productId);
    if (product === undefined || !canViewProduct(product, viewerUserId)) {
      return undefined;
    }
    return {
      product,
      launch: (launches.get(productId) ?? []).find(
        (launch) =>
          launch.launchId === launchId &&
          launch.productId === productId &&
          launch.status !== 'canceled',
      ),
      viewerIsOwner: product.ownerUserId === viewerUserId,
    };
  }
}
