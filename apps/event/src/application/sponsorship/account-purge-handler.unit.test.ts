import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { AccountPurgeHandler } from './account-purge-handler.ts';
import type { SponsorshipPurgeStore } from './ports.ts';

const USER_ID = '01JD0USER00000000000000001';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JD0UEVT00000000000000001',
  userId: USER_ID,
  type: 'purge_due',
  occurredAt: new Date('2027-04-10T09:00:00.000Z'),
});

interface Harness {
  readonly handler: AccountPurgeHandler;
  readonly purgedUsers: string[];
  readonly remaining: Set<string>;
}

// 偽のポートは申込の行を利用者のIDの集合で表し、消した後の呼び出しでは何も消さない
function createHarness(failure?: Error): Harness {
  const purgedUsers: string[] = [];
  const remaining = new Set([USER_ID, '01JD0USER00000000000000002']);
  const store: SponsorshipPurgeStore = {
    purgeByUser: (userId) => {
      purgedUsers.push(userId);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      remaining.delete(userId);
      return Promise.resolve();
    },
    purgeByProduct: () => {
      throw new Error('利用者の物理削除の処理はプロダクトの削除を使わない');
    },
  };
  return { handler: new AccountPurgeHandler(store), purgedUsers, remaining };
}

describe('AccountPurgeHandler', () => {
  test('物理削除の時期に、その利用者の申込と表示停止の区間の削除を依頼して完了を返す', async () => {
    const { handler, purgedUsers, remaining } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(purgedUsers).toEqual([USER_ID]);
    expect([...remaining]).toEqual(['01JD0USER00000000000000002']);
  });

  test('同じイベントを2回処理しても、2回目も同じ利用者の削除を依頼して完了を返し、結果が変わらない', async () => {
    const { handler, purgedUsers, remaining } = createHarness();

    const first = await handler.handle(EVENT);
    const afterFirst = [...remaining];
    const second = await handler.handle(EVENT);

    expect(first).toEqual({ kind: 'done' });
    expect(second).toEqual({ kind: 'done' });
    expect(purgedUsers).toEqual([USER_ID, USER_ID]);
    expect([...remaining]).toEqual(afterFirst);
  });

  test('削除の失敗はそのまま投げ、イベントの再試行に任せる', async () => {
    const error = new Error('D1が一時的に応答しない');
    const { handler } = createHarness(error);

    const caught = await handler
      .handle(EVENT)
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
  });
});
