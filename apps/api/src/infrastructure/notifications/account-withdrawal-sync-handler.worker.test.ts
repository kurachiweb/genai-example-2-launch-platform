import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { createKeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { D1UnsubscribeTokenService } from '../../../lib/workers/notifications/d1-unsubscribe-token-service.ts';
import {
  after,
  createSequentialIds,
  db,
  eventIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { recipientIdOf } from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { AccountWithdrawalSyncHandler } from './account-withdrawal-sync-handler.ts';
import {
  OTHER,
  readWithdrawalState,
  seedWithdrawalScenario,
  tokenOf,
  untouchedState,
  type WithdrawalScenario,
  withdrawnState,
  WITHDRAWING,
} from './testing/withdrawal-fixtures.ts';

const AT = after(60_000);

const tokens = new D1UnsubscribeTokenService(
  db,
  createKeyedHasher('0123456789abcdef0123456789abcdef'),
  createSequentialIds(),
);

let scenario: WithdrawalScenario;

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: recipientIdOf(WITHDRAWING),
    type,
    occurredAt: AT,
  };
}

async function commitAll(
  statements: readonly BatchItem<'sqlite'>[],
): Promise<void> {
  const [first, ...rest] = statements;
  if (first === undefined) {
    throw new Error('文が返されませんでした');
  }
  await db.batch([first, ...rest]);
}

beforeEach(async () => {
  scenario = await seedWithdrawalScenario(tokens);
});

describe('AccountWithdrawalSyncHandler', () => {
  describe('statementsFor', () => {
    test('退会ではトークンの種・受信設定・未送信の通知の3文を返し、返すまでは何も書き込まない', async () => {
      const statements = await new AccountWithdrawalSyncHandler().statementsFor(
        eventOf('withdrawn'),
        db,
      );

      expect(statements).toHaveLength(3);
      await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
    });

    test('文を実行すると、退会した利用者のトークンの種と受信設定を消し、未送信の通知だけを退会の理由で退会の日時に送らない扱いにする', async () => {
      await commitAll(
        await new AccountWithdrawalSyncHandler().statementsFor(
          eventOf('withdrawn'),
          db,
        ),
      );

      await expect(readWithdrawalState()).resolves.toEqual(withdrawnState(AT));
    });

    test('文を実行すると、退会した利用者のトークンは照合できなくなり、他の利用者のトークンは照合できる', async () => {
      await commitAll(
        await new AccountWithdrawalSyncHandler().statementsFor(
          eventOf('withdrawn'),
          db,
        ),
      );

      await expect(
        tokens.resolve(tokenOf(scenario, WITHDRAWING, 'match_result')),
      ).resolves.toBeUndefined();
      await expect(
        tokens.resolve(tokenOf(scenario, OTHER, 'match_result')),
      ).resolves.toEqual({
        userId: recipientIdOf(OTHER),
        topic: 'match_result',
      });
    });

    test.each(['suspended', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        const statements =
          await new AccountWithdrawalSyncHandler().statementsFor(
            eventOf(type),
            db,
          );

        expect(statements).toEqual([]);
        await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
      },
    );
  });
});
