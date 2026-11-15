import { asc, eq, isNotNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { productScreenshots } from '../../../db/schema/product/product-screenshots.ts';
import { products } from '../../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { deriveLaunchStatus } from '../../core/product/launch-status.ts';
import type {
  LaunchExport,
  LaunchExportRecord,
  ProductExport,
  ProductExportRecord,
} from '../../core/product/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';

function isTrue(value: unknown): boolean {
  return Number(value) === 1;
}

@injectable()
export class D1ProductExport implements ProductExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // プロダクトとスクリーンショットを同じ時点の状態で読むため1回の一括で読む
  async listByUser(userId: string): Promise<readonly ProductExportRecord[]> {
    const [rows, screenshots] = await this.db.batch([
      this.db
        .select({
          id: products.id,
          handle: products.handle,
          name: products.name,
          tagline: products.tagline,
          // 一括の読み取りは列の名前で値を写すため、productsのnameと重ならない名前を付ける
          categoryName: sql<string>`${productCategories.name}`.as(
            'category_name',
          ),
          websiteUrl: products.websiteUrl,
          descriptionMarkdown: products.descriptionMarkdown,
          logoFileId: products.logoFileId,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
          deletedAt: products.deletedAt,
          hiddenByAdmin: sql<boolean>`${isNotNull(products.hiddenAt)}`.mapWith(
            isTrue,
          ),
        })
        .from(products)
        .innerJoin(
          productCategories,
          eq(productCategories.id, products.categoryId),
        )
        .where(eq(products.userId, userId))
        .orderBy(asc(products.createdAt), asc(products.id)),
      this.db
        .select({
          productId: productScreenshots.productId,
          fileId: productScreenshots.fileId,
        })
        .from(productScreenshots)
        .innerJoin(products, eq(products.id, productScreenshots.productId))
        .where(eq(products.userId, userId))
        .orderBy(
          asc(productScreenshots.productId),
          asc(productScreenshots.position),
        ),
    ]);
    const screenshotsOf = Map.groupBy(screenshots, (row) => row.productId);
    return rows.map((row) => ({
      ...row,
      screenshotFileIds: (screenshotsOf.get(row.id) ?? []).map(
        (screenshot) => screenshot.fileId,
      ),
    }));
  }
}

@injectable()
export class D1LaunchExport implements LaunchExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listByUser(
    userId: string,
    now: Date,
  ): Promise<readonly LaunchExportRecord[]> {
    const rows = await this.db
      .select({
        id: productLaunches.id,
        productId: productLaunches.productId,
        launchDate: productLaunches.launchDate,
        outcome: productLaunches.outcome,
        cancelledAt: productLaunches.cancelledAt,
      })
      .from(productLaunches)
      .innerJoin(products, eq(products.id, productLaunches.productId))
      .where(eq(products.userId, userId))
      .orderBy(asc(productLaunches.launchDate), asc(productLaunches.id));
    return rows.map((row) => {
      const launchDate = parseBusinessDate(row.launchDate);
      return {
        id: row.id,
        productId: row.productId,
        launchDate,
        status: deriveLaunchStatus(
          { launchDate, outcome: row.outcome, cancelledAt: row.cancelledAt },
          now,
        ),
      };
    });
  }
}
