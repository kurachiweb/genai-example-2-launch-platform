import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { paymentPurchases } from '../../../db/schema/payments/payment-purchases.ts';
import { D1DisplayStopStore } from '../../../lib/workers/sponsorship/d1-display-stop-store.ts';
import {
  clearSponsorshipTables,
  db,
  displayStopIdOf,
  insertDisplayStops,
  insertSponsorProduct,
  insertSponsorshipPurchase,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  productIdOf,
  readDisplayStopRows,
  readSponsorshipIds,
  sponsorshipIdOf,
  sponsorshipPurchaseIdOf,
  terminatedColumnsOf,
  userIdOf,
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import type { SponsorshipPurgeStore } from '../../application/sponsorship/ports.ts';
import { D1SponsorshipPurgeStore } from './d1-sponsorship-purge-store.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const PURGED_USER = 1;

const OTHER_USER = 2;

// 利用者1のプロダクト1・2と、利用者2のプロダクト3
const PURGED_PRODUCT = 1;

const OTHER_PRODUCT_OF_PURGED_USER = 2;

const OTHER_USERS_PRODUCT = 3;

const store: SponsorshipPurgeStore = new D1SponsorshipPurgeStore(
  db,
  new D1DisplayStopStore(db),
);

async function readPurchaseIds(): Promise<string[]> {
  const rows = await db
    .select({ id: paymentPurchases.id })
    .from(paymentPurchases)
    .orderBy(asc(paymentPurchases.id));
  return rows.map(({ id }) => id);
}

async function readDisplayStopIds(): Promise<string[]> {
  const rows = await readDisplayStopRows();
  return rows.map(({ id }) => id);
}

// 申込1(決済済み)・2(未決済)はプロダクト1、3(強制終了)はプロダクト2、4(決済済み)は利用者2のプロダクト3への申込。
// 表示停止の区間1はプロダクト1、2はプロダクト2、3は利用者1、4は利用者2、5はプロダクト3のもの
async function arrangeSponsorships(): Promise<void> {
  await insertSponsorUser(PURGED_USER, 'withdrawn');
  await insertSponsorUser(OTHER_USER);
  await insertSponsorProduct({
    index: PURGED_PRODUCT,
    owner: PURGED_USER,
    state: 'deleted',
  });
  await insertSponsorProduct({
    index: OTHER_PRODUCT_OF_PURGED_USER,
    owner: PURGED_USER,
  });
  await insertSponsorProduct({ index: OTHER_USERS_PRODUCT, owner: OTHER_USER });
  await insertSponsorships([
    {
      index: 1,
      owner: PURGED_USER,
      product: PURGED_PRODUCT,
      columns: paidColumnsOf(1),
    },
    { index: 2, owner: PURGED_USER, product: PURGED_PRODUCT },
    {
      index: 3,
      owner: PURGED_USER,
      product: OTHER_PRODUCT_OF_PURGED_USER,
      columns: terminatedColumnsOf(3),
    },
    {
      index: 4,
      owner: OTHER_USER,
      product: OTHER_USERS_PRODUCT,
      columns: paidColumnsOf(4),
    },
  ]);
  for (const [index, owner] of [
    [1, PURGED_USER],
    [3, PURGED_USER],
    [4, OTHER_USER],
  ] as const) {
    await insertSponsorshipPurchase({ index, owner });
  }
  await insertDisplayStops([
    {
      index: 1,
      subject: { kind: 'product', productId: productIdOf(PURGED_PRODUCT) },
      startedAt: NOW,
    },
    {
      index: 2,
      subject: {
        kind: 'product',
        productId: productIdOf(OTHER_PRODUCT_OF_PURGED_USER),
      },
      startedAt: NOW,
    },
    {
      index: 3,
      subject: { kind: 'user', userId: userIdOf(PURGED_USER) },
      startedAt: NOW,
    },
    {
      index: 4,
      subject: { kind: 'user', userId: userIdOf(OTHER_USER) },
      startedAt: NOW,
    },
    {
      index: 5,
      subject: { kind: 'product', productId: productIdOf(OTHER_USERS_PRODUCT) },
      startedAt: NOW,
      endedAt: new Date(NOW.getTime() + 60_000),
    },
  ]);
}

const ALL_PURCHASE_IDS = [1, 3, 4].map(sponsorshipPurchaseIdOf);

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearSponsorshipTables();
  await arrangeSponsorships();
});

describe('D1SponsorshipPurgeStore.purgeByProduct', () => {
  test('プロダクトの全ての申込とそのプロダクトの表示停止の区間を消し、他のプロダクト・利用者の行と決済の購入を残す', async () => {
    await store.purgeByProduct(productIdOf(PURGED_PRODUCT));

    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      [3, 4].map(sponsorshipIdOf),
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(
      [2, 3, 4, 5].map(displayStopIdOf),
    );
    await expect(readPurchaseIds()).resolves.toStrictEqual(ALL_PURCHASE_IDS);
  });

  test('2回実行しても結果が変わらない', async () => {
    await store.purgeByProduct(productIdOf(PURGED_PRODUCT));
    const sponsorshipsAfterFirst = await readSponsorshipIds();
    const stopsAfterFirst = await readDisplayStopIds();

    await store.purgeByProduct(productIdOf(PURGED_PRODUCT));

    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      sponsorshipsAfterFirst,
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(stopsAfterFirst);
  });
});

describe('D1SponsorshipPurgeStore.purgeByUser', () => {
  test('利用者の全ての申込と利用者の表示停止の区間を消し、プロダクトの区間と他の利用者の行と決済の購入を残す', async () => {
    await store.purgeByUser(userIdOf(PURGED_USER));

    await expect(readSponsorshipIds()).resolves.toStrictEqual([
      sponsorshipIdOf(4),
    ]);
    await expect(readDisplayStopIds()).resolves.toStrictEqual(
      [1, 2, 4, 5].map(displayStopIdOf),
    );
    await expect(readPurchaseIds()).resolves.toStrictEqual(ALL_PURCHASE_IDS);
  });

  test('2回実行しても結果が変わらない', async () => {
    await store.purgeByUser(userIdOf(PURGED_USER));
    const sponsorshipsAfterFirst = await readSponsorshipIds();
    const stopsAfterFirst = await readDisplayStopIds();

    await store.purgeByUser(userIdOf(PURGED_USER));

    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      sponsorshipsAfterFirst,
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(stopsAfterFirst);
  });
});
