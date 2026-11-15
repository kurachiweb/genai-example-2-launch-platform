import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  NotificationNoticeStore,
  NotificationPreferenceStore,
  UnsubscribeTokenService,
} from '../../../lib/core/notifications/ports.ts';
import {
  ACCOUNT_PURGE_BATCH_SIZE,
  AccountPurgeHandler,
} from './account-purge-handler.ts';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JD0EVT000000000000000131',
  userId: '01JC0RCPT00000000000000001',
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

type Operation = 'deleteByRecipient' | 'deleteTokensOf' | 'deletePreferencesOf';

interface PortCall {
  readonly operation: Operation;
  readonly userId: string;
  readonly limit?: number;
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

interface FakePorts {
  readonly notices: NotificationNoticeStore;
  readonly preferences: NotificationPreferenceStore;
  readonly tokens: UnsubscribeTokenService;
  readonly calls: readonly PortCall[];
}

// 物理削除に使う3つの操作だけを記録し、送信と設定の照会の操作は呼ばれたら失敗させる
function createFakePorts(
  deletedCounts: readonly number[],
  failures: Partial<Record<Operation, Error>> = {},
): FakePorts {
  const calls: PortCall[] = [];
  const pending = [...deletedCounts];
  const settle = (operation: Operation): Promise<void> => {
    const failure = failures[operation];
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  };
  return {
    notices: {
      record: unexpected,
      nextPendingGroups: unexpected,
      settle: unexpected,
      deleteByRecipient: (userId, limit) => {
        calls.push({ operation: 'deleteByRecipient', userId, limit });
        const failure = failures.deleteByRecipient;
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        const next = pending.shift();
        return next === undefined ? unexpected() : Promise.resolve(next);
      },
    },
    preferences: {
      preferencesOf: unexpected,
      setPreference: unexpected,
      eligibleRecipients: unexpected,
      enabledTopicsOf: unexpected,
      deleteAllOf: (userId) => {
        calls.push({ operation: 'deletePreferencesOf', userId });
        return settle('deletePreferencesOf');
      },
    },
    tokens: {
      tokensFor: unexpected,
      resolve: unexpected,
      deleteAllOf: (userId) => {
        calls.push({ operation: 'deleteTokensOf', userId });
        return settle('deleteTokensOf');
      },
    },
    calls,
  };
}

function handlerOf(ports: FakePorts): AccountPurgeHandler {
  return new AccountPurgeHandler(
    ports.notices,
    ports.preferences,
    ports.tokens,
  );
}

const NOTICE_DELETION: PortCall = {
  operation: 'deleteByRecipient',
  userId: EVENT.userId,
  limit: ACCOUNT_PURGE_BATCH_SIZE,
};

describe('AccountPurgeHandler', () => {
  test('1回に消す通知の上限は1,000件である', () => {
    expect(ACCOUNT_PURGE_BATCH_SIZE).toBe(1000);
  });

  test('通知の削除が上限の件数ちょうどなら、受信設定とトークンの種を消さずに続きを返す', async () => {
    const ports = createFakePorts([ACCOUNT_PURGE_BATCH_SIZE]);

    expect(await handlerOf(ports).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(ports.calls).toStrictEqual([NOTICE_DELETION]);
  });

  test.each([0, 1, ACCOUNT_PURGE_BATCH_SIZE - 1])(
    '通知の削除が上限の件数未満(%i件)なら、トークンの種と受信設定の残りを消して完了を返す',
    async (deleted) => {
      const ports = createFakePorts([deleted]);

      expect(await handlerOf(ports).handle(EVENT)).toStrictEqual({
        kind: 'done',
      });
      expect(ports.calls).toStrictEqual([
        NOTICE_DELETION,
        { operation: 'deleteTokensOf', userId: EVENT.userId },
        { operation: 'deletePreferencesOf', userId: EVENT.userId },
      ]);
    },
  );

  test('続きの呼び出しで通知が尽きた回に、トークンの種と受信設定を1回だけ消す', async () => {
    const ports = createFakePorts([ACCOUNT_PURGE_BATCH_SIZE, 0]);
    const handler = handlerOf(ports);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'continue' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(ports.calls.map(({ operation }) => operation)).toStrictEqual([
      'deleteByRecipient',
      'deleteByRecipient',
      'deleteTokensOf',
      'deletePreferencesOf',
    ]);
  });

  test.each<Operation>([
    'deleteByRecipient',
    'deleteTokensOf',
    'deletePreferencesOf',
  ])(
    '%sの失敗は捕まえずに投げ、メッセージの再試行に任せる',
    async (operation) => {
      const failure = new Error('D1の障害');
      const ports = createFakePorts([0], { [operation]: failure });

      expect(
        await handlerOf(ports)
          .handle(EVENT)
          .catch((thrown: unknown) => thrown),
      ).toBe(failure);
    },
  );
});
