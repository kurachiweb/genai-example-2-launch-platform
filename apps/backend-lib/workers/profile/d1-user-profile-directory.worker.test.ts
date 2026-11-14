import { beforeEach, describe, expect, test } from 'vitest';

import { userPreviousHandles } from '../../../db/schema/profile/user-previous-handles.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import type { UserLookupScope } from '../../core/profile/ports.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1UserProfileDirectory } from './d1-user-profile-directory.ts';

const AVATAR_FILE_ID = '01JC0FILE00000000000000001';

const BULK_USER_COUNT = 200;

function profileIdOf(index: number): string {
  return `01JC0PROF${String(index).padStart(17, '0')}`;
}

async function insertProfile(
  index: number,
  avatarFileId: string | null,
): Promise<void> {
  await db.insert(userProfiles).values({
    id: profileIdOf(index),
    userId: userIdOf(index),
    avatarFileId,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function insertPrevious(
  index: number,
  ownerIndex: number,
  handle: string,
  deletedAt: Date | null = null,
): Promise<void> {
  await db.insert(userPreviousHandles).values({
    id: `01JC0PRVHDL${String(index).padStart(15, '0')}`,
    ownerId: userIdOf(ownerIndex),
    handle,
    createdAt: T0,
    updatedAt: T0,
    deletedAt,
  });
}

const directory = new D1UserProfileDirectory(db);

beforeEach(async () => {
  await db.delete(userPreviousHandles);
  await db.delete(userProfiles);
  await clearIdentityTables();
  await insertUser(1, { handle: 'Alice', nickname: 'アリス' });
  await insertUser(2, {
    handle: 'bob',
    nickname: 'ボブ',
    status: 'suspended',
    suspendedAt: after(1),
  });
  await insertUser(3, {
    handle: 'carol',
    nickname: 'キャロル',
    deletedAt: after(2),
  });
});

describe('findSummaries', () => {
  test('可視の範囲では停止中・退会済みの利用者を返さない', async () => {
    const found = await directory.findSummaries(
      [userIdOf(1), userIdOf(2), userIdOf(3)],
      'visible',
    );

    expect([...found.keys()]).toEqual([userIdOf(1)]);
    expect(found.get(userIdOf(1))).toEqual({
      userId: userIdOf(1),
      handle: 'Alice',
      nickname: 'アリス',
      avatarFileId: null,
      suspended: false,
    });
  });

  test('退会済みを除く範囲では停止中の利用者を返し、停止中の印を付ける', async () => {
    const found = await directory.findSummaries(
      [userIdOf(1), userIdOf(2), userIdOf(3)],
      'not-withdrawn',
    );

    expect([...found.keys()].toSorted()).toEqual([userIdOf(1), userIdOf(2)]);
    expect(found.get(userIdOf(2))).toEqual({
      userId: userIdOf(2),
      handle: 'bob',
      nickname: 'ボブ',
      avatarFileId: null,
      suspended: true,
    });
  });

  test('退会済みを含む範囲では退会済みの利用者も返す', async () => {
    const found = await directory.findSummaries(
      [userIdOf(1), userIdOf(2), userIdOf(3)],
      'including-withdrawn',
    );

    expect([...found.keys()].toSorted()).toEqual([
      userIdOf(1),
      userIdOf(2),
      userIdOf(3),
    ]);
    expect(found.get(userIdOf(3))).toMatchObject({
      handle: 'carol',
      nickname: 'キャロル',
    });
  });

  test.each<UserLookupScope>([
    'visible',
    'not-withdrawn',
    'including-withdrawn',
  ])(
    '範囲%sでも存在しないIDは返さず、空の一覧では問い合わせずに空の結果を返す',
    async (scope) => {
      const found = await directory.findSummaries(
        [userIdOf(1), '01JC0USER99999999999999999'],
        scope,
      );

      expect([...found.keys()]).toEqual([userIdOf(1)]);
      expect((await directory.findSummaries([], scope)).size).toBe(0);
    },
  );

  test('プロフィールの画像のIDを返し、プロフィールの行が無い利用者の画像は空になる', async () => {
    await insertProfile(1, AVATAR_FILE_ID);

    const found = await directory.findSummaries(
      [userIdOf(1), userIdOf(2)],
      'not-withdrawn',
    );

    expect(found.get(userIdOf(1))?.avatarFileId).toBe(AVATAR_FILE_ID);
    expect(found.get(userIdOf(2))?.avatarFileId).toBeNull();
  });

  test('プロフィールの行があっても画像が未設定なら画像は空になる', async () => {
    await insertProfile(1, null);

    const found = await directory.findSummaries([userIdOf(1)], 'visible');

    expect(found.get(userIdOf(1))?.avatarFileId).toBeNull();
  });

  test('退会済みの利用者の画像は退会済みを含む範囲だけで返す', async () => {
    await insertProfile(3, AVATAR_FILE_ID);

    const withdrawn = await directory.findSummaries(
      [userIdOf(3)],
      'including-withdrawn',
    );
    const notWithdrawn = await directory.findSummaries(
      [userIdOf(3)],
      'not-withdrawn',
    );

    expect(withdrawn.get(userIdOf(3))?.avatarFileId).toBe(AVATAR_FILE_ID);
    expect(notWithdrawn.size).toBe(0);
  });

  test('重複したIDは1件にまとめ、90件を超えるIDも1件も落とさず引く', async () => {
    const indexes = Array.from(
      { length: BULK_USER_COUNT },
      (_, offset) => offset + 100,
    );
    await insertUsers(indexes);
    const ids = indexes.flatMap((index) => [userIdOf(index), userIdOf(index)]);

    const found = await directory.findSummaries(ids, 'visible');

    expect(found.size).toBe(BULK_USER_COUNT);
    expect(found.get(userIdOf(299))?.handle).toBe('user299');
  });
});

describe('resolveHandle', () => {
  test('現在のハンドルは大文字小文字を区別せず、保存されている綴りの利用者を返す', async () => {
    await insertProfile(1, AVATAR_FILE_ID);

    const resolution = await directory.resolveHandle('aLiCe');

    expect(resolution).toEqual({
      kind: 'current',
      user: {
        userId: userIdOf(1),
        handle: 'Alice',
        nickname: 'アリス',
        avatarFileId: AVATAR_FILE_ID,
        suspended: false,
      },
    });
  });

  test('旧ハンドルは保有者の現在のハンドルを持つ利用者を返す', async () => {
    await insertPrevious(1, 1, 'Old-Alice');

    const resolution = await directory.resolveHandle('old-alice');

    expect(resolution).toMatchObject({
      kind: 'previous',
      user: { userId: userIdOf(1), handle: 'Alice' },
    });
  });

  test('停止中の利用者のハンドルは解決し、停止中の印を付ける', async () => {
    await insertPrevious(1, 2, 'old-bob');

    const current = await directory.resolveHandle('bob');
    const previous = await directory.resolveHandle('old-bob');

    expect(current).toMatchObject({
      kind: 'current',
      user: { userId: userIdOf(2), suspended: true },
    });
    expect(previous).toMatchObject({
      kind: 'previous',
      user: { userId: userIdOf(2), suspended: true },
    });
  });

  test('退会済みの利用者の現在のハンドルは解決しない', async () => {
    expect(await directory.resolveHandle('carol')).toEqual({ kind: 'none' });
  });

  test('退会済みの利用者の旧ハンドルは、論理削除されずに残っていても解決しない', async () => {
    await insertPrevious(1, 3, 'old-carol');

    expect(await directory.resolveHandle('old-carol')).toEqual({
      kind: 'none',
    });
  });

  test('論理削除済みの旧ハンドルと存在しないハンドルは解決しない', async () => {
    await insertPrevious(1, 1, 'released', after(3));

    expect(await directory.resolveHandle('released')).toEqual({
      kind: 'none',
    });
    expect(await directory.resolveHandle('nobody')).toEqual({ kind: 'none' });
  });
});
