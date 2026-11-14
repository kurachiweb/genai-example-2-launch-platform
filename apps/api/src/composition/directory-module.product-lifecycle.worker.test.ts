import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container, ServiceIdentifier } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../db/client.ts';
import { products } from '../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import type { SyncProductLifecycleEventType } from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { readIndexedProductIds } from '../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import {
  db,
  productIdOf,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
import type { ProductLifecycleCommitter } from '../application/product/ports.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import { ProductIndexRemovalSyncHandler } from '../infrastructure/directory/product-index-removal-sync-handler.ts';
import {
  AFTER_DECISION,
  indexedProductIdsOf,
  OTHER_OWNER_LISTED,
  OWNER_FIRST_LISTED,
  OWNER_SECOND_LISTED,
  seedIndexRemovalScenario,
} from '../infrastructure/directory/testing/index-removal-fixtures.ts';
import { createD1ProductLifecycleCommitter } from '../infrastructure/product/d1-product-lifecycle-committer.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';

const LATER = new Date(AFTER_DECISION.getTime() + 60_000);

const CONCURRENT_HIDE = Symbol.for('test.ConcurrentHide');

const ALL_INDEXED = indexedProductIdsOf([
  OWNER_FIRST_LISTED,
  OWNER_SECOND_LISTED,
  OTHER_OWNER_LISTED,
]);

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

function commit(
  type: SyncProductLifecycleEventType,
  options: { readonly expectedVersion?: number; readonly at?: Date } = {},
) {
  return createContainer()
    .get<ProductLifecycleCommitter>(PRODUCT_TYPES.ProductLifecycleCommitter)
    .commit({
      type,
      productId: productIdOf(OWNER_FIRST_LISTED),
      ...(options.expectedVersion === undefined
        ? {}
        : { expectedVersion: options.expectedVersion }),
      at: options.at ?? AFTER_DECISION,
    });
}

// 登録口の処理の文を集める間に、別の確定が同じプロダクトを先に非公開化する
function committerWithConcurrentHide(): ProductLifecycleCommitter {
  const container = createContainer();
  const concurrentHide: ProductLifecycleSyncHandler = {
    statementsFor: async (_event, database) => {
      await database
        .update(products)
        .set({ hiddenAt: T0 })
        .where(eq(products.id, productIdOf(OWNER_FIRST_LISTED)));
      return [];
    },
  };
  return createD1ProductLifecycleCommitter(
    container.get<Database>(PLATFORM_TYPES.Database),
    container.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
    [
      ...PRODUCT_LIFECYCLE_SYNC_HANDLERS,
      {
        name: 'test-spec.concurrent-hide',
        events: ['hidden'],
        handler: CONCURRENT_HIDE,
      },
    ],
    <T>(identifier: ServiceIdentifier<T>): T =>
      identifier === CONCURRENT_HIDE
        ? (concurrentHide as T)
        : container.get<T>(identifier),
  );
}

async function readProductState() {
  const [row] = await db
    .select({ hiddenAt: products.hiddenAt, deletedAt: products.deletedAt })
    .from(products)
    .where(eq(products.id, productIdOf(OWNER_FIRST_LISTED)));
  return row;
}

beforeEach(seedIndexRemovalScenario);

describe('APIサーバーのディレクトリのモジュールのプロダクトの同期の処理の束縛', () => {
  test('処理単位のコンテナから、プロダクトの同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<ProductLifecycleSyncHandler>(
        DIRECTORY_TYPES.ProductIndexRemovalSyncHandler,
      ),
    ).toBeInstanceOf(ProductIndexRemovalSyncHandler);
  });
});

describe('非公開化の同期の処理の登録', () => {
  test('非公開化の確定と同じ一括の書き込みで、そのプロダクトの索引文書だけを消す', async () => {
    await expect(commit('hidden')).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readIndexedProductIds()).resolves.toEqual(
      indexedProductIdsOf([OWNER_SECOND_LISTED, OTHER_OWNER_LISTED]),
    );
  });

  test('復元では、索引文書を作り直さない', async () => {
    await commit('hidden');

    await expect(commit('unhidden', { at: LATER })).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readIndexedProductIds()).resolves.toEqual(
      indexedProductIdsOf([OWNER_SECOND_LISTED, OTHER_OWNER_LISTED]),
    );
  });

  test('文を集める間に別の確定が先に非公開化したら、非公開化は確定せず、索引文書の削除も取り消される', async () => {
    await expect(
      committerWithConcurrentHide().commit({
        type: 'hidden',
        productId: productIdOf(OWNER_FIRST_LISTED),
        at: AFTER_DECISION,
      }),
    ).resolves.toEqual({ kind: 'unchanged' });

    await expect(readProductState()).resolves.toEqual({
      hiddenAt: T0,
      deletedAt: null,
    });
    await expect(readIndexedProductIds()).resolves.toEqual(ALL_INDEXED);
  });
});

describe('削除の同期の処理の登録', () => {
  test('削除の確定と同じ一括の書き込みで、そのプロダクトの索引文書だけを消す', async () => {
    await expect(commit('deleted')).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readIndexedProductIds()).resolves.toEqual(
      indexedProductIdsOf([OWNER_SECOND_LISTED, OTHER_OWNER_LISTED]),
    );
  });

  test('読み取った版が古い削除は確定せず、索引文書の削除も取り消される', async () => {
    await expect(commit('deleted', { expectedVersion: 1 })).resolves.toEqual({
      kind: 'rejected',
      reason: 'conflict',
    });

    await expect(readProductState()).resolves.toEqual({
      hiddenAt: null,
      deletedAt: null,
    });
    await expect(readIndexedProductIds()).resolves.toEqual(ALL_INDEXED);
  });
});
