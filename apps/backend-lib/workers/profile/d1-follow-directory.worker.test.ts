import { beforeEach, describe, expect, test } from 'vitest';

import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { AppError } from '../../core/errors/app-error.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1FollowDirectory } from './d1-follow-directory.ts';

function followIdOf(index: number): string {
  return `01JC0FLW${String(index).padStart(18, '0')}`;
}

async function insertFollow(
  index: number,
  followerIndex: number,
  followeeIndex: number,
  columns: Partial<typeof userFollows.$inferInsert> = {},
): Promise<void> {
  await db.insert(userFollows).values({
    id: followIdOf(index),
    followerId: userIdOf(followerIndex),
    followeeId: userIdOf(followeeIndex),
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

const directory = new D1FollowDirectory(db);

beforeEach(async () => {
  await db.delete(userFollows);
  await clearIdentityTables();
  await insertUser(1, { handle: 'Alice', nickname: 'アリス' });
  await insertUser(2, { handle: 'bob', nickname: 'ボブ' });
  await insertUser(3, {
    handle: 'carol',
    nickname: 'キャロル',
    status: 'suspended',
    suspendedAt: after(1),
  });
  await insertUser(4, {
    handle: 'dave',
    nickname: 'デイブ',
    deletedAt: after(2),
  });
});

describe('FollowExport.listFollowing', () => {
  test('フォローした日時の新しい順に、相手のハンドル・ニックネーム・日時を返す', async () => {
    await insertUsers([5, 6]);
    await insertFollow(1, 1, 2, { createdAt: after(100) });
    await insertFollow(2, 1, 5, { createdAt: after(300) });
    await insertFollow(3, 1, 6, { createdAt: after(200) });

    const entries = await directory.listFollowing(userIdOf(1));

    expect(entries).toEqual([
      { handle: 'user5', nickname: '利用者5', followedAt: after(300) },
      { handle: 'user6', nickname: '利用者6', followedAt: after(200) },
      { handle: 'bob', nickname: 'ボブ', followedAt: after(100) },
    ]);
  });

  test('フォローした日時が同じならフォローのIDの降順に返す', async () => {
    await insertUsers([5, 6]);
    await insertFollow(1, 1, 2, { createdAt: after(100) });
    await insertFollow(3, 1, 5, { createdAt: after(100) });
    await insertFollow(2, 1, 6, { createdAt: after(100) });

    const entries = await directory.listFollowing(userIdOf(1));

    expect(entries.map((entry) => entry.handle)).toEqual([
      'user5',
      'user6',
      'bob',
    ]);
  });

  test('停止中・退会済みの相手と論理削除済みのフォローは返さない', async () => {
    await insertUser(5, { handle: 'erin', nickname: 'エリン' });
    await insertFollow(1, 1, 2);
    await insertFollow(2, 1, 3);
    await insertFollow(3, 1, 4);
    await insertFollow(4, 1, 5, { deletedAt: after(3) });

    const entries = await directory.listFollowing(userIdOf(1));

    expect(entries.map((entry) => entry.handle)).toEqual(['bob']);
  });

  test('フォロワーと他の利用者のフォローは返さない', async () => {
    await insertFollow(1, 2, 1);
    await insertFollow(2, 2, 3);
    await insertFollow(3, 1, 2);

    const entries = await directory.listFollowing(userIdOf(1));

    expect(entries.map((entry) => entry.handle)).toEqual(['bob']);
  });

  test('フォローが無ければ空の一覧を返す', async () => {
    expect(await directory.listFollowing(userIdOf(1))).toEqual([]);
  });
});

describe('FollowerDirectory.listVisibleFollowerIds', () => {
  const FOLLOWER_COUNT = 7;

  async function insertFollowers(): Promise<void> {
    const indexes = Array.from(
      { length: FOLLOWER_COUNT },
      (_, offset) => offset + 10,
    );
    await insertUsers(indexes);
    for (const index of indexes) {
      await insertFollow(index, index, 1);
    }
  }

  test('フォローのIDの昇順に上限件数ずつ返し、続きがあれば最後のフォローのIDを示す', async () => {
    await insertFollowers();

    const first = await directory.listVisibleFollowerIds({
      after: undefined,
      followeeId: userIdOf(1),
      limit: 3,
    });
    const second = await directory.listVisibleFollowerIds({
      after: first.next,
      followeeId: userIdOf(1),
      limit: 3,
    });
    const third = await directory.listVisibleFollowerIds({
      after: second.next,
      followeeId: userIdOf(1),
      limit: 3,
    });

    expect(first).toEqual({
      followerIds: [userIdOf(10), userIdOf(11), userIdOf(12)],
      next: followIdOf(12),
    });
    expect(second).toEqual({
      followerIds: [userIdOf(13), userIdOf(14), userIdOf(15)],
      next: followIdOf(15),
    });
    expect(third).toEqual({ followerIds: [userIdOf(16)], next: undefined });
  });

  test('ちょうど上限件数で尽きるなら続きを示さない', async () => {
    await insertFollowers();

    const page = await directory.listVisibleFollowerIds({
      after: undefined,
      followeeId: userIdOf(1),
      limit: FOLLOWER_COUNT,
    });

    expect(page.followerIds).toHaveLength(FOLLOWER_COUNT);
    expect(page.next).toBeUndefined();
  });

  test('フォローのIDの順はフォロワーのIDの順と異なってもフォローのIDに従う', async () => {
    await insertUsers([10, 11]);
    await insertFollow(2, 10, 1);
    await insertFollow(1, 11, 1);

    const page = await directory.listVisibleFollowerIds({
      after: undefined,
      followeeId: userIdOf(1),
      limit: 10,
    });

    expect(page.followerIds).toEqual([userIdOf(11), userIdOf(10)]);
  });

  test('停止中・退会済みのフォロワーと論理削除済みのフォローは飛ばし、ページの件数を保つ', async () => {
    await insertUsers([10, 11]);
    await insertFollow(1, 3, 1);
    await insertFollow(2, 4, 1);
    await insertFollow(3, 10, 1, { deletedAt: after(3) });
    await insertFollow(4, 11, 1);
    await insertFollow(5, 2, 1);

    const page = await directory.listVisibleFollowerIds({
      after: undefined,
      followeeId: userIdOf(1),
      limit: 1,
    });
    const rest = await directory.listVisibleFollowerIds({
      after: page.next,
      followeeId: userIdOf(1),
      limit: 1,
    });

    expect(page).toEqual({ followerIds: [userIdOf(11)], next: followIdOf(4) });
    expect(rest).toEqual({ followerIds: [userIdOf(2)], next: undefined });
  });

  test('フォローしている相手や他の利用者のフォロワーは返さない', async () => {
    await insertFollow(1, 1, 2);
    await insertFollow(2, 2, 3);

    const page = await directory.listVisibleFollowerIds({
      after: undefined,
      followeeId: userIdOf(1),
      limit: 10,
    });

    expect(page).toEqual({ followerIds: [], next: undefined });
  });

  test.each([0, -1, 501, 1.5, Number.NaN])(
    '上限件数%sは1〜500の整数でないため拒否する',
    async (limit) => {
      const rejection = await directory
        .listVisibleFollowerIds({
          after: undefined,
          followeeId: userIdOf(1),
          limit,
        })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(AppError);
      expect(rejection).toMatchObject({
        kind: 'bad_request',
        code: 'invalid_limit',
      });
    },
  );

  test('上限件数の下限の1と上限の500は受け付ける', async () => {
    await insertFollowers();

    const one = await directory.listVisibleFollowerIds({
      after: undefined,
      followeeId: userIdOf(1),
      limit: 1,
    });
    const max = await directory.listVisibleFollowerIds({
      after: undefined,
      followeeId: userIdOf(1),
      limit: 500,
    });

    expect(one.followerIds).toHaveLength(1);
    expect(max.followerIds).toHaveLength(FOLLOWER_COUNT);
  });
});
