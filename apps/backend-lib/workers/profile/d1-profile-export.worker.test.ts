import { beforeEach, describe, expect, test } from 'vitest';

import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1ProfileExport } from './d1-profile-export.ts';

const AVATAR_FILE_ID = '01JC0FILE00000000000000001';

async function insertProfile(
  index: number,
  columns: Partial<typeof userProfiles.$inferInsert> = {},
): Promise<void> {
  await db.insert(userProfiles).values({
    id: `01JC0PROF${String(index).padStart(17, '0')}`,
    userId: userIdOf(index),
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

async function insertWebsite(
  userIndex: number,
  position: number,
  name: string | null,
  url: string,
): Promise<void> {
  await db.insert(userProfileWebsites).values({
    id: `01JC0WEB${String(userIndex * 100 + position).padStart(18, '0')}`,
    userId: userIdOf(userIndex),
    position,
    name,
    url,
    createdAt: T0,
    updatedAt: T0,
  });
}

const profileExport = new D1ProfileExport(db);

beforeEach(async () => {
  await db.delete(userFollows);
  await db.delete(userProfileWebsites);
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

describe('ProfileExport.find', () => {
  test('プロフィールの全項目を返し、外部Webサイトは位置の順に並べる', async () => {
    await insertProfile(1, {
      headline: '個人開発者',
      bioMarkdown: '# 自己紹介',
      avatarFileId: AVATAR_FILE_ID,
      updatedAt: after(500),
    });
    await insertWebsite(1, 1, 'Blog', 'https://blog.example/');
    await insertWebsite(1, 0, 'GitHub', 'https://github.example/alice');

    const record = await profileExport.find(userIdOf(1));

    expect(record).toEqual({
      handle: 'Alice',
      nickname: 'アリス',
      headline: '個人開発者',
      bioMarkdown: '# 自己紹介',
      avatarFileId: AVATAR_FILE_ID,
      websites: [
        { name: 'GitHub', url: 'https://github.example/alice' },
        { name: 'Blog', url: 'https://blog.example/' },
      ],
      updatedAt: after(500),
    });
  });

  test('名前が未入力の外部Webサイトは名前を空文字列にする', async () => {
    await insertProfile(1);
    await insertWebsite(1, 0, null, 'https://site.example/');

    const record = await profileExport.find(userIdOf(1));

    expect(record?.websites).toEqual([
      { name: '', url: 'https://site.example/' },
    ]);
  });

  test('プロフィールの行が無い利用者は未設定の項目を空にし、更新日時に登録日時を返す', async () => {
    const record = await profileExport.find(userIdOf(1));

    expect(record).toEqual({
      handle: 'Alice',
      nickname: 'アリス',
      headline: null,
      bioMarkdown: null,
      avatarFileId: null,
      websites: [],
      updatedAt: T0,
    });
  });

  test('他の利用者の外部Webサイトを含めない', async () => {
    await insertProfile(1);
    await insertProfile(2);
    await insertWebsite(2, 0, 'Bob', 'https://bob.example/');

    const record = await profileExport.find(userIdOf(1));

    expect(record?.websites).toEqual([]);
  });

  test('停止中の利用者のプロフィールも返す', async () => {
    await insertProfile(2, { headline: '停止中' });

    const record = await profileExport.find(userIdOf(2));

    expect(record).toMatchObject({ handle: 'bob', headline: '停止中' });
  });

  test('退会済みの利用者は、プロフィールの行があっても返さない', async () => {
    await insertProfile(3, { headline: '退会済み' });
    await insertWebsite(3, 0, 'Carol', 'https://carol.example/');

    expect(await profileExport.find(userIdOf(3))).toBeUndefined();
  });

  test('物理削除済みで行の無い利用者は返さない', async () => {
    expect(
      await profileExport.find('01JC0USER99999999999999999'),
    ).toBeUndefined();
  });
});
