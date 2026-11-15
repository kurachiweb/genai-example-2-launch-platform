import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { eventIdOf } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  db,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { AccountMatchClosureSyncHandler } from './account-match-closure-sync-handler.ts';
import {
  expectedScenario,
  LIVE_VOTER_UPVOTE,
  ownerAClosure,
  PREVIOUS_DAY_VOTER_UPVOTE,
  readScenario,
  seedClosureScenario,
  voterLiveUpvoteRemoved,
} from './testing/closure-fixtures.ts';
import {
  DURING_MATCH,
  OWNER_A,
  VOTER,
} from './testing/upvote-store-fixtures.ts';

async function statementsFor(
  type: UserLifecycleEventType,
  userIndex: number,
): Promise<readonly BatchItem<'sqlite'>[]> {
  const event: UserLifecycleEvent = {
    id: eventIdOf(1),
    userId: userIdOf(userIndex),
    type,
    occurredAt: DURING_MATCH,
  };
  return new AccountMatchClosureSyncHandler().statementsFor(event, db);
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

beforeEach(seedClosureScenario);

describe('AccountMatchClosureSyncHandler', () => {
  describe('statementsFor', () => {
    test('停止では5文を返し、実行するとマッチ中のマッチへのUpvoteだけを停止の日時で論理削除し、その側の集計値を求め直す', async () => {
      const statements = await statementsFor('suspended', VOTER);

      expect(statements).toHaveLength(5);
      await expect(readScenario()).resolves.toEqual(expectedScenario({}));

      await commitAll(statements);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          entries: voterLiveUpvoteRemoved(DURING_MATCH),
          upvotes: { [LIVE_VOTER_UPVOTE]: DURING_MATCH },
        }),
      );
    });

    test('退会では5文を返し、実行すると確定したマッチを含む全てのUpvoteを退会の日時で論理削除し、マッチ中のマッチの側だけを求め直す', async () => {
      const statements = await statementsFor('withdrawn', VOTER);

      expect(statements).toHaveLength(5);

      await commitAll(statements);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          entries: voterLiveUpvoteRemoved(DURING_MATCH),
          upvotes: {
            [LIVE_VOTER_UPVOTE]: DURING_MATCH,
            [PREVIOUS_DAY_VOTER_UPVOTE]: DURING_MATCH,
          },
        }),
      );
    });

    test.each(['suspended', 'withdrawn'] as const)(
      '%sでは、投稿者のマッチ中のマッチを即時に終了し、開始前のマッチの側に該当を記録する',
      async (type) => {
        await commitAll(await statementsFor(type, OWNER_A));

        await expect(readScenario()).resolves.toEqual(
          expectedScenario(ownerAClosure(DURING_MATCH)),
        );
      },
    );

    test.each(['unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        await expect(statementsFor(type, OWNER_A)).resolves.toEqual([]);
        await expect(statementsFor(type, VOTER)).resolves.toEqual([]);
      },
    );
  });
});
