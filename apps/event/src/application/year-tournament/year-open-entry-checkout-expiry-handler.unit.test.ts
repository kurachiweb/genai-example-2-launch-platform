import { describe, expect, test } from 'bun:test';

import type { OpenCheckoutExpirer } from '../../../lib/core/payments/ports.ts';
import type { UltrasActivation } from '../../../lib/core/ultras/activation-contract.ts';
import { YearOpenEntryCheckoutExpiryHandler } from './year-open-entry-checkout-expiry-handler.ts';

type ExpireOpenInput = Parameters<OpenCheckoutExpirer['expireOpen']>[0];

const USER_ID = '01JD0USER00000000000000001';

const ACTIVATION: UltrasActivation = Object.freeze({
  activationId: '01JC0ACTVTN000000000000001',
  userId: USER_ID,
  stripeSubscriptionId: 'sub_0123456789abcdef',
  activatedAt: new Date('2027-03-01T09:00:00.000Z'),
});

const EXPIRY_INPUT: ExpireOpenInput = {
  userId: USER_ID,
  kinds: ['year_tournament_entry'],
  limit: 50,
};

interface Harness {
  readonly handler: YearOpenEntryCheckoutExpiryHandler;
  readonly inputs: ExpireOpenInput[];
  readonly open: () => number;
}

// 失効の部品の契約(残りの未完了の決済を毎回選び直し、limit件まで失効させ、まだ残るかを返す)を写した偽物
function createHarness(initialOpen: number, failure?: Error): Harness {
  let open = initialOpen;
  const inputs: ExpireOpenInput[] = [];
  const expirer: OpenCheckoutExpirer = {
    expireOpen: (input) => {
      inputs.push(input);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const expired = Math.min(open, input.limit);
      open -= expired;
      return Promise.resolve({ expired, remaining: open > 0 });
    },
  };
  return {
    handler: new YearOpenEntryCheckoutExpiryHandler(expirer),
    inputs,
    open: () => open,
  };
}

describe('YearOpenEntryCheckoutExpiryHandler', () => {
  test('加入者の未完了の参加費の決済を、ローンチを限らずに失効させる', async () => {
    const { handler, inputs, open } = createHarness(3);

    await handler.handle(ACTIVATION);

    expect(inputs).toEqual([EXPIRY_INPUT]);
    expect(inputs[0]).not.toHaveProperty('targetId');
    expect(open()).toBe(0);
  });

  test('残りが無くなるまで失効を繰り返す', async () => {
    const { handler, inputs, open } = createHarness(120);

    await handler.handle(ACTIVATION);

    expect(inputs).toEqual([EXPIRY_INPUT, EXPIRY_INPUT, EXPIRY_INPUT]);
    expect(open()).toBe(0);
  });

  test('5回目で残りが無くなれば例外を投げずに終える', async () => {
    const { handler, inputs, open } = createHarness(250);

    await handler.handle(ACTIVATION);

    expect(inputs).toHaveLength(5);
    expect(open()).toBe(0);
  });

  test('5回失効させても残れば、それ以上呼ばずに例外を投げて知らせ全体の再試行に任せる', async () => {
    const { handler, inputs, open } = createHarness(251);

    const caught = await handler
      .handle(ACTIVATION)
      .catch((thrown: unknown) => thrown);

    expect(caught).toBeInstanceOf(Error);
    expect(inputs).toHaveLength(5);
    expect(open()).toBe(1);
  });

  test('同じ知らせを2回処理しても結果が変わらない', async () => {
    const { handler, inputs, open } = createHarness(3);

    await handler.handle(ACTIVATION);
    await handler.handle(ACTIVATION);

    expect(inputs).toEqual([EXPIRY_INPUT, EXPIRY_INPUT]);
    expect(open()).toBe(0);
  });

  test('失効の失敗はそのまま投げる', async () => {
    const error = new Error('一時的な失敗');
    const { handler, inputs } = createHarness(3, error);

    const caught = await handler
      .handle(ACTIVATION)
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
    expect(inputs).toHaveLength(1);
  });
});
