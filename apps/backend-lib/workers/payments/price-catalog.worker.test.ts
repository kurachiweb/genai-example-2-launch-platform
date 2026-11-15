import { resetSync } from '@logtape/logtape';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import {
  type StripePrice,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import { D1PriceSnapshotStore } from './d1-price-snapshot-store.ts';
import { StripePriceCatalog } from './price-catalog.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from './testing/fake-stripe-gateway.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  after,
  clearPaymentTables,
  db,
} from './testing/payment-store-fixtures.ts';

const MINUTE = 60_000;

const snapshots = new D1PriceSnapshotStore(db);

const ENTRY: StripePrice = {
  lookupKey: 'week_tournament_entry_v1',
  priceId: 'price_entry',
  unitAmount: 1500,
  currency: 'usd',
  recurringInterval: null,
};

const ULTRAS: StripePrice = {
  lookupKey: 'ultras_monthly_v1',
  priceId: 'price_ultras',
  unitAmount: 500,
  currency: 'usd',
  recurringInterval: 'month',
};

function priceChanged(price: StripePrice, unitAmount: number): StripePrice {
  return { ...price, priceId: `${price.priceId}_new`, unitAmount };
}

function catalogAt(now: Date, gateway: FakeStripeGateway): StripePriceCatalog {
  return new StripePriceCatalog({
    appName: 'api',
    gateway,
    snapshots,
    clock: { now: () => now },
  });
}

function resolving(
  prices: readonly StripePrice[],
): Pick<FakeStripeGateway, 'resolvePrices'> {
  return {
    resolvePrices: (lookupKeys) =>
      Promise.resolve(
        prices.filter(({ lookupKey }) => lookupKeys.includes(lookupKey)),
      ),
  };
}

function unreachable(): FakeStripeGateway {
  return createFakeStripeGateway({
    resolvePrices: () =>
      Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
  });
}

beforeEach(async () => {
  await clearPaymentTables();
});

afterAll(() => {
  resetSync();
});

describe('StripePriceCatalog', () => {
  test('保持が無ければStripeから照会して保存し、要求の順に返す', async () => {
    const gateway = createFakeStripeGateway(resolving([ENTRY, ULTRAS]));

    const result = await catalogAt(after(0), gateway).getPrices([
      ULTRAS.lookupKey,
      ENTRY.lookupKey,
    ]);

    expect(result).toEqual({ prices: [ULTRAS, ENTRY], stale: false });
    expect(gateway.callsOf('resolvePrices')).toHaveLength(1);
    expect(
      await snapshots.findMany([ENTRY.lookupKey, ULTRAS.lookupKey]),
    ).toHaveLength(2);
  });

  test('10分以内に照会した価格はStripeに問い合わせずに返す', async () => {
    await snapshots.saveMany([ENTRY, ULTRAS], after(0));
    const gateway = createFakeStripeGateway();

    const result = await catalogAt(after(10 * MINUTE), gateway).getPrices([
      ENTRY.lookupKey,
      ULTRAS.lookupKey,
    ]);

    expect(result).toEqual({ prices: [ENTRY, ULTRAS], stale: false });
    expect(gateway.calls).toHaveLength(0);
  });

  test('10分を過ぎた価格だけをStripeから取り直し、取得時刻とともに保存する', async () => {
    await snapshots.saveMany([ENTRY], after(0));
    await snapshots.saveMany([ULTRAS], after(5 * MINUTE));
    const newEntry = priceChanged(ENTRY, 2000);
    const gateway = createFakeStripeGateway(resolving([newEntry, ULTRAS]));
    const now = after(10 * MINUTE + 1);

    const result = await catalogAt(now, gateway).getPrices([
      ENTRY.lookupKey,
      ULTRAS.lookupKey,
    ]);

    expect(result).toEqual({ prices: [newEntry, ULTRAS], stale: false });
    expect(gateway.callsOf('resolvePrices')).toEqual([
      { method: 'resolvePrices', args: [[ENTRY.lookupKey]] },
    ]);
    expect(await snapshots.findMany([ENTRY.lookupKey])).toEqual([
      { ...newEntry, fetchedAt: now },
    ]);
  });

  test('Stripeで決済に使えない価格は返さない', async () => {
    const gateway = createFakeStripeGateway(resolving([ENTRY]));

    const result = await catalogAt(after(0), gateway).getPrices([
      ENTRY.lookupKey,
      'unknown_v1',
    ]);

    expect(result).toEqual({ prices: [ENTRY], stale: false });
  });

  test('同じキーを重ねて求めても1件ずつ照会して返す', async () => {
    const gateway = createFakeStripeGateway(resolving([ENTRY]));

    const result = await catalogAt(after(0), gateway).getPrices([
      ENTRY.lookupKey,
      ENTRY.lookupKey,
    ]);

    expect(result).toEqual({ prices: [ENTRY], stale: false });
    expect(gateway.callsOf('resolvePrices')).toEqual([
      { method: 'resolvePrices', args: [[ENTRY.lookupKey]] },
    ]);
  });

  test('Stripeに到達できなければ、以前に照会した価格を古い値として返しwarningのログを残す', async () => {
    await snapshots.saveMany([ENTRY], after(0));
    await snapshots.saveMany([ULTRAS], after(30 * MINUTE));
    const logs = recordLogs();

    const result = await catalogAt(after(31 * MINUTE), unreachable()).getPrices(
      [ENTRY.lookupKey, ULTRAS.lookupKey],
    );

    expect(result).toEqual({ prices: [ENTRY, ULTRAS], stale: true });
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
    expect(await snapshots.findMany([ENTRY.lookupKey])).toEqual([
      { ...ENTRY, fetchedAt: after(0) },
    ]);
  });

  test('Stripeに到達できず以前の価格も無ければ、現在利用できない旨のエラーにする', async () => {
    const failure = await catalogAt(after(0), unreachable())
      .getPrices([ENTRY.lookupKey])
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({
      kind: 'unavailable',
      code: 'payments_unavailable',
      message:
        '現在、決済をご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。',
    });
  });

  test('Stripeの恒久的な拒否は古い値で隠さずに例外のまま返す', async () => {
    await snapshots.saveMany([ENTRY], after(0));
    const rejected = new StripeRejectedError({
      message: '拒否されました',
      stripeErrorCode: 'invalid_request_error',
    });
    const gateway = createFakeStripeGateway({
      resolvePrices: () => Promise.reject(rejected),
    });

    await expect(
      catalogAt(after(11 * MINUTE), gateway).getPrices([ENTRY.lookupKey]),
    ).rejects.toBe(rejected);
  });

  test('空の要求ではStripeにもD1にも問い合わせずに空を返す', async () => {
    const gateway = createFakeStripeGateway();

    expect(await catalogAt(after(0), gateway).getPrices([])).toEqual({
      prices: [],
      stale: false,
    });
    expect(gateway.calls).toHaveLength(0);
  });
});
