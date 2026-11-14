import { describe, expect, test } from 'bun:test';

import type {
  EmailCleanupSummary,
  SuppressionMaintenance,
} from '../../../lib/core/email/ports.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { EmailSuppressionCleanupHandler } from './email-suppression-cleanup-handler.ts';
import type { UserEmailLookup } from './ports.ts';

const USER_ID = '01JC0USER00000000000000001';

const EVENT: UserLifecycleEvent = {
  id: '01JC0EVT000000000000000010',
  userId: USER_ID,
  type: 'withdrawn',
  occurredAt: new Date('2026-11-02T07:00:00.000Z'),
};

function createMaintenance(failure?: Error): {
  readonly maintenance: SuppressionMaintenance;
  readonly deleted: string[];
} {
  const deleted: string[] = [];
  const maintenance: SuppressionMaintenance = {
    deleteByAddress: (address) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      deleted.push(address);
      return Promise.resolve();
    },
    runDailyCleanup: (): Promise<EmailCleanupSummary> =>
      Promise.reject(new Error('退会の波及処理では日次の後始末を呼ばない')),
  };
  return { maintenance, deleted };
}

function lookupOf(emails: Readonly<Record<string, string>>): UserEmailLookup {
  return { findEmail: (userId) => Promise.resolve(emails[userId]) };
}

describe('EmailSuppressionCleanupHandler', () => {
  test('退会した利用者のメールアドレスの抑止記録を削除して完了する', async () => {
    const { maintenance, deleted } = createMaintenance();
    const handler = new EmailSuppressionCleanupHandler(
      lookupOf({ [USER_ID]: 'Withdrawn@mail.example' }),
      maintenance,
    );

    expect(await handler.handle(EVENT)).toEqual({ kind: 'done' });

    expect(deleted).toEqual(['Withdrawn@mail.example']);
  });

  test('利用者の行が既に無ければ、抑止記録を削除せずに完了する', async () => {
    const { maintenance, deleted } = createMaintenance();
    const handler = new EmailSuppressionCleanupHandler(
      lookupOf({}),
      maintenance,
    );

    expect(await handler.handle(EVENT)).toEqual({ kind: 'done' });

    expect(deleted).toEqual([]);
  });

  test('抑止記録の削除の失敗はそのまま投げ、再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const { maintenance } = createMaintenance(failure);
    const handler = new EmailSuppressionCleanupHandler(
      lookupOf({ [USER_ID]: 'withdrawn@mail.example' }),
      maintenance,
    );

    const thrown = await handler
      .handle(EVENT)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(thrown).toBe(failure);
  });
});
