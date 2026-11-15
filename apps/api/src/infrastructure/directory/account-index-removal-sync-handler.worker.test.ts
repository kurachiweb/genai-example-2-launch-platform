import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type {
  SyncLifecycleEventType,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { readIndexedProductIds } from '../../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import {
  db,
  productEventIdOf,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { AccountIndexRemovalSyncHandler } from './account-index-removal-sync-handler.ts';
import {
  AFTER_DECISION,
  indexedProductIdsOf,
  OTHER_OWNER_LISTED,
  OWNER,
  OWNER_FIRST_LISTED,
  OWNER_SECOND_LISTED,
  seedIndexRemovalScenario,
} from './testing/index-removal-fixtures.ts';

function statementsFor(
  type: SyncLifecycleEventType,
): Promise<readonly BatchItem<'sqlite'>[]> {
  const event: UserLifecycleEvent = {
    id: productEventIdOf(1),
    userId: userIdOf(OWNER),
    type,
    occurredAt: AFTER_DECISION,
  };
  return new AccountIndexRemovalSyncHandler().statementsFor(event, db);
}

beforeEach(seedIndexRemovalScenario);

describe('AccountIndexRemovalSyncHandler', () => {
  describe('statementsFor', () => {
    test.each(['withdrawn', 'suspended'] as const)(
      '%sでは1文を返し、組み立てでは消さず、実行すると投稿者の全ての索引文書だけを消す',
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
          indexedProductIdsOf([OTHER_OWNER_LISTED]),
        );
      },
    );

    test('停止の解除では文を返さない', async () => {
      await expect(statementsFor('unsuspended')).resolves.toEqual([]);
    });
  });
});
