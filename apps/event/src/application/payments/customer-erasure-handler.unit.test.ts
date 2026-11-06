import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  type CustomerStore,
  type StripeGateway,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import { CustomerErasureHandler } from './customer-erasure-handler.ts';
import type { PaymentAccountDataEraser } from './payment-account-data-eraser.ts';

const USER_ID = '01JC0USER00000000000000001';
const CUSTOMER_ID = 'cus_test_erasure_1';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JC0EVT000000000000000040',
  userId: USER_ID,
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

// 使わないメソッドを呼んだら失敗させ、処理が想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

interface Harness {
  readonly handler: CustomerErasureHandler;
  readonly calls: readonly string[];
}

// Customerの対応の行を消した後の呼び出しでは行が無いように振る舞い、2回目の呼び出しの結果を確かめられるようにする
function harnessWith(
  options: {
    readonly customerId?: string;
    readonly deleteCustomer?: StripeGateway['deleteCustomer'];
    readonly erase?: PaymentAccountDataEraser['erase'];
  } = {},
): Harness {
  const calls: string[] = [];
  let storedCustomerId =
    'customerId' in options ? options.customerId : CUSTOMER_ID;
  const customers = partialFake<CustomerStore>({
    find: (userId) => {
      calls.push(`customers.find:${userId}`);
      return Promise.resolve(storedCustomerId);
    },
  });
  const gateway = partialFake<StripeGateway>({
    deleteCustomer: (customerId) => {
      calls.push(`gateway.deleteCustomer:${customerId}`);
      return options.deleteCustomer?.(customerId) ?? Promise.resolve('deleted');
    },
  });
  const eraser: PaymentAccountDataEraser = {
    erase: async (userId) => {
      calls.push(`eraser.erase:${userId}`);
      await (options.erase?.(userId) ?? Promise.resolve());
      storedCustomerId = undefined;
    },
  };
  return {
    handler: new CustomerErasureHandler(customers, gateway, eraser),
    calls,
  };
}

describe('CustomerErasureHandler', () => {
  test('利用者のCustomerをStripeで削除してから、利用者の決済の行を削除して完了を返す', async () => {
    const { handler, calls } = harnessWith();

    expect(await handler.handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([
      `customers.find:${USER_ID}`,
      `gateway.deleteCustomer:${CUSTOMER_ID}`,
      `eraser.erase:${USER_ID}`,
    ]);
  });

  test('Stripe上に既にCustomerが無ければ削除済みとして扱い、利用者の決済の行を削除する', async () => {
    const { handler, calls } = harnessWith({
      deleteCustomer: () => Promise.resolve('already_deleted'),
    });

    expect(await handler.handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([
      `customers.find:${USER_ID}`,
      `gateway.deleteCustomer:${CUSTOMER_ID}`,
      `eraser.erase:${USER_ID}`,
    ]);
  });

  test('Customerの対応が無い利用者は、Stripeを呼ばずに決済の行の削除だけを行う', async () => {
    const { handler, calls } = harnessWith({ customerId: undefined });

    expect(await handler.handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([
      `customers.find:${USER_ID}`,
      `eraser.erase:${USER_ID}`,
    ]);
  });

  test('同じイベントで2回呼んでも、2回目はStripeを呼ばずに完了を返す', async () => {
    const { handler, calls } = harnessWith();
    await handler.handle(EVENT);

    expect(await handler.handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([
      `customers.find:${USER_ID}`,
      `gateway.deleteCustomer:${CUSTOMER_ID}`,
      `eraser.erase:${USER_ID}`,
      `customers.find:${USER_ID}`,
      `eraser.erase:${USER_ID}`,
    ]);
  });

  test('Stripeの一時的な失敗は捕まえずに投げ、利用者の決済の行を消さずにメッセージの再試行に任せる', async () => {
    const failure = new StripeUnavailableError('Stripeの障害');
    const { handler, calls } = harnessWith({
      deleteCustomer: () => Promise.reject(failure),
    });

    expect(await handler.handle(EVENT).catch((thrown: unknown) => thrown)).toBe(
      failure,
    );
    expect(calls).toStrictEqual([
      `customers.find:${USER_ID}`,
      `gateway.deleteCustomer:${CUSTOMER_ID}`,
    ]);
  });

  test('決済の行の削除の失敗は捕まえずに投げる', async () => {
    const failure = new Error('D1の障害');
    const { handler } = harnessWith({ erase: () => Promise.reject(failure) });

    expect(await handler.handle(EVENT).catch((thrown: unknown) => thrown)).toBe(
      failure,
    );
  });
});
