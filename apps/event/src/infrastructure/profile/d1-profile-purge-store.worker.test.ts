import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import {
  db,
  insertUser,
  insertUsers,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { ProfilePurgeStore } from '../../application/profile/ports.ts';
import {
  FOLLOW_ERASURE_BATCH_SIZE,
  ProfileErasureHandler,
} from '../../application/profile/profile-erasure-handler.ts';
import { D1ProfilePurgeStore } from './d1-profile-purge-store.ts';
import {
  followIdOf,
  insertFollows,
  insertProfileRows,
  readFollowIdsOf,
  readProfileRowCounts,
  resetProfilePurgeRows,
} from './testing/profile-purge-fixtures.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const PURGED = 1;

const OTHER = 2;

const THIRD = 3;

function createStore(): ProfilePurgeStore {
  return new D1ProfilePurgeStore(db);
}

function range(start: number, count: number): readonly number[] {
  return Array.from({ length: count }, (_, offset) => start + offset);
}

async function userRowExists(index: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userIdOf(index)));
  return rows.length > 0;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetProfilePurgeRows();
});

describe('D1ProfilePurgeStore.deleteFollowsBatch', () => {
  test('本人がフォロワーの行と相手の行の両方を、論理削除済みの行も含めて消し、消した件数を返す', async () => {
    await insertUsers([PURGED, OTHER, THIRD]);
    await insertFollows([
      { index: 1, followerIndex: PURGED, followeeIndex: OTHER },
      { index: 2, followerIndex: OTHER, followeeIndex: PURGED },
      {
        index: 3,
        followerIndex: PURGED,
        followeeIndex: THIRD,
        deletedAt: new Date('2026-11-02T00:00:00.000Z'),
      },
      { index: 4, followerIndex: OTHER, followeeIndex: THIRD },
    ]);

    await expect(
      createStore().deleteFollowsBatch(userIdOf(PURGED), 10),
    ).resolves.toBe(3);

    await expect(readFollowIdsOf(PURGED)).resolves.toStrictEqual([]);
    await expect(readFollowIdsOf(OTHER)).resolves.toStrictEqual([
      followIdOf(4),
    ]);
  });

  test('上限の件数を超える行は残し、上限の件数を返す', async () => {
    await insertUsers([PURGED, OTHER, THIRD]);
    await insertFollows([
      { index: 1, followerIndex: PURGED, followeeIndex: OTHER },
      { index: 2, followerIndex: OTHER, followeeIndex: PURGED },
      { index: 3, followerIndex: PURGED, followeeIndex: THIRD },
    ]);

    await expect(
      createStore().deleteFollowsBatch(userIdOf(PURGED), 2),
    ).resolves.toBe(2);
    await expect(readFollowIdsOf(PURGED)).resolves.toHaveLength(1);
  });

  test('行が無ければ0件を返し、繰り返しても結果が変わらない', async () => {
    await insertUsers([PURGED]);
    const store = createStore();

    await expect(store.deleteFollowsBatch(userIdOf(PURGED), 10)).resolves.toBe(
      0,
    );
    await expect(store.deleteFollowsBatch(userIdOf(PURGED), 10)).resolves.toBe(
      0,
    );
  });
});

describe('D1ProfilePurgeStore.deleteProfileRows', () => {
  test('外部Webサイト・旧ハンドル・プロフィールを消し、他の利用者の行は残す', async () => {
    await insertUsers([PURGED, OTHER]);
    await insertProfileRows(PURGED);
    await insertProfileRows(OTHER);

    await createStore().deleteProfileRows(userIdOf(PURGED));

    await expect(readProfileRowCounts(PURGED)).resolves.toStrictEqual({
      profiles: 0,
      websites: 0,
      previousHandles: 0,
    });
    await expect(readProfileRowCounts(OTHER)).resolves.toStrictEqual({
      profiles: 1,
      websites: 1,
      previousHandles: 1,
    });
  });

  test('行が無い利用者でも失敗せず、繰り返しても結果が変わらない', async () => {
    await insertUsers([PURGED]);
    const store = createStore();

    await store.deleteProfileRows(userIdOf(PURGED));
    await store.deleteProfileRows(userIdOf(PURGED));

    await expect(readProfileRowCounts(PURGED)).resolves.toStrictEqual({
      profiles: 0,
      websites: 0,
      previousHandles: 0,
    });
  });
});

describe('ProfileErasureHandler と D1ProfilePurgeStore', () => {
  const EVENT = {
    id: '01JC0EVT000000000000000071',
    userId: userIdOf(PURGED),
    type: 'purge_due',
    occurredAt: new Date('2026-11-20T00:00:00.000Z'),
  } as const;

  const FOLLOWEES = 600;

  const FOLLOWERS = 401;

  // 本人がフォロワーの600件と相手の401件の合計1,001件を、フォロワー側の行は論理削除済みも混ぜて入れる
  async function arrangeOverBatchFollows(): Promise<void> {
    const followeeIndexes = range(OTHER, FOLLOWEES);
    const followerIndexes = range(OTHER + FOLLOWEES, FOLLOWERS);
    await insertUser(PURGED);
    await insertUsers([...followeeIndexes, ...followerIndexes]);
    await insertFollows([
      ...followeeIndexes.map((index) => ({
        index,
        followerIndex: PURGED,
        followeeIndex: index,
      })),
      ...followerIndexes.map((index) => ({
        index,
        followerIndex: index,
        followeeIndex: PURGED,
        ...(index % 2 === 0
          ? { deletedAt: new Date('2026-11-02T00:00:00.000Z') }
          : {}),
      })),
    ]);
    await insertProfileRows(PURGED);
  }

  test('1,001件のフォローは2回の呼び出しで消え、プロフィールの行は2回目で消える', async () => {
    await arrangeOverBatchFollows();
    const handler = new ProfileErasureHandler(createStore());

    await expect(handler.handle(EVENT)).resolves.toStrictEqual({
      kind: 'continue',
    });
    await expect(readFollowIdsOf(PURGED)).resolves.toHaveLength(1);
    await expect(readProfileRowCounts(PURGED)).resolves.toStrictEqual({
      profiles: 1,
      websites: 1,
      previousHandles: 1,
    });

    await expect(handler.handle(EVENT)).resolves.toStrictEqual({
      kind: 'done',
    });
    await expect(readFollowIdsOf(PURGED)).resolves.toStrictEqual([]);
    await expect(readProfileRowCounts(PURGED)).resolves.toStrictEqual({
      profiles: 0,
      websites: 0,
      previousHandles: 0,
    });
    expect(FOLLOW_ERASURE_BATCH_SIZE).toBe(1000);
  });

  test('完了の後に呼び直しても完了を返し、結果が変わらない', async () => {
    await arrangeOverBatchFollows();
    const handler = new ProfileErasureHandler(createStore());
    await handler.handle(EVENT);
    await handler.handle(EVENT);

    await expect(handler.handle(EVENT)).resolves.toStrictEqual({
      kind: 'done',
    });
  });

  test('自分の行が残る間は利用者の行の物理削除が外部キーの違反で失敗し、波及処理の後に成功する', async () => {
    await arrangeOverBatchFollows();

    await expect(
      db.delete(users).where(eq(users.id, userIdOf(PURGED))),
    ).rejects.toThrow();
    await expect(userRowExists(PURGED)).resolves.toBe(true);

    const handler = new ProfileErasureHandler(createStore());
    await handler.handle(EVENT);
    await handler.handle(EVENT);

    await db.delete(users).where(eq(users.id, userIdOf(PURGED)));
    await expect(userRowExists(PURGED)).resolves.toBe(false);
  });

  test('利用者の行が無くても完了を返す', async () => {
    await expect(
      new ProfileErasureHandler(createStore()).handle(EVENT),
    ).resolves.toStrictEqual({ kind: 'done' });
  });
});
