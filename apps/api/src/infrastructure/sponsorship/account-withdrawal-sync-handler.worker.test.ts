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
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { AccountWithdrawalSyncHandler } from './account-withdrawal-sync-handler.ts';
import {
  AT,
  commitStatements,
  compiledOf,
  LATER,
  OWNER,
  readClosureState,
  seedClosureScenario,
  untouchedState,
  withdrawnState,
} from './testing/closure-fixtures.ts';

function eventOf(
  type: UserLifecycleEventType,
  occurredAt: Date = AT,
): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(OWNER),
    type,
    occurredAt,
  };
}

function statementsOf(
  event: UserLifecycleEvent,
): Promise<readonly BatchItem<'sqlite'>[]> {
  return new AccountWithdrawalSyncHandler().statementsFor(event, db);
}

beforeEach(seedClosureScenario);

describe('AccountWithdrawalSyncHandler', () => {
  describe('statementsFor', () => {
    test('退会では、退会した利用者の論理削除の済んでいない申込を論理削除し未精算の表示停止の返金を返金不要にする集合の更新の1文を返し、返すまでは書き込まない', async () => {
      const statements = await statementsOf(eventOf('withdrawn'));

      expect(statements.map(compiledOf)).toEqual([
        {
          sql: `update "sponsorships" set "stop_refund_status" = case when "sponsorships"."stop_refund_status" = 'none' then 'not_needed' else "sponsorships"."stop_refund_status" end, "updated_at" = ?, "deleted_at" = ? where (("sponsorships"."user_id" = ?) and (("sponsorships"."deleted_at" is null)))`,
          params: [AT.getTime(), AT.getTime(), userIdOf(OWNER)],
        },
      ]);
      await expect(readClosureState()).resolves.toEqual(untouchedState());
    });

    test('文を実行すると、退会した利用者の全ての申込だけを退会の日時で論理削除し、未精算の表示停止の返金だけを返金不要にする', async () => {
      const changes = await commitStatements(
        await statementsOf(eventOf('withdrawn')),
      );

      expect(changes).toEqual([6]);
      await expect(readClosureState()).resolves.toEqual(withdrawnState(AT));
    });

    test('同じ利用者の退会の文をもう一度実行しても、最初の退会の日時を上書きしない', async () => {
      await commitStatements(await statementsOf(eventOf('withdrawn')));

      const changes = await commitStatements(
        await statementsOf(eventOf('withdrawn', LATER)),
      );

      expect(changes).toEqual([0]);
      await expect(readClosureState()).resolves.toEqual(withdrawnState(AT));
    });

    test.each(['suspended', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        await expect(statementsOf(eventOf(type))).resolves.toEqual([]);
        await expect(readClosureState()).resolves.toEqual(untouchedState());
      },
    );
  });
});
