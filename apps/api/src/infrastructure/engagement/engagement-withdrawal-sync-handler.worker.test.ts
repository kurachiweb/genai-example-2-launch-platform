import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  after,
  changesOf,
  db,
  userIdOf,
} from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { eventIdOf } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { EngagementWithdrawalSyncHandler } from './engagement-withdrawal-sync-handler.ts';
import {
  readWithdrawalState,
  seedWithdrawalScenario,
  untouchedState,
  withdrawnState,
  WITHDRAWING,
} from './testing/withdrawal-fixtures.ts';

const AT = after(60_000);

const LATER = after(120_000);

interface CompiledStatement {
  toSQL(): { readonly sql: string; readonly params: readonly unknown[] };
}

function isCompiledStatement(value: unknown): value is CompiledStatement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toSQL' in value &&
    typeof value.toSQL === 'function'
  );
}

function compiled(statement: BatchItem<'sqlite'>) {
  if (!isCompiledStatement(statement)) {
    throw new TypeError('文をSQLに変換できません');
  }
  return statement.toSQL();
}

function eventOf(
  type: UserLifecycleEventType,
  occurredAt: Date = AT,
): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(WITHDRAWING),
    type,
    occurredAt,
  };
}

function statementsOf(
  event: UserLifecycleEvent,
): Promise<readonly BatchItem<'sqlite'>[]> {
  return new EngagementWithdrawalSyncHandler().statementsFor(event, db);
}

async function commitAll(
  statements: readonly BatchItem<'sqlite'>[],
): Promise<number[]> {
  const [first, ...rest] = statements;
  if (first === undefined) {
    throw new Error('文が返されませんでした');
  }
  const results = await db.batch([first, ...rest]);
  return results.map(changesOf);
}

beforeEach(seedWithdrawalScenario);

describe('EngagementWithdrawalSyncHandler', () => {
  describe('statementsFor', () => {
    test('退会では、コメントと評価の退会した利用者で絞った論理削除の済んでいない集合の更新の2文を返し、返すまでは書き込まない', async () => {
      const statements = await statementsOf(eventOf('withdrawn'));

      expect(statements.map(compiled)).toEqual([
        {
          sql: 'update "launch_comments" set "updated_at" = ?, "deleted_at" = ? where (("launch_comments"."author_user_id" = ?) and (("launch_comments"."deleted_at" is null)))',
          params: [AT.getTime(), AT.getTime(), userIdOf(WITHDRAWING)],
        },
        {
          sql: 'update "product_ratings" set "updated_at" = ?, "deleted_at" = ? where (("product_ratings"."user_id" = ?) and (("product_ratings"."deleted_at" is null)))',
          params: [AT.getTime(), AT.getTime(), userIdOf(WITHDRAWING)],
        },
      ]);
      await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
    });

    test('文を実行すると、退会した利用者のコメントと評価だけを退会の日時で論理削除し、論理削除済みのコメントの削除の日時と他の利用者の行は変えない', async () => {
      const changes = await commitAll(await statementsOf(eventOf('withdrawn')));

      expect(changes).toEqual([2, 2]);
      await expect(readWithdrawalState()).resolves.toEqual(withdrawnState(AT));
    });

    test('同じ利用者の退会の文をもう一度実行しても、最初の退会の日時を上書きしない', async () => {
      await commitAll(await statementsOf(eventOf('withdrawn')));

      const changes = await commitAll(
        await statementsOf(eventOf('withdrawn', LATER)),
      );

      expect(changes).toEqual([0, 0]);
      await expect(readWithdrawalState()).resolves.toEqual(withdrawnState(AT));
    });

    test.each(['suspended', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        await expect(statementsOf(eventOf(type))).resolves.toEqual([]);
        await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
      },
    );
  });
});
