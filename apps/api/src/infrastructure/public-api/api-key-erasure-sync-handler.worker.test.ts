import { asc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { apiKeys } from '../../../db/schema/public-api/api-keys.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  after,
  db,
  eventIdOf,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  apiKeyIdOf,
  clearApiKeyTables,
  insertApiKey,
} from '../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import { ApiKeyErasureSyncHandler } from './api-key-erasure-sync-handler.ts';

const WITHDRAWING = 1;

const OTHER = 2;

const AT = after(60_000);

const WITHDRAWING_KEYS = [1, 2, 3];

const OTHER_KEYS = [4];

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(WITHDRAWING),
    type,
    occurredAt: AT,
  };
}

async function readKeyIds(): Promise<string[]> {
  const rows = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .orderBy(asc(apiKeys.id));
  return rows.map(({ id }) => id);
}

function keyIdsOf(indexes: readonly number[]): string[] {
  return indexes.map(apiKeyIdOf);
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
  await clearApiKeyTables();
  await insertUser(WITHDRAWING);
  await insertUser(OTHER);
  for (const index of WITHDRAWING_KEYS) {
    await insertApiKey(index, WITHDRAWING);
  }
  for (const index of OTHER_KEYS) {
    await insertApiKey(index, OTHER);
  }
});

describe('ApiKeyErasureSyncHandler', () => {
  describe('statementsFor', () => {
    test('退会では利用者の全てのキーを消す1文だけを返し、返すまでは何も書き込まない', async () => {
      const statements = await new ApiKeyErasureSyncHandler().statementsFor(
        eventOf('withdrawn'),
        db,
      );

      expect(statements).toHaveLength(1);
      await expect(readKeyIds()).resolves.toEqual(
        keyIdsOf([...WITHDRAWING_KEYS, ...OTHER_KEYS]),
      );
    });

    test('文を実行すると、退会した利用者のキーを全て消し、他の利用者のキーは残す', async () => {
      await commitAll(
        await new ApiKeyErasureSyncHandler().statementsFor(
          eventOf('withdrawn'),
          db,
        ),
      );

      await expect(readKeyIds()).resolves.toEqual(keyIdsOf(OTHER_KEYS));
    });

    test('キーを持たない利用者の退会でも文を実行でき、他の利用者のキーは残す', async () => {
      await db.delete(apiKeys).where(eq(apiKeys.userId, userIdOf(WITHDRAWING)));

      await commitAll(
        await new ApiKeyErasureSyncHandler().statementsFor(
          eventOf('withdrawn'),
          db,
        ),
      );

      await expect(readKeyIds()).resolves.toEqual(keyIdsOf(OTHER_KEYS));
    });

    test.each(['suspended', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        const statements = await new ApiKeyErasureSyncHandler().statementsFor(
          eventOf(type),
          db,
        );

        expect(statements).toEqual([]);
        await expect(readKeyIds()).resolves.toEqual(
          keyIdsOf([...WITHDRAWING_KEYS, ...OTHER_KEYS]),
        );
      },
    );
  });
});
