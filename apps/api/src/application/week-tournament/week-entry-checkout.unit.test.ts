import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type {
  CheckoutStarter,
  CheckoutStartInput,
} from '../payments/checkout-starter.ts';
import { launchIdOf } from './testing/week-decision-fakes.ts';
import { DefaultWeekEntryCheckout } from './week-entry-checkout.ts';

const PURCHASE_ID = '01JF0WPRCH0000000000000001';

const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: '01JF0WACCT0000000000000001',
      sessionId: '01JF0WSESS0000000000000001',
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

describe('DefaultWeekEntryCheckout', () => {
  test('同じセッションを渡し、購入種別week_tournament_entryとローンチのIDで決済の開始を呼んで購入のIDを返す', async () => {
    const inputs: CheckoutStartInput[] = [];
    const checkout = new DefaultWeekEntryCheckout(createStarter(inputs));

    const result = await checkout.start(SESSION, launchIdOf(1));

    expect(result).toEqual({ purchaseId: PURCHASE_ID });
    expect(inputs).toEqual([
      {
        session: SESSION,
        kind: 'week_tournament_entry',
        targetId: launchIdOf(1),
      },
    ]);
  });

  test('参加費はbot判定を求めないため、bot判定の口を渡さない', async () => {
    const inputs: CheckoutStartInput[] = [];
    const checkout = new DefaultWeekEntryCheckout(createStarter(inputs));

    await checkout.start(SESSION, launchIdOf(1));

    expect(inputs[0] !== undefined && 'humanCheck' in inputs[0]).toBe(false);
  });

  test('決済の開始の拒否はそのまま投げ直す', async () => {
    const rejection = new AppError({
      kind: 'unprocessable',
      code: 'week_entry_exempt',
      message: 'Ultrasの特典により参加費は免除されます。',
    });
    const checkout = new DefaultWeekEntryCheckout(createStarter([], rejection));

    expect(await rejectionOf(checkout.start(SESSION, launchIdOf(1)))).toBe(
      rejection,
    );
  });
});
