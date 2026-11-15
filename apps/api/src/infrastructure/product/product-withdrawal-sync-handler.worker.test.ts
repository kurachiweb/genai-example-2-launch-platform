import { asc } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { productPreviousHandles } from '../../../db/schema/product/product-previous-handles.ts';
import { products } from '../../../db/schema/product/products.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { eventIdOf } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  after,
  clearProductTables,
  db,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { ProductWithdrawalSyncHandler } from './product-withdrawal-sync-handler.ts';

const TARGET = 1;
const OTHER = 2;

const ACTIVE_PRODUCT = 1;
const DELETED_PRODUCT = 2;
const OTHER_PRODUCT = 3;

const AT = after(60_000);
const EARLIER_DELETED_AT = after(1_000);

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(TARGET),
    type,
    occurredAt: AT,
  };
}

async function readProductDeletion() {
  return db
    .select({
      id: products.id,
      deletedAt: products.deletedAt,
      version: products.version,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .orderBy(asc(products.id));
}

async function readPreviousDeletion() {
  return db
    .select({
      ownerId: productPreviousHandles.ownerId,
      deletedAt: productPreviousHandles.deletedAt,
      updatedAt: productPreviousHandles.updatedAt,
    })
    .from(productPreviousHandles)
    .orderBy(asc(productPreviousHandles.ownerId));
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

const UNTOUCHED_PRODUCTS = [
  {
    id: productIdOf(ACTIVE_PRODUCT),
    deletedAt: null,
    version: 0,
    updatedAt: T0,
  },
  {
    id: productIdOf(DELETED_PRODUCT),
    deletedAt: EARLIER_DELETED_AT,
    version: 1,
    updatedAt: T0,
  },
  {
    id: productIdOf(OTHER_PRODUCT),
    deletedAt: null,
    version: 0,
    updatedAt: T0,
  },
];

const UNTOUCHED_PREVIOUS = [
  { ownerId: productIdOf(ACTIVE_PRODUCT), deletedAt: null, updatedAt: T0 },
  {
    ownerId: productIdOf(DELETED_PRODUCT),
    deletedAt: EARLIER_DELETED_AT,
    updatedAt: T0,
  },
  { ownerId: productIdOf(OTHER_PRODUCT), deletedAt: null, updatedAt: T0 },
];

beforeEach(async () => {
  await clearProductTables();
  await insertUser(TARGET);
  await insertUser(OTHER);
  await insertProduct(ACTIVE_PRODUCT, TARGET);
  await insertProduct(DELETED_PRODUCT, TARGET, {
    deletedAt: EARLIER_DELETED_AT,
    version: 1,
  });
  await insertProduct(OTHER_PRODUCT, OTHER);
  await insertProductPreviousHandle(1, ACTIVE_PRODUCT, 'active-old');
  await insertProductPreviousHandle(2, DELETED_PRODUCT, 'deleted-old', {
    deletedAt: EARLIER_DELETED_AT,
  });
  await insertProductPreviousHandle(3, OTHER_PRODUCT, 'other-old');
});

describe('ProductWithdrawalSyncHandler', () => {
  describe('statementsFor', () => {
    test('退会ではプロダクトと旧ハンドルの2文を返し、実行すると退会した利用者の未削除の分だけを退会の日時で論理削除して版を増やす', async () => {
      const statements = await new ProductWithdrawalSyncHandler().statementsFor(
        eventOf('withdrawn'),
        db,
      );

      expect(statements).toHaveLength(2);
      await expect(readProductDeletion()).resolves.toEqual(UNTOUCHED_PRODUCTS);
      await expect(readPreviousDeletion()).resolves.toEqual(UNTOUCHED_PREVIOUS);

      await commitAll(statements);

      await expect(readProductDeletion()).resolves.toEqual([
        {
          id: productIdOf(ACTIVE_PRODUCT),
          deletedAt: AT,
          version: 1,
          updatedAt: AT,
        },
        {
          id: productIdOf(DELETED_PRODUCT),
          deletedAt: EARLIER_DELETED_AT,
          version: 1,
          updatedAt: T0,
        },
        {
          id: productIdOf(OTHER_PRODUCT),
          deletedAt: null,
          version: 0,
          updatedAt: T0,
        },
      ]);
      await expect(readPreviousDeletion()).resolves.toEqual([
        { ownerId: productIdOf(ACTIVE_PRODUCT), deletedAt: AT, updatedAt: AT },
        {
          ownerId: productIdOf(DELETED_PRODUCT),
          deletedAt: EARLIER_DELETED_AT,
          updatedAt: T0,
        },
        { ownerId: productIdOf(OTHER_PRODUCT), deletedAt: null, updatedAt: T0 },
      ]);
    });

    test.each(['suspended', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        const statements =
          await new ProductWithdrawalSyncHandler().statementsFor(
            eventOf(type),
            db,
          );

        expect(statements).toEqual([]);
        await expect(readProductDeletion()).resolves.toEqual(
          UNTOUCHED_PRODUCTS,
        );
        await expect(readPreviousDeletion()).resolves.toEqual(
          UNTOUCHED_PREVIOUS,
        );
      },
    );
  });
});
