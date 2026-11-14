import { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type { UserProfileDirectory } from '../../../lib/core/profile/ports.ts';
import {
  after,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { D1UserProfileDirectory } from '../../../lib/workers/profile/d1-user-profile-directory.ts';
import { clearProfilePlatformTables } from '../../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { INQUIRY_TYPES } from '../../application/inquiry/inquiry-types.ts';
import type {
  InquirerProfile,
  InquirerProfiles,
} from '../../application/inquiry/ports.ts';
import { ProfileInquirerProfiles } from './profile-inquirer-profiles.ts';

const AVATAR_FILE_ID = '01JC0FILE00000000000000001';
const OTHER_AVATAR_FILE_ID = '01JC0FILE00000000000000002';

const BULK_USER_COUNT = 150;

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

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

function createProfiles(): InquirerProfiles {
  return new ProfileInquirerProfiles(new D1UserProfileDirectory(db));
}

beforeEach(async () => {
  await clearProfilePlatformTables();
});

describe('ProfileInquirerProfiles.findMany', () => {
  test('ニックネーム・ハンドル・プロフィール画像のIDを問い合わせの利用者の表示の形で返す', async () => {
    await insertUser(1, { nickname: 'やまだ たろう', handle: 'taro0yamada1' });
    await insertProfile(1, AVATAR_FILE_ID);

    const found = await createProfiles().findMany([userIdOf(1)]);

    expect(found).toEqual(
      new Map<string, InquirerProfile>([
        [
          userIdOf(1),
          {
            userId: userIdOf(1),
            nickname: 'やまだ たろう',
            handle: 'taro0yamada1',
            avatarFileId: AVATAR_FILE_ID,
          },
        ],
      ]),
    );
    expect(Object.keys(found.get(userIdOf(1)) ?? {}).toSorted()).toEqual([
      'avatarFileId',
      'handle',
      'nickname',
      'userId',
    ]);
  });

  test('プロフィールの行が無い利用者と画像を外した利用者は、画像のIDをnullで返す', async () => {
    await insertUser(1);
    await insertUser(2);
    await insertProfile(2, null);

    const found = await createProfiles().findMany([userIdOf(1), userIdOf(2)]);

    expect(found.get(userIdOf(1))?.avatarFileId).toBeNull();
    expect(found.get(userIdOf(2))?.avatarFileId).toBeNull();
  });

  test('退会済み(物理削除前)の利用者を画像のIDとともに返す', async () => {
    await insertUser(1, { deletedAt: after(1) });
    await insertProfile(1, AVATAR_FILE_ID);

    const found = await createProfiles().findMany([userIdOf(1)]);

    expect(found.get(userIdOf(1))).toMatchObject({
      userId: userIdOf(1),
      avatarFileId: AVATAR_FILE_ID,
    });
  });

  test('停止中の利用者を画像のIDとともに返す', async () => {
    await insertUser(1, { status: 'suspended', suspendedAt: after(1) });
    await insertProfile(1, OTHER_AVATAR_FILE_ID);

    const found = await createProfiles().findMany([userIdOf(1)]);

    expect(found.get(userIdOf(1))).toMatchObject({
      userId: userIdOf(1),
      avatarFileId: OTHER_AVATAR_FILE_ID,
    });
  });

  test('存在しない(物理削除済みの)利用者は含めない', async () => {
    await insertUser(1);

    const found = await createProfiles().findMany([userIdOf(1), userIdOf(2)]);

    expect([...found.keys()]).toEqual([userIdOf(1)]);
  });

  test('空の一覧では空の結果を返す', async () => {
    const found = await createProfiles().findMany([]);

    expect(found.size).toBe(0);
  });

  test('重複したIDを含む150件の照会をバインド変数の上限に収めて統合する', async () => {
    await insertUsers(range(1, BULK_USER_COUNT));

    const found = await createProfiles().findMany([
      ...range(1, BULK_USER_COUNT).map(userIdOf),
      userIdOf(1),
    ]);

    expect(found.size).toBe(BULK_USER_COUNT);
    expect(found.get(userIdOf(BULK_USER_COUNT))?.nickname).toBe(
      `利用者${String(BULK_USER_COUNT)}`,
    );
  });
});

describe('ProfileInquirerProfilesの束縛', () => {
  test('利用者の表示の照会口を注入して解決でき、照会口の結果を写す', async () => {
    await insertUser(1);
    await insertProfile(1, AVATAR_FILE_ID);
    const container = new Container();
    container
      .bind<UserProfileDirectory>(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
      .toConstantValue(new D1UserProfileDirectory(db));
    container
      .bind<InquirerProfiles>(INQUIRY_TYPES.InquirerProfiles)
      .to(ProfileInquirerProfiles);

    const profiles = container.get<InquirerProfiles>(
      INQUIRY_TYPES.InquirerProfiles,
    );

    expect(profiles).toBeInstanceOf(ProfileInquirerProfiles);
    expect(
      (await profiles.findMany([userIdOf(1)])).get(userIdOf(1))?.avatarFileId,
    ).toBe(AVATAR_FILE_ID);
  });
});
