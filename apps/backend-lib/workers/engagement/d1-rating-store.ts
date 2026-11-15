import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { validRating } from '../../../db/schema/engagement/engagement-conditions.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import { users } from '../../../db/schema/identity/users.ts';
import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  RatingStore,
  RatingSummary,
} from '../../core/engagement/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const NO_RATINGS: RatingSummary = Object.freeze({ average: null, count: 0 });

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

interface RatingKey {
  readonly productId: string;
  readonly userId: string;
}

function ratingOf(input: RatingKey) {
  return and(
    eq(productRatings.productId, input.productId),
    eq(productRatings.userId, input.userId),
  );
}

@injectable()
export class D1RatingStore implements RatingStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async remove(input: RatingKey): Promise<boolean> {
    const result = await this.db.delete(productRatings).where(ratingOf(input));
    return result.meta.changes > 0;
  }

  async findScore(
    input: RatingKey,
  ): Promise<
    { readonly ratingId: string; readonly score: RatingScore } | undefined
  > {
    const [row] = await this.db
      .select({ ratingId: productRatings.id, score: productRatings.score })
      .from(productRatings)
      .where(and(ratingOf(input), isNull(productRatings.deletedAt)));
    // 値はテーブルのCHECK制約で1〜5に限られる
    return row === undefined
      ? undefined
      : { ratingId: row.ratingId, score: row.score as RatingScore };
  }

  // 有効な評価の無いプロダクトも、平均値null・件数0として返す
  async summaries(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, RatingSummary>> {
    const uniqueIds = [...new Set(productIds)];
    const pages = await Promise.all(
      chunk(uniqueIds, IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            productId: productRatings.productId,
            average: sql<number>`avg(${productRatings.score})`.mapWith(Number),
            count: count(),
          })
          .from(productRatings)
          .innerJoin(users, eq(users.id, productRatings.userId))
          .where(and(inArray(productRatings.productId, page), validRating()))
          .groupBy(productRatings.productId),
      ),
    );
    const found = new Map(
      pages
        .flat()
        .map((row) => [
          row.productId,
          { average: row.average, count: row.count },
        ]),
    );
    return new Map(
      uniqueIds.map((productId) => [
        productId,
        found.get(productId) ?? NO_RATINGS,
      ]),
    );
  }
}
