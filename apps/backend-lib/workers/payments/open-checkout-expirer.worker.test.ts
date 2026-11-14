import { resetSync } from '@logtape/logtape';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import type { PurchaseStatus } from '../../../common-lib/payments/purchase-states.ts';
import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import {
  type OpenCheckoutExpirer,
  type StripeGateway,
  StripeNotFoundError,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { StripeOpenCheckoutExpirer } from './open-checkout-expirer.ts';
import {
  type ReflectionHarness,
  harnessWith,
  insertPurchase,
  NOW,
  readGrants,
  sessionIdOf,
  setStatus,
  snapshotOf,
} from './testing/checkout-reflection-harness.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from './testing/fake-stripe-gateway.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
  await insertUser(2);
});

afterAll(() => {
  resetSync();
});

interface ExpirerHarness {
  readonly expirer: OpenCheckoutExpirer;
  readonly gateway: FakeStripeGateway;
  readonly reflection: ReflectionHarness;
}

// 決済セッションの反映は実際の部品で組み立て、Stripeだけを偽物にする
function expirerWith(handlers: Partial<StripeGateway> = {}): ExpirerHarness {
  const gateway = createFakeStripeGateway({
    expireCheckoutSession: () => Promise.resolve('expired'),
    ...handlers,
  });
  const reflection = harnessWith({ gateway });
  const clock = { now: () => NOW };
  const expirer = new StripeOpenCheckoutExpirer({
    appName: 'event',
    gateway,
    purchases: new D1PurchaseStore(db),
    reflection: reflection.reflection,
    ids: createUlidGenerator(clock),
    clock,
  });
  return { expirer, gateway, reflection };
}

async function statusOf(index: number): Promise<PurchaseStatus | undefined> {
  return (await readPurchaseRow(purchaseIdOf(index)))?.status;
}

function expiredSessionIds(gateway: FakeStripeGateway): readonly unknown[] {
  return gateway.callsOf('expireCheckoutSession').map(({ args }) => args[0]);
}

describe('未完了の決済セッションの失効の対象', () => {
  test('全種別を指定すると、利用者の未完了の購入の決済セッションを失効させて購入を失効にし、他の利用者の購入は変えない', async () => {
    await insertPurchase(1);
    await insertPurchase(2, { kind: 'ultras' });
    await insertPurchase(3, { userId: userIdOf(2) });
    const { expirer, gateway } = expirerWith();

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 2, remaining: false });
    expect(expiredSessionIds(gateway)).toEqual([
      sessionIdOf(1),
      sessionIdOf(2),
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'expired',
      lastEventAt: NOW,
    });
    expect(await statusOf(2)).toBe('expired');
    expect(await statusOf(3)).toBe('open');
  });

  test('購入種別と対象を指定すると、一致する購入だけを失効させる', async () => {
    await insertPurchase(1, { kind: 'sponsorship', targetId: 'target-1' });
    await insertPurchase(2, { kind: 'sponsorship', targetId: 'target-2' });
    await insertPurchase(3, { kind: 'ultras' });
    await insertPurchase(4);
    const { expirer, gateway } = expirerWith();

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: ['sponsorship'],
      targetId: 'target-1',
      limit: 50,
    });

    expect(result).toEqual({ expired: 1, remaining: false });
    expect(expiredSessionIds(gateway)).toEqual([sessionIdOf(1)]);
    expect(await statusOf(1)).toBe('expired');
    expect(await statusOf(2)).toBe('open');
    expect(await statusOf(3)).toBe('open');
    expect(await statusOf(4)).toBe('open');
  });

  test('対象を省いて複数の購入種別を指定すると、それらの種別の購入を対象を問わず失効させる', async () => {
    await insertPurchase(1, { kind: 'sponsorship', targetId: 'target-1' });
    await insertPurchase(2, { kind: 'ultras' });
    await insertPurchase(3);
    const { expirer } = expirerWith();

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: ['sponsorship', 'ultras'],
      limit: 50,
    });

    expect(result).toEqual({ expired: 2, remaining: false });
    expect(await statusOf(1)).toBe('expired');
    expect(await statusOf(2)).toBe('expired');
    expect(await statusOf(3)).toBe('open');
  });

  test('決済セッションの無い購入はStripeを呼ばずにそのまま残し、残りにも数えない', async () => {
    await insertPurchase(1, {}, { attachSession: false });
    const { expirer, gateway } = expirerWith();

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 0, remaining: false });
    expect(gateway.calls).toEqual([]);
    expect(await statusOf(1)).toBe('open');
  });

  test('完了した購入は対象にしない', async () => {
    await insertPurchase(1);
    await setStatus(1, 'fulfilled');
    await insertPurchase(2);
    await setStatus(2, 'expired');
    const { expirer, gateway } = expirerWith();

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 0, remaining: false });
    expect(gateway.calls).toEqual([]);
  });
});

describe('置き換え済みの購入', () => {
  test('旧セッションの失効が届いていない置き換え済みの購入も、決済セッションを失効させて購入を失効にし、失効の数に含める', async () => {
    await insertPurchase(1);
    await setStatus(1, 'superseded');
    await insertPurchase(2);
    const { expirer, gateway } = expirerWith();

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 2, remaining: false });
    expect(expiredSessionIds(gateway)).toEqual([
      sessionIdOf(1),
      sessionIdOf(2),
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'expired',
      lastEventAt: NOW,
    });
    expect(await statusOf(2)).toBe('expired');
  });

  test('Stripe上で既に支払いが完了していた置き換え済みの購入は反映して確定させ、失効の数に含めない', async () => {
    await insertPurchase(1);
    await setStatus(1, 'superseded');
    const { expirer, gateway } = expirerWith({
      expireCheckoutSession: () => Promise.resolve('not_open'),
      retrieveCheckoutSession: () => Promise.resolve(snapshotOf(1)),
    });

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 0, remaining: false });
    expect(
      gateway.callsOf('retrieveCheckoutSession').map(({ args }) => args[0]),
    ).toEqual([sessionIdOf(1)]);
    expect(await statusOf(1)).toBe('fulfilled');
    expect(await readRecords()).toHaveLength(1);
  });

  test('上限の外に置き換え済みの購入が残れば残りがあることを返し、続きの呼び出しで失効させて終わる', async () => {
    await insertPurchase(1);
    await setStatus(1, 'processing');
    await insertPurchase(2);
    await insertPurchase(3);
    await setStatus(3, 'superseded');
    const { expirer, gateway } = expirerWith();

    const first = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 1,
    });
    const second = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 1,
    });

    expect(first).toEqual({ expired: 1, remaining: true });
    expect(second).toEqual({ expired: 1, remaining: false });
    expect(expiredSessionIds(gateway)).toEqual([
      sessionIdOf(2),
      sessionIdOf(3),
    ]);
    expect(await statusOf(1)).toBe('processing');
    expect(await statusOf(3)).toBe('expired');
  });
});

describe('Stripe上で既に完了・失効していた決済セッション', () => {
  test('支払いが確定していた購入は通常どおり反映して権利を付与し、失効の数に含めない', async () => {
    await insertPurchase(1);
    const { expirer, gateway, reflection } = expirerWith({
      expireCheckoutSession: () => Promise.resolve('not_open'),
      retrieveCheckoutSession: () => Promise.resolve(snapshotOf(1)),
    });

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 0, remaining: false });
    expect(
      gateway.callsOf('retrieveCheckoutSession').map(({ args }) => args[0]),
    ).toEqual([sessionIdOf(1)]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
      paidAt: NOW,
      reflectedAt: NOW,
      lastEventAt: NOW,
    });
    expect(await readRecords()).toHaveLength(1);
    expect(await readGrants()).toHaveLength(1);
    expect(reflection.notifierCalls).toHaveLength(1);
  });

  test('Stripe上で失効済みだった購入は反映で失効にし、失効の数に含める', async () => {
    await insertPurchase(1);
    const { expirer } = expirerWith({
      expireCheckoutSession: () => Promise.resolve('not_open'),
      retrieveCheckoutSession: () =>
        Promise.resolve(
          snapshotOf(1, {
            status: 'expired',
            paymentStatus: 'unpaid',
            paymentIntentId: null,
            paymentIntentStatus: null,
          }),
        ),
    });

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 1, remaining: false });
    expect(await statusOf(1)).toBe('expired');
    expect(await readRecords()).toEqual([]);
  });

  test('支払いの確定を待つ処理中の購入は処理中のまま残し、残りにも数えない', async () => {
    await insertPurchase(1);
    await setStatus(1, 'processing');
    const { expirer, gateway } = expirerWith({
      expireCheckoutSession: () => Promise.resolve('not_open'),
      retrieveCheckoutSession: () =>
        Promise.resolve(
          snapshotOf(1, {
            paymentStatus: 'unpaid',
            paymentIntentStatus: 'processing',
          }),
        ),
    });

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 0, remaining: false });
    expect(expiredSessionIds(gateway)).toEqual([sessionIdOf(1)]);
    expect(await statusOf(1)).toBe('processing');
  });

  test('失効の間に他の入口が購入を完了させていたら、失効の数に含めない', async () => {
    await insertPurchase(1);
    const { expirer } = expirerWith({
      expireCheckoutSession: async () => {
        await setStatus(1, 'expired');
        return 'expired';
      },
    });

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 0, remaining: false });
  });

  test('Stripeに決済セッションが無い購入は、支払われ得ないため警告を残して失効にする', async () => {
    await insertPurchase(1);
    const logs = recordLogs('event');
    const { expirer } = expirerWith({
      expireCheckoutSession: () =>
        Promise.reject(new StripeNotFoundError('Stripeに対象がありません')),
    });

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 50,
    });

    expect(result).toEqual({ expired: 1, remaining: false });
    expect(await statusOf(1)).toBe('expired');
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
  });
});

describe('件数の上限と残りの有無', () => {
  test('上限を超える未完了の購入は作成の古い順に上限まで失効させ、残りがあることを返す', async () => {
    await insertPurchase(1);
    await insertPurchase(2);
    await insertPurchase(3);
    const { expirer, gateway } = expirerWith();

    const first = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 2,
    });

    expect(first).toEqual({ expired: 2, remaining: true });
    expect(expiredSessionIds(gateway)).toEqual([
      sessionIdOf(1),
      sessionIdOf(2),
    ]);
    expect(await statusOf(3)).toBe('open');

    const second = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 2,
    });

    expect(second).toEqual({ expired: 1, remaining: false });
    expect(await statusOf(3)).toBe('expired');
  });

  test('未払いの購入を処理中の購入より先に扱い、上限を超えた処理中の購入だけなら残りは無い', async () => {
    await insertPurchase(1);
    await setStatus(1, 'processing');
    await insertPurchase(2);
    const { expirer, gateway } = expirerWith();

    const result = await expirer.expireOpen({
      userId: userIdOf(1),
      kinds: 'all',
      limit: 1,
    });

    expect(result).toEqual({ expired: 1, remaining: false });
    expect(expiredSessionIds(gateway)).toEqual([sessionIdOf(2)]);
    expect(await statusOf(1)).toBe('processing');
    expect(await statusOf(2)).toBe('expired');
  });

  test.each([0, 51, 1.5])(
    '上限%sは範囲の外としてStripeを呼ばずに拒否する',
    async (limit) => {
      await insertPurchase(1);
      const { expirer, gateway } = expirerWith();

      await expect(
        expirer.expireOpen({ userId: userIdOf(1), kinds: 'all', limit }),
      ).rejects.toThrow(RangeError);
      expect(gateway.calls).toEqual([]);
      expect(await statusOf(1)).toBe('open');
    },
  );
});

describe('Stripeの一時的な失敗', () => {
  test('失効の一時的な失敗は例外で返し、それまでに失効させた購入は失効のまま、残りの購入は未完了のまま残す', async () => {
    await insertPurchase(1);
    await insertPurchase(2);
    await insertPurchase(3);
    const { expirer } = expirerWith({
      expireCheckoutSession: (sessionId) =>
        sessionId === sessionIdOf(2)
          ? Promise.reject(new StripeUnavailableError('一時的な失敗'))
          : Promise.resolve('expired'),
    });

    await expect(
      expirer.expireOpen({ userId: userIdOf(1), kinds: 'all', limit: 50 }),
    ).rejects.toThrow(StripeUnavailableError);
    expect(await statusOf(1)).toBe('expired');
    expect(await statusOf(2)).toBe('open');
    expect(await statusOf(3)).toBe('open');
  });

  test('完了済みだった決済セッションの取得の一時的な失敗は例外で返し、購入を変えない', async () => {
    await insertPurchase(1);
    const { expirer } = expirerWith({
      expireCheckoutSession: () => Promise.resolve('not_open'),
      retrieveCheckoutSession: () =>
        Promise.reject(new StripeUnavailableError('一時的な失敗')),
    });

    await expect(
      expirer.expireOpen({ userId: userIdOf(1), kinds: 'all', limit: 50 }),
    ).rejects.toThrow(StripeUnavailableError);
    expect(await statusOf(1)).toBe('open');
    expect(await readRecords()).toEqual([]);
  });
});
