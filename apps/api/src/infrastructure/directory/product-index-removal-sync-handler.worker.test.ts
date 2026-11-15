import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type {
  ProductLifecycleEvent,
  SyncProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import { readIndexedProductIds } from '../../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import {
  db,
  productEventIdOf,
  productIdOf,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { createSearchIndexStatements } from '../../../lib/workers/search/search-index-statements.ts';
import { createSearchTargetRegistry } from '../../../lib/workers/search/search-target-definition.ts';
import { PRODUCT_SEARCH_TARGET } from '../../../lib/workers/search/targets/product.ts';
import type { ProductLifecycleSyncHandler } from '../product/product-lifecycle-sync-handler.ts';
import { ProductIndexRemovalSyncHandler } from './product-index-removal-sync-handler.ts';
import {
  AFTER_DECISION,
  indexedProductIdsOf,
  OTHER_OWNER_LISTED,
  OWNER,
  OWNER_FIRST_LISTED,
  OWNER_SECOND_LISTED,
  seedIndexRemovalScenario,
} from './testing/index-removal-fixtures.ts';

const handler: ProductLifecycleSyncHandler = new ProductIndexRemovalSyncHandler(
  createSearchIndexStatements(
    db,
    createSearchTargetRegistry([PRODUCT_SEARCH_TARGET]),
  ),
);

function statementsFor(
  type: SyncProductLifecycleEventType,
): Promise<readonly BatchItem<'sqlite'>[]> {
  const event: ProductLifecycleEvent = {
    id: productEventIdOf(1),
    productId: productIdOf(OWNER_FIRST_LISTED),
    ownerUserId: userIdOf(OWNER),
    type,
    occurredAt: AFTER_DECISION,
  };
  return handler.statementsFor(event, db);
}

beforeEach(seedIndexRemovalScenario);

describe('ProductIndexRemovalSyncHandler', () => {
  describe('statementsFor', () => {
    test.each(['hidden', 'deleted'] as const)(
      '%sでは1文を返し、組み立てでは消さず、実行するとそのプロダクトの索引文書だけを消す',
      async (type) => {
        const [statement, ...rest] = await statementsFor(type);

        expect(statement).toBeDefined();
        expect(rest).toEqual([]);
        await expect(readIndexedProductIds()).resolves.toEqual(
          indexedProductIdsOf([
            OWNER_FIRST_LISTED,
            OWNER_SECOND_LISTED,
            OTHER_OWNER_LISTED,
          ]),
        );

        if (statement !== undefined) {
          await db.batch([statement]);
        }

        await expect(readIndexedProductIds()).resolves.toEqual(
          indexedProductIdsOf([OWNER_SECOND_LISTED, OTHER_OWNER_LISTED]),
        );
      },
    );

    test('復元では文を返さない', async () => {
      await expect(statementsFor('unhidden')).resolves.toEqual([]);
    });
  });
});
