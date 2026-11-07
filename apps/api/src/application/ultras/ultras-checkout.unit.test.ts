import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type {
  CheckoutStarter,
  CheckoutStartInput,
} from '../payments/checkout-starter.ts';
import { DefaultUltrasCheckout } from './ultras-checkout.ts';

const PURCHASE_ID = '01JD0000000000000000PURC01';

const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: '01JD0000000000000000USER01',
      sessionId: '01JD0000000000000000SESS01',
    }),
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}

function createStarter(
  inputs: CheckoutStartInput[],
  failure?: Error,
): CheckoutStarter {
  return {
    start: (input) => {
      inputs.push(input);
      return failure === undefined
        ? Promise.resolve({ purchaseId: PURCHASE_ID })
        : Promise.reject(failure);
    },
  };
}

describe('DefaultUltrasCheckout', () => {
  test('同じセッションを渡し、購入種別ultrasで対象の無い決済の開始を呼んで購入のIDを返す', async () => {
    const inputs: CheckoutStartInput[] = [];
    const checkout = new DefaultUltrasCheckout(createStarter(inputs));

    const result = await checkout.start(SESSION);

    expect(result).toEqual({ purchaseId: PURCHASE_ID });
    expect(inputs).toEqual([
      { session: SESSION, kind: 'ultras', targetId: null },
    ]);
  });

  test('Ultrasはbot判定を求めないため、bot判定の口を渡さない', async () => {
    const inputs: CheckoutStartInput[] = [];
    const checkout = new DefaultUltrasCheckout(createStarter(inputs));

    await checkout.start(SESSION);

    expect(inputs[0] !== undefined && 'humanCheck' in inputs[0]).toBe(false);
  });

  test('決済の開始の拒否はそのまま投げ直す', async () => {
    const rejection = new AppError({
      kind: 'unprocessable',
      code: 'ultras_already_subscribed',
      message: '既にUltrasに加入しています。',
    });
    const checkout = new DefaultUltrasCheckout(createStarter([], rejection));

    expect(await rejectionOf(checkout.start(SESSION))).toBe(rejection);
  });
});
