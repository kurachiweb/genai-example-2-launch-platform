import { describe, expect, test } from 'bun:test';

import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type { QuarantineReason } from '../../../lib/core/media/media-file.ts';
import type {
  MediaQuarantine,
  OwnerBatchResult,
  OwnerRef,
} from '../../../lib/core/media/ports.ts';
import { OwnedImageQuarantineHandler } from './owned-image-quarantine-handler.ts';

const USER_ID = '01JC0USER00000000000000001';

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return Object.freeze({
    id: '01JC0EVT000000000000000063',
    userId: USER_ID,
    type,
    occurredAt: new Date('2026-11-20T00:00:00.000Z'),
  });
}

interface Call {
  readonly operation: 'addReasonForOwner' | 'removeReasonForOwner';
  readonly owner: OwnerRef;
  readonly reason: QuarantineReason;
}

function createFakeQuarantine(results: readonly OwnerBatchResult[]): {
  readonly quarantine: MediaQuarantine;
  readonly calls: readonly Call[];
} {
  const calls: Call[] = [];
  const pending = [...results];
  const respond = (call: Call): Promise<OwnerBatchResult> => {
    calls.push(call);
    const next = pending.shift();
    return next === undefined
      ? Promise.reject(new Error('想定外の呼び出し'))
      : Promise.resolve(next);
  };
  // 本タスクが呼ぶのは保有者単位の理由の追加と取り除きだけで、他の操作は呼ばれたら失敗させる
  const quarantine = {
    addReasonForOwner: (owner: OwnerRef, reason: QuarantineReason) =>
      respond({ operation: 'addReasonForOwner', owner, reason }),
    removeReasonForOwner: (owner: OwnerRef, reason: QuarantineReason) =>
      respond({ operation: 'removeReasonForOwner', owner, reason }),
  } as unknown as MediaQuarantine;
  return { quarantine, calls };
}

describe('OwnedImageQuarantineHandler', () => {
  test('停止では、イベントの利用者を保有者にユーザー停止の隔離理由を加える', async () => {
    const { quarantine, calls } = createFakeQuarantine([
      { processed: 2, hasMore: false },
    ]);

    expect(
      await new OwnedImageQuarantineHandler(quarantine).handle(
        eventOf('suspended'),
      ),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      {
        operation: 'addReasonForOwner',
        owner: { kind: 'user', id: USER_ID },
        reason: 'user_suspended',
      },
    ]);
  });

  test('停止解除では、イベントの利用者を保有者にユーザー停止の隔離理由を取り除く', async () => {
    const { quarantine, calls } = createFakeQuarantine([
      { processed: 2, hasMore: false },
    ]);

    expect(
      await new OwnedImageQuarantineHandler(quarantine).handle(
        eventOf('unsuspended'),
      ),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      {
        operation: 'removeReasonForOwner',
        owner: { kind: 'user', id: USER_ID },
        reason: 'user_suspended',
      },
    ]);
  });

  test.each(['suspended', 'unsuspended'] as const)(
    '%sで残りがあれば続きを返す',
    async (type) => {
      const { quarantine } = createFakeQuarantine([
        { processed: 1000, hasMore: true },
      ]);

      expect(
        await new OwnedImageQuarantineHandler(quarantine).handle(eventOf(type)),
      ).toStrictEqual({ kind: 'continue' });
    },
  );

  test.each(['suspended', 'unsuspended'] as const)(
    '%sで画像が1件も無くても完了を返す',
    async (type) => {
      const { quarantine } = createFakeQuarantine([
        { processed: 0, hasMore: false },
      ]);

      expect(
        await new OwnedImageQuarantineHandler(quarantine).handle(eventOf(type)),
      ).toStrictEqual({ kind: 'done' });
    },
  );

  test.each(['withdrawn', 'purge_due'] as const)(
    '停止・停止解除以外の種類(%s)のイベントでは、画像に触れずに完了を返す',
    async (type) => {
      const { quarantine, calls } = createFakeQuarantine([]);

      expect(
        await new OwnedImageQuarantineHandler(quarantine).handle(eventOf(type)),
      ).toStrictEqual({ kind: 'done' });
      expect(calls).toStrictEqual([]);
    },
  );

  test.each([
    ['suspended', 'addReasonForOwner'],
    ['unsuspended', 'removeReasonForOwner'],
  ] as const)(
    '%sでの隔離の失敗(%s)は捕まえずに投げ、メッセージの再試行に任せる',
    async (type, operation) => {
      const failure = new Error('移動の依頼の障害');
      const quarantine = {
        [operation]: () => Promise.reject(failure),
      } as unknown as MediaQuarantine;

      expect(
        await new OwnedImageQuarantineHandler(quarantine)
          .handle(eventOf(type))
          .catch((thrown: unknown) => thrown),
      ).toBe(failure);
    },
  );
});
