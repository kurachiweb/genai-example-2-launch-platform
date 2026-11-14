import { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import { D1PurchaseStore } from '../../../lib/workers/payments/d1-purchase-store.ts';
import type { PurchaseStatements } from '../../../lib/workers/payments/statement-contracts.ts';
import {
  clearPaymentTables,
  createRecordingDatabase,
  db,
  insertUser,
  newPurchase,
  purchaseIdOf,
  readPurchaseRow,
  tokenOf,
  userIdOf,
} from '../../../lib/workers/payments/testing/payment-store-fixtures.ts';
import type { CheckoutPurchaseWriter } from '../../application/payments/checkout-ports.ts';
import { API_PAYMENTS_TYPES } from '../../application/payments/payments-types.ts';
import { D1CheckoutPurchaseWriter } from './d1-checkout-purchase-writer.ts';

function sequentialTokens(): IdGenerator {
  let next = 900;
  return {
    generate: () => {
      next += 1;
      return tokenOf(next);
    },
  };
}

function writerOn(database: Database): CheckoutPurchaseWriter {
  return new D1CheckoutPurchaseWriter(
    database,
    new D1PurchaseStore(database),
    sequentialTokens(),
  );
}

async function createPurchase(index: number, userIndex = 1): Promise<void> {
  const store = new D1PurchaseStore(db);
  await db.batch([
    store.create(newPurchase(index, { userId: userIdOf(userIndex) })),
  ]);
}

async function advance(
  index: number,
  to: 'fulfilled' | 'expired' | 'processing',
): Promise<void> {
  const store = new D1PurchaseStore(db);
  await db.batch([
    store.advance({
      purchaseId: purchaseIdOf(index),
      to,
      from: ['open'],
      nextToken: tokenOf(index + 500),
      patch: {},
    }),
  ]);
}

async function statusOf(index: number): Promise<string | undefined> {
  return (await readPurchaseRow(purchaseIdOf(index)))?.status;
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

describe('D1CheckoutPurchaseWriter.replaceOpen', () => {
  test('同じ対象の未完了の購入の置き換えと新しい購入の作成を、1回の一括の書き込みで確定する', async () => {
    await createPurchase(1);
    await createPurchase(2);
    const recording = createRecordingDatabase();

    await writerOn(recording.database).replaceOpen({
      purchase: newPurchase(3),
      supersede: [purchaseIdOf(1), purchaseIdOf(2)],
    });

    expect(recording.batchSizes).toEqual([3]);
    expect(await statusOf(1)).toBe('superseded');
    expect(await statusOf(2)).toBe('superseded');
    expect(await readPurchaseRow(purchaseIdOf(3))).toMatchObject({
      status: 'open',
      stateToken: tokenOf(3),
      stripeCheckoutSessionId: null,
    });
  });

  test('置き換えた購入のstate_tokenを新しい値に変える', async () => {
    await createPurchase(1);

    await writerOn(db).replaceOpen({
      purchase: newPurchase(2),
      supersede: [purchaseIdOf(1)],
    });

    const row = await readPurchaseRow(purchaseIdOf(1));
    expect(row?.stateToken).not.toBe(tokenOf(1));
    expect(row?.stateToken).toBe(tokenOf(901));
  });

  test('置き換える購入が無ければ、新しい購入だけを1回の一括の書き込みで作る', async () => {
    const recording = createRecordingDatabase();

    await writerOn(recording.database).replaceOpen({
      purchase: newPurchase(1),
      supersede: [],
    });

    expect(recording.batchSizes).toEqual([1]);
    expect(await statusOf(1)).toBe('open');
  });

  test('openでなくなった購入(完了・処理中・失効)は置き換えない', async () => {
    await createPurchase(1);
    await createPurchase(2);
    await createPurchase(3);
    await advance(1, 'fulfilled');
    await advance(2, 'processing');
    await advance(3, 'expired');

    await writerOn(db).replaceOpen({
      purchase: newPurchase(4),
      supersede: [purchaseIdOf(1), purchaseIdOf(2), purchaseIdOf(3)],
    });

    expect([await statusOf(1), await statusOf(2), await statusOf(3)]).toEqual([
      'fulfilled',
      'processing',
      'expired',
    ]);
    expect(await statusOf(4)).toBe('open');
  });

  test('新しい購入の作成が失敗すると、置き換えも取り消される', async () => {
    await createPurchase(1);
    await createPurchase(2);

    await expect(
      writerOn(db).replaceOpen({
        purchase: newPurchase(2),
        supersede: [purchaseIdOf(1)],
      }),
    ).rejects.toThrow();

    expect(await statusOf(1)).toBe('open');
  });
});

describe('D1CheckoutPurchaseWriter.expire', () => {
  test('openの購入をexpiredにし、state_tokenを新しい値に変える', async () => {
    await createPurchase(1);

    await writerOn(db).expire(purchaseIdOf(1));

    const row = await readPurchaseRow(purchaseIdOf(1));
    expect(row?.status).toBe('expired');
    expect(row?.stateToken).toBe(tokenOf(901));
  });

  test('openでない購入は変えない', async () => {
    await createPurchase(1);
    await advance(1, 'processing');

    await writerOn(db).expire(purchaseIdOf(1));

    expect(await statusOf(1)).toBe('processing');
  });
});

describe('D1CheckoutPurchaseWriterの束縛', () => {
  test('コンテナでデータベース・購入の文・IDの生成を注入して解決できる', async () => {
    const container = new Container();
    container.bind<Database>(PLATFORM_TYPES.Database).toConstantValue(db);
    container
      .bind<PurchaseStatements>(PAYMENTS_TYPES.PurchaseStatements)
      .toConstantValue(new D1PurchaseStore(db));
    container
      .bind<IdGenerator>(PLATFORM_TYPES.IdGenerator)
      .toConstantValue(sequentialTokens());
    container
      .bind<CheckoutPurchaseWriter>(API_PAYMENTS_TYPES.CheckoutPurchaseWriter)
      .to(D1CheckoutPurchaseWriter);

    const writer = container.get<CheckoutPurchaseWriter>(
      API_PAYMENTS_TYPES.CheckoutPurchaseWriter,
    );
    await writer.replaceOpen({ purchase: newPurchase(1), supersede: [] });

    expect(await statusOf(1)).toBe('open');
  });
});
