import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type {
  ProductLifecycleEvent,
  SyncProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import {
  db,
  productEventIdOf,
  productIdOf,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { ProductMatchClosureSyncHandler } from './product-match-closure-sync-handler.ts';
import {
  expectedScenario,
  OWNER_A_FIRST_PRODUCT,
  productOneClosure,
  readScenario,
  seedClosureScenario,
} from './testing/closure-fixtures.ts';
import { DURING_MATCH, OWNER_A } from './testing/upvote-store-fixtures.ts';

async function statementsFor(
  type: SyncProductLifecycleEventType,
): Promise<readonly BatchItem<'sqlite'>[]> {
  const event: ProductLifecycleEvent = {
    id: productEventIdOf(1),
    productId: productIdOf(OWNER_A_FIRST_PRODUCT),
    ownerUserId: userIdOf(OWNER_A),
    type,
    occurredAt: DURING_MATCH,
  };
  return new ProductMatchClosureSyncHandler().statementsFor(event, db);
}

async function commitAll(
  statements: readonly BatchItem<'sqlite'>[],
): Promise<void> {
  const [first, ...rest] = statements;
  if (first === undefined) {
    throw new Error('文が返されませんでした');
  }
  await db.batch([first, ...rest]);
}

beforeEach(seedClosureScenario);

describe('ProductMatchClosureSyncHandler', () => {
  describe('statementsFor', () => {
    test.each(['hidden', 'deleted'] as const)(
      '%sでは3文を返し、実行するとそのプロダクトのマッチ中のマッチだけを即時に終了し、開始前のマッチの側に該当を記録する',
      async (type) => {
        const statements = await statementsFor(type);

        expect(statements).toHaveLength(3);
        await expect(readScenario()).resolves.toEqual(expectedScenario({}));

        await commitAll(statements);

        await expect(readScenario()).resolves.toEqual(
          expectedScenario(productOneClosure(DURING_MATCH)),
        );
      },
    );

    test('復元では文を返さない', async () => {
      await expect(statementsFor('unhidden')).resolves.toEqual([]);
    });
  });
});
