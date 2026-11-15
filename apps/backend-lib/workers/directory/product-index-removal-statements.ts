import { eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { directoryEntries } from '../../../db/schema/directory/directory-entries.ts';
import { productSearchDocuments } from '../../../db/schema/directory/product-search-documents.ts';

// 索引文書は勝利したプロダクトの記録のあるプロダクトにだけ作られるため、記録から投稿者のプロダクトを引く。行ごとの文にせず、確定の時点の全ての記録に効く1文にする
export function accountIndexRemovalStatement(
  db: Database,
  ownerUserId: string,
): BatchItem<'sqlite'> {
  return db
    .delete(productSearchDocuments)
    .where(
      inArray(
        productSearchDocuments.sourceId,
        db
          .select({ productId: directoryEntries.productId })
          .from(directoryEntries)
          .where(eq(directoryEntries.ownerUserId, ownerUserId)),
      ),
    );
}
