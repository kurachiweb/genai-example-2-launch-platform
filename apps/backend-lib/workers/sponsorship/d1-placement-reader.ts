import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import { visibleProducts } from '../../../db/schema/product/visibility.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../core/product/ports.ts';
import type {
  PlacedAd,
  PlacementReader,
} from '../../core/sponsorship/ports.ts';
import {
  createUniformRandom,
  shuffleByTier,
} from '../../core/sponsorship/shuffle-by-tier.ts';
import { toBusinessDateTime } from '../../core/time/business-time.ts';

type PlacementsByTier = Readonly<Record<SponsorshipTier, readonly PlacedAd[]>>;

// 1要素の配列から必ず値が取れる。取れなければNaNを渡し、棄却法の部品の検証で例外にする
function nextUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1)).at(0) ?? Number.NaN;
}

// 広告主が表示の順を予測して狙えないよう、暗号論的な乱数を偏り無く使う
const randomBelow = createUniformRandom(nextUint32);

function groupByTierInRandomOrder(
  placed: readonly PlacedAd[],
): PlacementsByTier {
  const shuffledOf = (tier: SponsorshipTier): readonly PlacedAd[] =>
    shuffleByTier(
      placed.filter((ad) => ad.tier === tier),
      randomBelow,
    );
  return Object.freeze({
    legend: shuffledOf('legend'),
    gold: shuffledOf('gold'),
    silver: shuffledOf('silver'),
  });
}

@injectable()
export class D1PlacementReader implements PlacementReader {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
  ) {}

  async read(now: Date): Promise<PlacementsByTier> {
    const rows = await this.findPlacedRows(now);
    const summaries = await this.findVisibleSummaries(
      rows.map(({ productId }) => productId),
    );
    // 申込の照会の後に可視でなくなったプロダクトは要約が返らないため除く
    const placed = rows.flatMap(({ sponsorshipId, tier, productId }) => {
      const product = summaries.get(productId);
      return product === undefined ? [] : [{ sponsorshipId, tier, product }];
    });
    return groupByTierInRandomOrder(placed);
  }

  private async findPlacedRows(now: Date) {
    const today = toBusinessDateTime(now).date;
    return this.db
      .select({
        sponsorshipId: sponsorships.id,
        tier: sponsorships.tier,
        productId: sponsorships.productId,
      })
      .from(sponsorships)
      .innerJoin(products, eq(products.id, sponsorships.productId))
      .innerJoin(users, eq(users.id, products.userId))
      .where(
        and(
          eq(sponsorships.state, 'paid'),
          isNull(sponsorships.deletedAt),
          lte(sponsorships.startsOn, today),
          gte(sponsorships.endsOn, today),
          visibleProducts(),
        ),
      );
  }

  private async findVisibleSummaries(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProductSummaryRecord>> {
    if (productIds.length === 0) {
      return new Map<string, ProductSummaryRecord>();
    }
    return this.products.findSummaries(productIds, 'visible');
  }
}
