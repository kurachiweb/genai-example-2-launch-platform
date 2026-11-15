import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { FollowStore } from '../../application/profile/ports.ts';
import { D1FollowStore } from './d1-follow-store.ts';

const ALICE = 1;
const BOB = 2;
const CAROL = 3;
const DAVE = 4;
const ERIN = 5;

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

async function allFollows() {
  return db.select().from(userFollows).orderBy(asc(userFollows.id));
}

function createStore(): FollowStore {
  return new D1FollowStore(db);
}

const store = createStore();

beforeEach(async () => {
  await db.delete(userFollows);
  await db.delete(userProfiles);
  await clearIdentityTables();
  await insertUser(ALICE, { handle: 'Alice', nickname: 'アリス' });
  await insertUser(BOB, { handle: 'bob', nickname: 'ボブ' });
  await insertUser(CAROL, {
    handle: 'carol',
    nickname: 'キャロル',
    status: 'suspended',
    suspendedAt: after(1),
  });
  await insertUser(DAVE, {
    handle: 'dave',
    nickname: 'デイブ',
    deletedAt: after(2),
  });
});

describe('insertIfAbsent', () => {
  test('可視の相手なら行を記録してinsertedを返す', async () => {
    const result = await store.insertIfAbsent({
      id: followIdOf(1),
      followerId: userIdOf(ALICE),
      followeeId: userIdOf(BOB),
      now: after(500),
    });

    expect(result).toBe('inserted');
    expect(await allFollows()).toEqual([
      {
        id: followIdOf(1),
        followerId: userIdOf(ALICE),
        followeeId: userIdOf(BOB),
        createdAt: after(500),
        updatedAt: after(500),
        deletedAt: null,
      },
    ]);
  });

  test('同じ組を再度記録してもexistsを返し、行も元のIDと日時のまま増えない', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });

    const result = await store.insertIfAbsent({
      id: followIdOf(2),
      followerId: userIdOf(ALICE),
      followeeId: userIdOf(BOB),
      now: after(900),
    });

    expect(result).toBe('exists');
    const rows = await allFollows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: followIdOf(1),
      createdAt: after(100),
    });
  });

  test('逆向きの組は別の行として記録できる', async () => {
    await insertFollow(1, ALICE, BOB);

    const result = await store.insertIfAbsent({
      id: followIdOf(2),
      followerId: userIdOf(BOB),
      followeeId: userIdOf(ALICE),
      now: after(10),
    });

    expect(result).toBe('inserted');
    expect(await allFollows()).toHaveLength(2);
  });

  test.each([
    ['停止中', CAROL],
    ['退会済み', DAVE],
    ['存在しない', 99],
  ])(
    '相手が%sならtarget-unavailableを返し、行を記録しない',
    async (_, index) => {
      const result = await store.insertIfAbsent({
        id: followIdOf(1),
        followerId: userIdOf(ALICE),
        followeeId: userIdOf(index),
        now: after(10),
      });

      expect(result).toBe('target-unavailable');
      expect(await allFollows()).toEqual([]);
    },
  );

  test('既に記録した後に相手が停止されたときはexistsを返す', async () => {
    await insertFollow(1, ALICE, CAROL);

    const result = await store.insertIfAbsent({
      id: followIdOf(2),
      followerId: userIdOf(ALICE),
      followeeId: userIdOf(CAROL),
      now: after(10),
    });

    expect(result).toBe('exists');
    expect(await allFollows()).toHaveLength(1);
  });

  test('論理削除済みの行がある組は復活させず、target-unavailableを返す', async () => {
    await insertFollow(1, ALICE, BOB, { deletedAt: after(5) });

    const result = await store.insertIfAbsent({
      id: followIdOf(2),
      followerId: userIdOf(ALICE),
      followeeId: userIdOf(BOB),
      now: after(10),
    });

    expect(result).toBe('target-unavailable');
    const rows = await allFollows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toEqual(after(5));
  });
});

describe('delete', () => {
  test('指定した組の行だけを物理削除する', async () => {
    await insertFollow(1, ALICE, BOB);
    await insertFollow(2, BOB, ALICE);
    await insertFollow(3, ALICE, CAROL);

    await store.delete(userIdOf(ALICE), userIdOf(BOB));

    expect((await allFollows()).map((row) => row.id)).toEqual([
      followIdOf(2),
      followIdOf(3),
    ]);
  });

  test('行が無い組を指定しても成功する', async () => {
    await expect(
      store.delete(userIdOf(ALICE), userIdOf(BOB)),
    ).resolves.toBeUndefined();
    expect(await allFollows()).toEqual([]);
  });

  test('論理削除済みの行も物理削除する', async () => {
    await insertFollow(1, ALICE, BOB, { deletedAt: after(5) });

    await store.delete(userIdOf(ALICE), userIdOf(BOB));

    expect(await allFollows()).toEqual([]);
  });
});

describe('isFollowing', () => {
  test('有効な行があればtrue、無ければfalseを返す', async () => {
    await insertFollow(1, ALICE, BOB);

    expect(await store.isFollowing(userIdOf(ALICE), userIdOf(BOB))).toBe(true);
    expect(await store.isFollowing(userIdOf(BOB), userIdOf(ALICE))).toBe(false);
  });

  test('論理削除済みの行はfalseを返す', async () => {
    await insertFollow(1, ALICE, BOB, { deletedAt: after(5) });

    expect(await store.isFollowing(userIdOf(ALICE), userIdOf(BOB))).toBe(false);
  });
});

describe('countVisibleFollowers', () => {
  test('フォロワーがいなければ0を返す', async () => {
    expect(await store.countVisibleFollowers(userIdOf(BOB))).toBe(0);
  });

  test('停止中・退会済みのフォロワーと論理削除済みの行を数えず、行は残したままにする', async () => {
    await insertUsers([ERIN, 6]);
    await insertFollow(1, ALICE, BOB);
    await insertFollow(2, CAROL, BOB);
    await insertFollow(3, DAVE, BOB);
    await insertFollow(4, ERIN, BOB);
    await insertFollow(5, 6, BOB, { deletedAt: after(5) });
    await insertFollow(6, BOB, ALICE);

    expect(await store.countVisibleFollowers(userIdOf(BOB))).toBe(2);
    expect(await allFollows()).toHaveLength(6);
  });
});

describe('list', () => {
  beforeEach(async () => {
    await insertUsers([ERIN, 6, 7]);
  });

  test('フォロー中を作成日時の新しい順に、利用者の表示の型で返す', async () => {
    await db.insert(userProfiles).values({
      id: '01JC0PROF000000000000000001',
      userId: userIdOf(ERIN),
      avatarFileId: '01JC0FILE00000000000000001',
      createdAt: T0,
      updatedAt: T0,
    });
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });
    await insertFollow(2, ALICE, ERIN, { createdAt: after(300) });
    await insertFollow(3, ALICE, 6, { createdAt: after(200) });

    const entries = await store.list({
      userId: userIdOf(ALICE),
      direction: 'following',
      first: 10,
      after: undefined,
    });

    expect(entries).toEqual([
      {
        followId: followIdOf(2),
        user: {
          userId: userIdOf(ERIN),
          handle: 'user5',
          nickname: '利用者5',
          avatarFileId: '01JC0FILE00000000000000001',
          suspended: false,
        },
        followedAt: after(300),
      },
      {
        followId: followIdOf(3),
        user: {
          userId: userIdOf(6),
          handle: 'user6',
          nickname: '利用者6',
          avatarFileId: null,
          suspended: false,
        },
        followedAt: after(200),
      },
      {
        followId: followIdOf(1),
        user: {
          userId: userIdOf(BOB),
          handle: 'bob',
          nickname: 'ボブ',
          avatarFileId: null,
          suspended: false,
        },
        followedAt: after(100),
      },
    ]);
  });

  test('フォロワーを新しい順に返し、自分以外のフォローは含めない', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });
    await insertFollow(2, ERIN, BOB, { createdAt: after(200) });
    await insertFollow(3, ERIN, ALICE, { createdAt: after(300) });

    const entries = await store.list({
      userId: userIdOf(BOB),
      direction: 'followers',
      first: 10,
      after: undefined,
    });

    expect(entries.map((entry) => entry.user.userId)).toEqual([
      userIdOf(ERIN),
      userIdOf(ALICE),
    ]);
  });

  test('停止中・退会済みの相手と論理削除済みの行を一覧から除くが、行は残る', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });
    await insertFollow(2, ALICE, CAROL, { createdAt: after(200) });
    await insertFollow(3, ALICE, DAVE, { createdAt: after(300) });
    await insertFollow(4, ALICE, ERIN, {
      createdAt: after(400),
      deletedAt: after(500),
    });
    await insertFollow(5, CAROL, BOB, { createdAt: after(600) });
    await insertFollow(6, DAVE, BOB, { createdAt: after(700) });

    const following = await store.list({
      userId: userIdOf(ALICE),
      direction: 'following',
      first: 10,
      after: undefined,
    });
    const followers = await store.list({
      userId: userIdOf(BOB),
      direction: 'followers',
      first: 10,
      after: undefined,
    });

    expect(following.map((entry) => entry.followId)).toEqual([followIdOf(1)]);
    expect(followers.map((entry) => entry.followId)).toEqual([followIdOf(1)]);
    expect(await allFollows()).toHaveLength(6);
  });

  test('停止中の利用者からのフォローは自分のフォロワーの一覧にも出ない', async () => {
    await insertFollow(1, CAROL, ALICE, { createdAt: after(100) });

    const followers = await store.list({
      userId: userIdOf(ALICE),
      direction: 'followers',
      first: 10,
      after: undefined,
    });

    expect(followers).toEqual([]);
  });

  test('first+1件までを返し、それ以上の行は返さない', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });
    await insertFollow(2, ALICE, ERIN, { createdAt: after(200) });
    await insertFollow(3, ALICE, 6, { createdAt: after(300) });
    await insertFollow(4, ALICE, 7, { createdAt: after(400) });

    const entries = await store.list({
      userId: userIdOf(ALICE),
      direction: 'following',
      first: 2,
      after: undefined,
    });

    expect(entries.map((entry) => entry.followId)).toEqual([
      followIdOf(4),
      followIdOf(3),
      followIdOf(2),
    ]);
  });

  test('件数がfirst以下ならある分だけを返す', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });

    const entries = await store.list({
      userId: userIdOf(ALICE),
      direction: 'following',
      first: 5,
      after: undefined,
    });

    expect(entries).toHaveLength(1);
  });

  test('位置の後から続きを読み、位置の行そのものは含めない', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });
    await insertFollow(2, ALICE, ERIN, { createdAt: after(200) });
    await insertFollow(3, ALICE, 6, { createdAt: after(300) });
    await insertFollow(4, ALICE, 7, { createdAt: after(400) });

    const entries = await store.list({
      userId: userIdOf(ALICE),
      direction: 'following',
      first: 10,
      after: { t: after(300).getTime(), id: followIdOf(3) },
    });

    expect(entries.map((entry) => entry.followId)).toEqual([
      followIdOf(2),
      followIdOf(1),
    ]);
  });

  test('同じ作成日時の行はIDの新しい順に並び、位置のIDより小さい行だけが続く', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });
    await insertFollow(2, ALICE, ERIN, { createdAt: after(100) });
    await insertFollow(3, ALICE, 6, { createdAt: after(100) });
    await insertFollow(4, ALICE, 7, { createdAt: after(50) });

    const all = await store.list({
      userId: userIdOf(ALICE),
      direction: 'following',
      first: 10,
      after: undefined,
    });
    const rest = await store.list({
      userId: userIdOf(ALICE),
      direction: 'following',
      first: 10,
      after: { t: after(100).getTime(), id: followIdOf(2) },
    });

    expect(all.map((entry) => entry.followId)).toEqual([
      followIdOf(3),
      followIdOf(2),
      followIdOf(1),
      followIdOf(4),
    ]);
    expect(rest.map((entry) => entry.followId)).toEqual([
      followIdOf(1),
      followIdOf(4),
    ]);
  });

  test('ページをたどると全件を重複なく新しい順に読める', async () => {
    await insertFollow(1, ALICE, BOB, { createdAt: after(100) });
    await insertFollow(2, ALICE, ERIN, { createdAt: after(100) });
    await insertFollow(3, ALICE, 6, { createdAt: after(200) });
    await insertFollow(4, ALICE, 7, { createdAt: after(200) });

    const seen: string[] = [];
    let position: { t: number; id: string } | undefined;
    for (let page = 0; page < 5; page += 1) {
      const rows = await store.list({
        userId: userIdOf(ALICE),
        direction: 'following',
        first: 2,
        after: position,
      });
      const shown = rows.slice(0, 2);
      seen.push(...shown.map((row) => row.followId));
      if (rows.length <= 2) {
        break;
      }
      const last = shown.at(-1);
      position = last && { t: last.followedAt.getTime(), id: last.followId };
    }

    expect(seen).toEqual([
      followIdOf(4),
      followIdOf(3),
      followIdOf(2),
      followIdOf(1),
    ]);
  });

  test('フォローが無い利用者には空の配列を返す', async () => {
    const entries = await store.list({
      userId: userIdOf(ALICE),
      direction: 'followers',
      first: 10,
      after: undefined,
    });

    expect(entries).toEqual([]);
  });
});
