import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { count, eq, inArray } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { productLifecycleEvents } from '../../../db/schema/product/product-lifecycle-events.ts';
import { productLifecycleHandlerRuns } from '../../../db/schema/product/product-lifecycle-handler-runs.ts';
import { productPreviousHandles } from '../../../db/schema/product/product-previous-handles.ts';
import { productScreenshots } from '../../../db/schema/product/product-screenshots.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  clearProductTables,
  db,
  insertLaunch,
  insertProduct,
  insertProductEvent,
  insertProductPreviousHandle,
  insertScreenshot,
  insertUser,
  logoFileIdOf,
  productEventIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1IdentityPurgeStore } from '../identity/d1-identity-purge-store.ts';
import { D1ProductPurgeStore } from './d1-product-purge-store.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER = 1;

const PURGED = 1;

const KEPT = 2;

function screenshotFileIdOf(productIndex: number, position: number): string {
  return `01JD0SHOT${String(productIndex * 100 + position).padStart(17, '0')}`;
}

function handlerRunIdOf(index: number): string {
  return `01JD0HRUN${String(index).padStart(17, '0')}`;
}

async function insertHandlerRun(
  index: number,
  eventIndex: number,
): Promise<void> {
  await db.insert(productLifecycleHandlerRuns).values({
    id: handlerRunIdOf(index),
    eventId: productEventIdOf(eventIndex),
    handlerName: `product-launch.handler-${String(index)}`,
    completedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

// プロダクトごとに、物理削除の対象の全てのテーブルへ行を入れる。番号はプロダクトの番号から作り、他のプロダクトの行と重ねない
async function insertProductRows(productIndex: number): Promise<void> {
  const base = productIndex * 10;
  await insertProduct(productIndex, OWNER, { deletedAt: T0 });
  await insertScreenshot(
    base + 1,
    productIndex,
    1,
    screenshotFileIdOf(productIndex, 1),
  );
  await insertScreenshot(
    base + 2,
    productIndex,
    0,
    screenshotFileIdOf(productIndex, 0),
  );
  await insertLaunch(base + 1, productIndex, {
    launchDate: '2026-10-01',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(base + 2, productIndex, { launchDate: '2026-11-20' });
  await insertProductPreviousHandle(
    base + 1,
    productIndex,
    `old${String(productIndex)}`,
    { deletedAt: T0 },
  );
  await insertProductEvent(base + 1, productIndex, {
    type: 'deleted',
    status: 'completed',
  });
  await insertProductEvent(base + 2, productIndex, { type: 'purge_due' });
  await insertHandlerRun(base + 1, base + 1);
  await insertHandlerRun(base + 2, base + 2);
}

async function countRowsOf(productIndex: number) {
  const productId = productIdOf(productIndex);
  const eventIds = db
    .select({ id: productLifecycleEvents.id })
    .from(productLifecycleEvents)
    .where(eq(productLifecycleEvents.productId, productId));
  const [
    [productRows],
    [screenshotRows],
    [launchRows],
    [previousHandleRows],
    [eventRows],
    [handlerRunRows],
  ] = await db.batch([
    db.select({ n: count() }).from(products).where(eq(products.id, productId)),
    db
      .select({ n: count() })
      .from(productScreenshots)
      .where(eq(productScreenshots.productId, productId)),
    db
      .select({ n: count() })
      .from(productLaunches)
      .where(eq(productLaunches.productId, productId)),
    db
      .select({ n: count() })
      .from(productPreviousHandles)
      .where(eq(productPreviousHandles.ownerId, productId)),
    db
      .select({ n: count() })
      .from(productLifecycleEvents)
      .where(eq(productLifecycleEvents.productId, productId)),
    db
      .select({ n: count() })
      .from(productLifecycleHandlerRuns)
      .where(inArray(productLifecycleHandlerRuns.eventId, eventIds)),
  ]);
  return {
    products: productRows?.n,
    screenshots: screenshotRows?.n,
    launches: launchRows?.n,
    previousHandles: previousHandleRows?.n,
    events: eventRows?.n,
    handlerRuns: handlerRunRows?.n,
  };
}

const ALL_ROWS = Object.freeze({
  products: 1,
  screenshots: 2,
  launches: 2,
  previousHandles: 1,
  events: 2,
  handlerRuns: 2,
});

const NO_ROWS = Object.freeze({
  products: 0,
  screenshots: 0,
  launches: 0,
  previousHandles: 0,
  events: 0,
  handlerRuns: 0,
});

async function userRowExists(userIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userIdOf(userIndex)));
  return rows.length === 1;
}

const store = new D1ProductPurgeStore(db);

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER, { deletedAt: T0 });
});

describe('D1ProductPurgeStore.imageFileIds', () => {
  test('ロゴとスクリーンショットのファイルのIDを、ロゴ・スクリーンショットの表示順に返す', async () => {
    await insertProductRows(PURGED);

    await expect(
      store.imageFileIds(productIdOf(PURGED)),
    ).resolves.toStrictEqual([
      logoFileIdOf(PURGED),
      screenshotFileIdOf(PURGED, 0),
      screenshotFileIdOf(PURGED, 1),
    ]);
  });

  test('スクリーンショットが無ければロゴだけを返し、他のプロダクトの画像を含めない', async () => {
    await insertProduct(PURGED, OWNER, { hiddenAt: T0 });
    await insertProductRows(KEPT);

    await expect(
      store.imageFileIds(productIdOf(PURGED)),
    ).resolves.toStrictEqual([logoFileIdOf(PURGED)]);
  });

  test('プロダクトの行が無ければundefinedを返す', async () => {
    await expect(
      store.imageFileIds(productIdOf(PURGED)),
    ).resolves.toBeUndefined();
  });
});

describe('D1ProductPurgeStore.purge', () => {
  test('プロダクトとその子の行・イベントと処理の記録を物理削除し、同じ投稿者の他のプロダクトの行は残す', async () => {
    await insertProductRows(PURGED);
    await insertProductRows(KEPT);

    await store.purge(productIdOf(PURGED));

    await expect(countRowsOf(PURGED)).resolves.toStrictEqual(NO_ROWS);
    await expect(countRowsOf(KEPT)).resolves.toStrictEqual(ALL_ROWS);
  });

  test('行が無いプロダクトや物理削除済みのプロダクトでも失敗せず、結果を変えない', async () => {
    await insertProductRows(PURGED);
    await store.purge(productIdOf(PURGED));

    await expect(store.purge(productIdOf(PURGED))).resolves.toBeUndefined();

    await expect(countRowsOf(PURGED)).resolves.toStrictEqual(NO_ROWS);
  });

  test('投稿者の全プロダクトを物理削除すると、利用者の物理削除が外部キーで失敗しない', async () => {
    await insertProductRows(PURGED);
    await insertProductRows(KEPT);
    const identityPurge = new D1IdentityPurgeStore(db);

    await expect(identityPurge.purge(userIdOf(OWNER))).rejects.toThrow();
    await expect(userRowExists(OWNER)).resolves.toBe(true);

    await store.purge(productIdOf(PURGED));
    await store.purge(productIdOf(KEPT));
    await identityPurge.purge(userIdOf(OWNER));

    await expect(userRowExists(OWNER)).resolves.toBe(false);
  });
});
