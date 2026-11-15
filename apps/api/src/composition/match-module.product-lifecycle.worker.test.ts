import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container, ServiceIdentifier } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../db/client.ts';
import { productLaunches } from '../../db/schema/product/product-launches.ts';
import { products } from '../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import type { SyncProductLifecycleEventType } from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  db,
  productIdOf,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { ProductLifecycleCommitter } from '../application/product/ports.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import { ProductMatchClosureSyncHandler } from '../infrastructure/match/product-match-closure-sync-handler.ts';
import {
  expectedScenario,
  OWNER_A_FIRST_PRODUCT,
  productOneClosure,
  readScenario,
  seedClosureScenario,
} from '../infrastructure/match/testing/closure-fixtures.ts';
import { DURING_MATCH } from '../infrastructure/match/testing/upvote-store-fixtures.ts';
import { createD1ProductLifecycleCommitter } from '../infrastructure/product/d1-product-lifecycle-committer.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';

const LATER = new Date(DURING_MATCH.getTime() + 60_000);

const CONCURRENT_HIDE = Symbol.for('test.ConcurrentHide');

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
      productId: productIdOf(OWNER_A_FIRST_PRODUCT),
      ...(options.expectedVersion === undefined
        ? {}
        : { expectedVersion: options.expectedVersion }),
      at: options.at ?? DURING_MATCH,
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
        .where(eq(products.id, productIdOf(OWNER_A_FIRST_PRODUCT)));
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
    .where(eq(products.id, productIdOf(OWNER_A_FIRST_PRODUCT)));
  return row;
}

// 予選の結果が未確定のローンチを持つプロダクトの削除は拒否されるため、予選を終えたプロダクトのマッチ(トーナメントのマッチ)の側として削除する
async function decideQualifierLaunch(): Promise<void> {
  await db
    .update(productLaunches)
    .set({ outcome: 'won', decidedAt: T0 })
    .where(eq(productLaunches.productId, productIdOf(OWNER_A_FIRST_PRODUCT)));
}

beforeEach(seedClosureScenario);

describe('APIサーバーのマッチのモジュールのプロダクトの同期の処理の束縛', () => {
  test('処理単位のコンテナから、プロダクトの同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<ProductLifecycleSyncHandler>(
        MATCH_TYPES.ProductMatchClosureSyncHandler,
      ),
    ).toBeInstanceOf(ProductMatchClosureSyncHandler);
  });
});

describe('非公開化の同期の処理の登録', () => {
  test('非公開化の確定と同じ一括の書き込みで、そのプロダクトのマッチ中のマッチを即時に終了し、開始前のマッチの側に該当を記録し、Upvoteを論理削除しない', async () => {
    await expect(commit('hidden')).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readScenario()).resolves.toEqual(
      expectedScenario(productOneClosure(DURING_MATCH)),
    );
  });

  test('復元では、即時の終了と該当の記録を元に戻さない', async () => {
    await commit('hidden');

    await expect(commit('unhidden', { at: LATER })).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readScenario()).resolves.toEqual(
      expectedScenario(productOneClosure(DURING_MATCH)),
    );
  });

  test('文を集める間に別の確定が先に非公開化したら、非公開化は確定せず、マッチの即時の終了と該当の記録も取り消される', async () => {
    await expect(
      committerWithConcurrentHide().commit({
        type: 'hidden',
        productId: productIdOf(OWNER_A_FIRST_PRODUCT),
        at: DURING_MATCH,
      }),
    ).resolves.toEqual({ kind: 'unchanged' });

    await expect(readProductState()).resolves.toEqual({
      hiddenAt: T0,
      deletedAt: null,
    });
    await expect(readScenario()).resolves.toEqual(expectedScenario({}));
  });
});

describe('削除の同期の処理の登録', () => {
  beforeEach(decideQualifierLaunch);

  test('削除の確定と同じ一括の書き込みで、そのプロダクトのマッチ中のマッチを即時に終了し、開始前のマッチの側に該当を記録し、Upvoteを論理削除しない', async () => {
    await expect(commit('deleted')).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readScenario()).resolves.toEqual(
      expectedScenario(productOneClosure(DURING_MATCH)),
    );
  });

  test('読み取った版が古い削除は確定せず、マッチの即時の終了と該当の記録も取り消される', async () => {
    await expect(commit('deleted', { expectedVersion: 1 })).resolves.toEqual({
      kind: 'rejected',
      reason: 'conflict',
    });

    await expect(readProductState()).resolves.toEqual({
      hiddenAt: null,
      deletedAt: null,
    });
    await expect(readScenario()).resolves.toEqual(expectedScenario({}));
  });
});
