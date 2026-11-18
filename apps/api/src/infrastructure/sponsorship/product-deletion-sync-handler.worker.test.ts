import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type {
  ProductLifecycleEvent,
  ProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import { productEventIdOf } from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  db,
  productIdOf,
  userIdOf,
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { ProductDeletionSyncHandler } from './product-deletion-sync-handler.ts';
import {
  AT,
  commitStatements,
  compiledOf,
  LATER,
  OWNER,
  productDeletedState,
  readClosureState,
  seedClosureScenario,
  TARGET_PRODUCT,
  untouchedState,
} from './testing/closure-fixtures.ts';

function eventOf(
  type: ProductLifecycleEventType,
  occurredAt: Date = AT,
): ProductLifecycleEvent {
  return {
    id: productEventIdOf(1),
    productId: productIdOf(TARGET_PRODUCT),
    ownerUserId: userIdOf(OWNER),
    type,
    occurredAt,
  };
}

function statementsOf(
  event: ProductLifecycleEvent,
): Promise<readonly BatchItem<'sqlite'>[]> {
  return new ProductDeletionSyncHandler().statementsFor(event, db);
}

beforeEach(seedClosureScenario);

describe('ProductDeletionSyncHandler', () => {
  describe('statementsFor', () => {
    test('削除では、そのプロダクトのプロダクトの論理削除が未記録の申込に日時を記録し未精算の表示停止の返金を返金不要にする集合の更新の1文を返し、返すまでは書き込まない', async () => {
      const statements = await statementsOf(eventOf('deleted'));

      expect(statements.map(compiledOf)).toEqual([
        {
          sql: `update "sponsorships" set "product_deleted_at" = ?, "stop_refund_status" = case when "sponsorships"."stop_refund_status" = 'none' then 'not_needed' else "sponsorships"."stop_refund_status" end, "updated_at" = ? where (("sponsorships"."product_id" = ?) and (("sponsorships"."product_deleted_at" is null)))`,
          params: [AT.getTime(), AT.getTime(), productIdOf(TARGET_PRODUCT)],
        },
      ]);
      await expect(readClosureState()).resolves.toEqual(untouchedState());
    });

    test('文を実行すると、そのプロダクトの全ての申込だけに削除の日時を記録し、申込は論理削除せず、未精算の表示停止の返金だけを返金不要にする', async () => {
      const changes = await commitStatements(
        await statementsOf(eventOf('deleted')),
      );

      expect(changes).toEqual([5]);
      await expect(readClosureState()).resolves.toEqual(
        productDeletedState(AT),
      );
    });

    test('同じプロダクトの削除の文をもう一度実行しても、最初の削除の日時を上書きしない', async () => {
      await commitStatements(await statementsOf(eventOf('deleted')));

      const changes = await commitStatements(
        await statementsOf(eventOf('deleted', LATER)),
      );

      expect(changes).toEqual([0]);
      await expect(readClosureState()).resolves.toEqual(
        productDeletedState(AT),
      );
    });

    test.each(['hidden', 'unhidden', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        await expect(statementsOf(eventOf(type))).resolves.toEqual([]);
        await expect(readClosureState()).resolves.toEqual(untouchedState());
      },
    );
  });
});
