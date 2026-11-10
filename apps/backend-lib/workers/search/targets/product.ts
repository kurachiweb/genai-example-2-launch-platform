import { and, eq, sql } from 'drizzle-orm';

import { productSearchDocuments } from '../../../../db/schema/directory/product-search-documents.ts';
import { PRODUCT_SEARCH_INDEX } from '../../../../db/schema/directory/product-search-index.ts';
import { users } from '../../../../db/schema/identity/users.ts';
import { products } from '../../../../db/schema/product/products.ts';
import {
  visibleProducts,
  wonLaunchExists,
} from '../../../../db/schema/product/visibility.ts';
import { D1ProductDirectory } from '../../product/d1-product-directory.ts';
import { defineSearchTarget } from '../search-target-definition.ts';

export const PRODUCT_SEARCH_TARGET = defineSearchTarget({
  name: 'product',
  fields: {
    name: { format: 'plain', textColumn: true, extract: false },
    tagline: { format: 'plain', textColumn: true, extract: false },
    description: { format: 'markdown', textColumn: false, extract: true },
  },
  index: PRODUCT_SEARCH_INDEX,
  documents: productSearchDocuments,
  async read(db, sourceId) {
    // 掲載の可否は投稿者の状態とローンチの結果でも変わり、プロダクトの更新日時では順序付けられないため、読み取りの時刻を版にする
    const version = Date.now();
    const directory = new D1ProductDirectory(db);
    const summary = (await directory.findSummaries([sourceId], 'visible')).get(
      sourceId,
    );
    if (summary?.listed !== true) {
      return undefined;
    }
    const detail = await directory.findDetail(sourceId);
    return (
      detail && {
        version,
        fields: {
          name: summary.name,
          tagline: summary.tagline,
          description: detail.descriptionMarkdown,
        },
      }
    );
  },
  isIndexable: (sourceId) =>
    sql`SELECT 1 FROM ${products} INNER JOIN ${users} ON ${eq(users.id, products.userId)} WHERE ${and(eq(products.id, sourceId), visibleProducts(), wonLaunchExists())}`,
});
