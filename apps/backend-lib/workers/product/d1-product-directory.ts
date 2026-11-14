import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { productScreenshots } from '../../../db/schema/product/product-screenshots.ts';
import { products } from '../../../db/schema/product/products.ts';
import { visibleProducts } from '../../../db/schema/product/visibility.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { deriveLaunchStatus } from '../../core/product/launch-status.ts';
import type {
  LaunchRecord,
  ProductDetailRecord,
  ProductDirectory,
  ProductHandleResolution,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../core/product/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { resolveHandle } from '../handles/handle-queries.ts';
import { PRODUCT_HANDLE_NAMESPACE } from './product-handle-namespaces.ts';
import {
  productSummaryColumns,
  toProductSummaryRecord,
} from './product-summary-columns.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

interface LaunchRow {
  readonly launchId: string;
  readonly productId: string;
  readonly launchDate: string;
  readonly outcome: 'won' | 'lost' | null;
  readonly decidedAt: Date | null;
  readonly cancelledAt: Date | null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function scopeCondition(scope: ProductLookupScope): SQL {
  switch (scope) {
    case 'visible':
      return visibleProducts();
    case 'not-deleted':
      return notDeleted(products.deletedAt);
  }
}

// 行はローンチ日の新しい順に並んでいるため、古い順に取消以外を数えて番号を振り、元の順で返す
function toLaunchRecords(
  rows: readonly LaunchRow[],
  now: Date,
): LaunchRecord[] {
  let counted = 0;
  const numbered = rows.toReversed().map((row) => {
    const launchDate = parseBusinessDate(row.launchDate);
    const cancelled = row.cancelledAt !== null;
    if (!cancelled) {
      counted += 1;
    }
    return {
      launchId: row.launchId,
      productId: row.productId,
      number: cancelled ? 0 : counted,
      launchDate,
      status: deriveLaunchStatus(
        { launchDate, outcome: row.outcome, cancelledAt: row.cancelledAt },
        now,
      ),
      outcome: row.outcome,
      decidedAt: row.decidedAt,
    };
  });
  return numbered.toReversed();
}

@injectable()
export class D1ProductDirectory implements ProductDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findSummaries(
    productIds: readonly string[],
    scope: ProductLookupScope,
  ): Promise<ReadonlyMap<string, ProductSummaryRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(productIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select(productSummaryColumns())
          .from(products)
          .innerJoin(users, eq(users.id, products.userId))
          .innerJoin(
            productCategories,
            eq(productCategories.id, products.categoryId),
          )
          .where(and(inArray(products.id, page), scopeCondition(scope))),
      ),
    );
    return new Map(
      pages.flat().map((row) => [row.productId, toProductSummaryRecord(row)]),
    );
  }

  async resolveHandle(handle: string): Promise<ProductHandleResolution> {
    const resolution = await resolveHandle(
      this.db,
      PRODUCT_HANDLE_NAMESPACE,
      handle,
    );
    if (resolution.kind === 'none') {
      return resolution;
    }
    const found = await this.findSummaries([resolution.ownerId], 'not-deleted');
    const product = found.get(resolution.ownerId);
    return product === undefined
      ? { kind: 'none' }
      : { kind: resolution.kind, product };
  }

  async findDetail(
    productId: string,
  ): Promise<ProductDetailRecord | undefined> {
    const [product] = await this.db
      .select({ descriptionMarkdown: products.descriptionMarkdown })
      .from(products)
      .where(and(eq(products.id, productId), notDeleted(products.deletedAt)))
      .limit(1);
    if (product === undefined) {
      return undefined;
    }
    const screenshots = await this.db
      .select({ fileId: productScreenshots.fileId })
      .from(productScreenshots)
      .where(eq(productScreenshots.productId, productId))
      .orderBy(asc(productScreenshots.position));
    return {
      productId,
      descriptionMarkdown: product.descriptionMarkdown,
      screenshotFileIds: screenshots.map((row) => row.fileId),
    };
  }

  async listLaunches(
    productIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, readonly LaunchRecord[]>> {
    const pages = await Promise.all(
      chunk([...new Set(productIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            launchId: productLaunches.id,
            productId: productLaunches.productId,
            launchDate: productLaunches.launchDate,
            outcome: productLaunches.outcome,
            decidedAt: productLaunches.decidedAt,
            cancelledAt: productLaunches.cancelledAt,
          })
          .from(productLaunches)
          .innerJoin(products, eq(products.id, productLaunches.productId))
          .where(
            and(
              inArray(productLaunches.productId, page),
              notDeleted(products.deletedAt),
            ),
          )
          .orderBy(desc(productLaunches.launchDate), desc(productLaunches.id)),
      ),
    );
    const byProduct = Map.groupBy(pages.flat(), (row) => row.productId);
    return new Map(
      [...byProduct].map(([productId, rows]) => [
        productId,
        toLaunchRecords(rows, now),
      ]),
    );
  }
}
