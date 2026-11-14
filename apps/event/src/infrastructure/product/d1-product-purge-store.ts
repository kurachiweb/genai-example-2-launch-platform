import { asc, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { productLifecycleEvents } from '../../../db/schema/product/product-lifecycle-events.ts';
import { productLifecycleHandlerRuns } from '../../../db/schema/product/product-lifecycle-handler-runs.ts';
import { productScreenshots } from '../../../db/schema/product/product-screenshots.ts';
import { products } from '../../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { previousHandleDelete } from '../../../lib/workers/handles/previous-handle-statements.ts';
import { PRODUCT_HANDLE_NAMESPACE } from '../../../lib/workers/product/product-handle-namespaces.ts';
import type { ProductPurgeStore } from '../../application/product/ports.ts';

@injectable()
export class D1ProductPurgeStore implements ProductPurgeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async imageFileIds(
    productId: string,
  ): Promise<readonly string[] | undefined> {
    const [productRows, screenshotRows] = await this.db.batch([
      this.db
        .select({ logoFileId: products.logoFileId })
        .from(products)
        .where(eq(products.id, productId)),
      this.db
        .select({ fileId: productScreenshots.fileId })
        .from(productScreenshots)
        .where(eq(productScreenshots.productId, productId))
        .orderBy(asc(productScreenshots.position)),
    ]);
    const [product] = productRows;
    if (product === undefined) {
      return undefined;
    }
    return [product.logoFileId, ...screenshotRows.map(({ fileId }) => fileId)];
  }

  // 外部キーにON DELETEの動作を指定していないため子の行から順に消す。他specの行がプロダクトを参照していれば最後の文が失敗し、一括の書き込み全体が取り消される
  async purge(productId: string): Promise<void> {
    const eventIdsOfProduct = this.db
      .select({ id: productLifecycleEvents.id })
      .from(productLifecycleEvents)
      .where(eq(productLifecycleEvents.productId, productId));
    await this.db.batch([
      this.db
        .delete(productLifecycleHandlerRuns)
        .where(inArray(productLifecycleHandlerRuns.eventId, eventIdsOfProduct)),
      this.db
        .delete(productLifecycleEvents)
        .where(eq(productLifecycleEvents.productId, productId)),
      this.db
        .delete(productLaunches)
        .where(eq(productLaunches.productId, productId)),
      this.db
        .delete(productScreenshots)
        .where(eq(productScreenshots.productId, productId)),
      previousHandleDelete(this.db, PRODUCT_HANDLE_NAMESPACE, productId),
      this.db.delete(products).where(eq(products.id, productId)),
    ]);
  }
}
