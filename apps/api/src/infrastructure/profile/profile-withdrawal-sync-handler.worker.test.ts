import { asc } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { userPreviousHandles } from '../../../db/schema/profile/user-previous-handles.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  insertPreviousHandle,
  readPreviousHandles,
} from '../../../lib/workers/handles/testing/handle-fixtures.ts';
import {
  after,
  clearIdentityTables,
  db,
  eventIdOf,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { ProfileWithdrawalSyncHandler } from './profile-withdrawal-sync-handler.ts';

const TARGET = 1;
const OTHER = 2;
const THIRD = 3;

const AT = after(60_000);

const EARLIER_DELETED_AT = after(1_000);

function followIdOf(index: number): string {
  return `01JC0FLW${String(index).padStart(18, '0')}`;
}

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(TARGET),
    type,
    occurredAt: AT,
  };
}

async function insertFollow(
  index: number,
  followerIndex: number,
  followeeIndex: number,
  deletedAt: Date | null = null,
): Promise<void> {
  await db.insert(userFollows).values({
    id: followIdOf(index),
    followerId: userIdOf(followerIndex),
    followeeId: userIdOf(followeeIndex),
    createdAt: T0,
    updatedAt: T0,
    deletedAt,
  });
}

async function readFollowDeletion() {
  const rows = await db
    .select({
      id: userFollows.id,
      deletedAt: userFollows.deletedAt,
      updatedAt: userFollows.updatedAt,
    })
    .from(userFollows)
    .orderBy(asc(userFollows.id));
  return rows;
}

async function readPreviousDeletion() {
  const rows = await readPreviousHandles();
  return rows.map(({ ownerId, handle, deletedAt, updatedAt }) => ({
    ownerId,
    handle,
    deletedAt,
    updatedAt,
  }));
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
  await db.delete(userFollows);
  await db.delete(userPreviousHandles);
  await clearIdentityTables();
  await insertUser(TARGET, { handle: 'target' });
  await insertUser(OTHER, { handle: 'other' });
  await insertUser(THIRD, { handle: 'third' });
  await insertPreviousHandle(1, TARGET, 'target-old');
  await insertPreviousHandle(2, OTHER, 'other-old');
  await insertFollow(1, TARGET, OTHER);
  await insertFollow(2, OTHER, TARGET);
  await insertFollow(3, OTHER, THIRD);
  await insertFollow(4, THIRD, TARGET, EARLIER_DELETED_AT);
});

const UNTOUCHED_PREVIOUS = [
  {
    ownerId: userIdOf(TARGET),
    handle: 'target-old',
    deletedAt: null,
    updatedAt: T0,
  },
  {
    ownerId: userIdOf(OTHER),
    handle: 'other-old',
    deletedAt: null,
    updatedAt: T0,
  },
];

const UNTOUCHED_FOLLOWS = [
  { id: followIdOf(1), deletedAt: null, updatedAt: T0 },
  { id: followIdOf(2), deletedAt: null, updatedAt: T0 },
  { id: followIdOf(3), deletedAt: null, updatedAt: T0 },
  { id: followIdOf(4), deletedAt: EARLIER_DELETED_AT, updatedAt: T0 },
];

describe('ProfileWithdrawalSyncHandler', () => {
  describe('statementsFor', () => {
    test('退会では旧ハンドルとフォローの2文を返し、実行すると退会した利用者の分だけを退会の日時で論理削除する', async () => {
      const statements = await new ProfileWithdrawalSyncHandler().statementsFor(
        eventOf('withdrawn'),
        db,
      );

      expect(statements).toHaveLength(2);
      await expect(readPreviousDeletion()).resolves.toEqual(UNTOUCHED_PREVIOUS);
      await expect(readFollowDeletion()).resolves.toEqual(UNTOUCHED_FOLLOWS);

      await commitAll(statements);

      await expect(readPreviousDeletion()).resolves.toEqual([
        {
          ownerId: userIdOf(TARGET),
          handle: 'target-old',
          deletedAt: AT,
          updatedAt: AT,
        },
        {
          ownerId: userIdOf(OTHER),
          handle: 'other-old',
          deletedAt: null,
          updatedAt: T0,
        },
      ]);
      await expect(readFollowDeletion()).resolves.toEqual([
        { id: followIdOf(1), deletedAt: AT, updatedAt: AT },
        { id: followIdOf(2), deletedAt: AT, updatedAt: AT },
        { id: followIdOf(3), deletedAt: null, updatedAt: T0 },
        { id: followIdOf(4), deletedAt: EARLIER_DELETED_AT, updatedAt: T0 },
      ]);
    });

    test('論理削除済みの旧ハンドルの削除の日時は上書きしない', async () => {
      await db.delete(userPreviousHandles);
      await insertPreviousHandle(1, TARGET, 'target-old', {
        deletedAt: EARLIER_DELETED_AT,
      });
      const statements = await new ProfileWithdrawalSyncHandler().statementsFor(
        eventOf('withdrawn'),
        db,
      );

      await commitAll(statements);

      await expect(readPreviousDeletion()).resolves.toEqual([
        {
          ownerId: userIdOf(TARGET),
          handle: 'target-old',
          deletedAt: EARLIER_DELETED_AT,
          updatedAt: T0,
        },
      ]);
    });

    test.each(['suspended', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        const statements =
          await new ProfileWithdrawalSyncHandler().statementsFor(
            eventOf(type),
            db,
          );

        expect(statements).toEqual([]);
        await expect(readPreviousDeletion()).resolves.toEqual(
          UNTOUCHED_PREVIOUS,
        );
        await expect(readFollowDeletion()).resolves.toEqual(UNTOUCHED_FOLLOWS);
      },
    );
  });
});
