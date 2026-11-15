import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { productLaunches } from '../../db/schema/product/product-launches.ts';
import { productPreviousHandles } from '../../db/schema/product/product-previous-handles.ts';
import { products } from '../../db/schema/product/products.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type {
  ProductDirectory,
  ScheduledLaunchDirectory,
} from '../../lib/core/product/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearProductTables,
  db,
  insertLaunches,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type { UserLifecycleCommitter } from '../application/identity/ports.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { LaunchCancellationSyncHandler } from '../infrastructure/product/launch-cancellation-sync-handler.ts';
import { ProductWithdrawalSyncHandler } from '../infrastructure/product/product-withdrawal-sync-handler.ts';
import { MODULES } from './modules.ts';

const OWNER = 1;
const OTHER = 2;

const OWNER_PRODUCT = 1;
const OWNER_SECOND_PRODUCT = 2;
const OTHER_PRODUCT = 3;

const TODAY_LAUNCH = 1;
const TOMORROW_LAUNCH = 2;
const OTHER_LAUNCH = 3;

const TODAY = '2026-11-10';
const TOMORROW = '2026-11-11';

const AT = fromBusinessDateTime(parseBusinessDate(TODAY), {
  hour: 12,
  minute: 0,
});
const LATER = new Date(AT.getTime() + 60_000);

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

function committer(): UserLifecycleCommitter {
  return createContainer().get<UserLifecycleCommitter>(
    IDENTITY_TYPES.UserLifecycleCommitter,
  );
}

async function scheduledLaunchIdsOn(date: string): Promise<string[]> {
  const { launches } = await createContainer()
    .get<ScheduledLaunchDirectory>(
      PRODUCT_PLATFORM_TYPES.ScheduledLaunchDirectory,
    )
    .listForDate({
      launchDate: parseBusinessDate(date),
      after: undefined,
      limit: 500,
    });
  return launches.map(({ launchId }) => launchId);
}

async function launchedProductIds(): Promise<string[]> {
  const launches = await createContainer()
    .get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    .listLaunches(
      [OWNER_PRODUCT, OWNER_SECOND_PRODUCT, OTHER_PRODUCT].map(productIdOf),
      AT,
    );
  return [...launches.keys()].toSorted();
}

async function readProductDeletion() {
  return db
    .select({ id: products.id, deletedAt: products.deletedAt })
    .from(products)
    .orderBy(asc(products.id));
}

async function readPreviousDeletion() {
  return db
    .select({
      ownerId: productPreviousHandles.ownerId,
      deletedAt: productPreviousHandles.deletedAt,
    })
    .from(productPreviousHandles)
    .orderBy(asc(productPreviousHandles.ownerId));
}

async function readCancellation() {
  return db
    .select({
      id: productLaunches.id,
      cancelledAt: productLaunches.cancelledAt,
    })
    .from(productLaunches)
    .orderBy(asc(productLaunches.id));
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER);
  await insertUser(OTHER);
  await insertProduct(OWNER_PRODUCT, OWNER);
  await insertProduct(OWNER_SECOND_PRODUCT, OWNER);
  await insertProduct(OTHER_PRODUCT, OTHER);
  await insertProductPreviousHandle(1, OWNER_PRODUCT, 'owner-old');
  await insertProductPreviousHandle(2, OTHER_PRODUCT, 'other-old');
  await insertLaunches([
    {
      index: TODAY_LAUNCH,
      productIndex: OWNER_PRODUCT,
      columns: { launchDate: TODAY },
    },
    {
      index: TOMORROW_LAUNCH,
      productIndex: OWNER_SECOND_PRODUCT,
      columns: { launchDate: TOMORROW },
    },
    {
      index: OTHER_LAUNCH,
      productIndex: OTHER_PRODUCT,
      columns: { launchDate: TOMORROW },
    },
  ]);
});

describe('同期の波及処理の束縛', () => {
  test('退会と停止の同期の波及処理は、処理単位のコンテナでそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<UserLifecycleSyncHandler>(
        PRODUCT_TYPES.ProductWithdrawalSyncHandler,
      ),
    ).toBeInstanceOf(ProductWithdrawalSyncHandler);
    expect(
      container.get<UserLifecycleSyncHandler>(
        PRODUCT_TYPES.LaunchCancellationSyncHandler,
      ),
    ).toBeInstanceOf(LaunchCancellationSyncHandler);
  });
});

describe('退会の同期の波及処理の登録', () => {
  test('退会の確定と同じ一括の書き込みで、退会した利用者の全プロダクトと旧ハンドルを論理削除し、ローンチが照会と予定の一覧から消える', async () => {
    await expect(scheduledLaunchIdsOn(TOMORROW)).resolves.toEqual([
      launchIdOf(TOMORROW_LAUNCH),
      launchIdOf(OTHER_LAUNCH),
    ]);

    await committer().commit({
      kind: 'withdraw',
      userId: userIdOf(OWNER),
      expectedVersion: 0,
      at: AT,
    });

    await expect(readProductDeletion()).resolves.toEqual([
      { id: productIdOf(OWNER_PRODUCT), deletedAt: AT },
      { id: productIdOf(OWNER_SECOND_PRODUCT), deletedAt: AT },
      { id: productIdOf(OTHER_PRODUCT), deletedAt: null },
    ]);
    await expect(readPreviousDeletion()).resolves.toEqual([
      { ownerId: productIdOf(OWNER_PRODUCT), deletedAt: AT },
      { ownerId: productIdOf(OTHER_PRODUCT), deletedAt: null },
    ]);
    await expect(launchedProductIds()).resolves.toEqual([
      productIdOf(OTHER_PRODUCT),
    ]);
    await expect(scheduledLaunchIdsOn(TODAY)).resolves.toEqual([]);
    await expect(scheduledLaunchIdsOn(TOMORROW)).resolves.toEqual([
      launchIdOf(OTHER_LAUNCH),
    ]);
  });

  test('読み取った版が古い退会は確定せず、プロダクトと旧ハンドルの論理削除も取り消される', async () => {
    await expect(
      committer().commit({
        kind: 'withdraw',
        userId: userIdOf(OWNER),
        expectedVersion: 1,
        at: AT,
      }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readProductDeletion()).resolves.toEqual([
      { id: productIdOf(OWNER_PRODUCT), deletedAt: null },
      { id: productIdOf(OWNER_SECOND_PRODUCT), deletedAt: null },
      { id: productIdOf(OTHER_PRODUCT), deletedAt: null },
    ]);
    await expect(readPreviousDeletion()).resolves.toEqual([
      { ownerId: productIdOf(OWNER_PRODUCT), deletedAt: null },
      { ownerId: productIdOf(OTHER_PRODUCT), deletedAt: null },
    ]);
  });
});

describe('停止の同期の波及処理の登録', () => {
  test('停止の確定と同じ一括の書き込みで、停止した利用者の未開始のローンチだけを取り消し、今日のローンチと他の利用者のローンチは残す', async () => {
    await committer().commit({
      kind: 'suspend',
      userId: userIdOf(OWNER),
      expectedVersion: 0,
      at: AT,
    });

    await expect(readCancellation()).resolves.toEqual([
      { id: launchIdOf(TODAY_LAUNCH), cancelledAt: null },
      { id: launchIdOf(TOMORROW_LAUNCH), cancelledAt: AT },
      { id: launchIdOf(OTHER_LAUNCH), cancelledAt: null },
    ]);
    await expect(readProductDeletion()).resolves.toEqual([
      { id: productIdOf(OWNER_PRODUCT), deletedAt: null },
      { id: productIdOf(OWNER_SECOND_PRODUCT), deletedAt: null },
      { id: productIdOf(OTHER_PRODUCT), deletedAt: null },
    ]);
  });

  test('停止の解除では、取り消したローンチを元に戻さない', async () => {
    await committer().commit({
      kind: 'suspend',
      userId: userIdOf(OWNER),
      expectedVersion: 0,
      at: AT,
    });

    await committer().commit({
      kind: 'unsuspend',
      userId: userIdOf(OWNER),
      expectedVersion: 1,
      at: LATER,
    });

    await expect(readCancellation()).resolves.toEqual([
      { id: launchIdOf(TODAY_LAUNCH), cancelledAt: null },
      { id: launchIdOf(TOMORROW_LAUNCH), cancelledAt: AT },
      { id: launchIdOf(OTHER_LAUNCH), cancelledAt: null },
    ]);
    await expect(scheduledLaunchIdsOn(TOMORROW)).resolves.toEqual([
      launchIdOf(OTHER_LAUNCH),
    ]);
  });

  test('読み取った版が古い停止は確定せず、ローンチの取消も取り消される', async () => {
    await expect(
      committer().commit({
        kind: 'suspend',
        userId: userIdOf(OWNER),
        expectedVersion: 1,
        at: AT,
      }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readCancellation()).resolves.toEqual([
      { id: launchIdOf(TODAY_LAUNCH), cancelledAt: null },
      { id: launchIdOf(TOMORROW_LAUNCH), cancelledAt: null },
      { id: launchIdOf(OTHER_LAUNCH), cancelledAt: null },
    ]);
  });
});
