import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { SubscriptionErasureHandler } from './subscription-erasure-handler.ts';
import type { UltrasAccountDataEraser } from './ultras-account-data-eraser.ts';

const USER_ID = '01JC0USER00000000000000001';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JC0EVT000000000000000051',
  userId: USER_ID,
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

function eraserWith(erase?: UltrasAccountDataEraser['erase']): {
  readonly eraser: UltrasAccountDataEraser;
  readonly erased: readonly string[];
} {
  const erased: string[] = [];
  return {
    eraser: {
      erase: (userId) => {
        erased.push(userId);
        return erase?.(userId) ?? Promise.resolve();
      },
    },
    erased,
  };
}

describe('SubscriptionErasureHandler', () => {
  test('物理削除の時期に、利用者のUltrasの行の削除の書き込みの単位を1回呼び、完了を返す', async () => {
    const { eraser, erased } = eraserWith();

    expect(
      await new SubscriptionErasureHandler(eraser).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
    expect(erased).toStrictEqual([USER_ID]);
  });

  test('同じイベントで2回呼んでも、毎回削除の書き込みの単位を呼んで完了を返す', async () => {
    const { eraser, erased } = eraserWith();
    const handler = new SubscriptionErasureHandler(eraser);
    await handler.handle(EVENT);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(erased).toStrictEqual([USER_ID, USER_ID]);
  });

  test('削除の失敗は捕まえずに投げ、波及処理の再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const { eraser } = eraserWith(() => Promise.reject(failure));

    expect(
      await new SubscriptionErasureHandler(eraser)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
