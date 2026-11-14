import { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  clearIdentityTables,
  createRecordingDatabase,
  expectSplitWithinBindLimit,
  insertUser,
  insertUsers,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { INQUIRY_TYPES } from '../../application/inquiry/inquiry-types.ts';
import type {
  InquirerProfile,
  InquirerProfiles,
} from '../../application/inquiry/ports.ts';
import { D1InquirerProfiles } from './d1-inquirer-profiles.ts';
import {
  after,
  db,
  resetInquiryTables,
} from './testing/inquiry-store-fixtures.ts';

const IDS_PER_STATEMENT = 100;

const PROFILE_FIELDS = [
  'userId',
  'nickname',
  'handle',
  'avatarFileId',
] as const satisfies readonly (keyof InquirerProfile)[];

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

function createProfiles(database: Database = db): InquirerProfiles {
  return new D1InquirerProfiles(database);
}

beforeEach(async () => {
  await resetInquiryTables();
  await clearIdentityTables();
});

describe('D1InquirerProfiles.findMany', () => {
  test('利用者のID・ニックネーム・ハンドルを返し、プロフィール画像は常に空にする', async () => {
    await insertUser(1, { nickname: 'やまだ たろう', handle: 'taro0yamada1' });
    await insertUser(2);

    const found = await createProfiles().findMany([userIdOf(1), userIdOf(2)]);

    expect(found).toEqual(
      new Map<string, InquirerProfile>([
        [
          userIdOf(1),
          {
            userId: userIdOf(1),
            nickname: 'やまだ たろう',
            handle: 'taro0yamada1',
            avatarFileId: null,
          },
        ],
        [
          userIdOf(2),
          {
            userId: userIdOf(2),
            nickname: '利用者2',
            handle: 'user2',
            avatarFileId: null,
          },
        ],
      ]),
    );
    expect(Object.keys(found.get(userIdOf(1)) ?? {}).toSorted()).toEqual(
      [...PROFILE_FIELDS].toSorted(),
    );
  });

  test('退会済み(論理削除)・停止中の利用者も、退会済みの問い合わせの表示に使うため返す', async () => {
    await insertUser(1, { deletedAt: after(1) });
    await insertUser(2, { status: 'suspended', suspendedAt: after(2) });

    const found = await createProfiles().findMany([userIdOf(1), userIdOf(2)]);

    expect([...found.keys()].toSorted()).toEqual([userIdOf(1), userIdOf(2)]);
  });

  test('存在しない(物理削除済みの)利用者は含めず、存在しないと判別できる', async () => {
    await insertUser(1);

    const found = await createProfiles().findMany([userIdOf(1), userIdOf(2)]);

    expect([...found.keys()]).toEqual([userIdOf(1)]);
    expect(found.has(userIdOf(2))).toBe(false);
  });

  test('重複したIDは1件として問い合わせる', async () => {
    await insertUsers([1, 2]);
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createProfiles(database).findMany([
      userIdOf(1),
      userIdOf(2),
      userIdOf(1),
    ]);

    expect([...found.keys()].toSorted()).toEqual([userIdOf(1), userIdOf(2)]);
    expect(placeholderCounts).toEqual([2]);
  });

  test('空の一覧ではD1へ問い合わせずに空の結果を返す', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createProfiles(database).findMany([]);

    expect(found.size).toBe(0);
    expect(placeholderCounts).toEqual([]);
  });

  test('100件までは1回の問い合わせで読む', async () => {
    await insertUsers(range(1, 100));
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createProfiles(database).findMany(
      range(1, 100).map(userIdOf),
    );

    expect(found.size).toBe(100);
    expect(placeholderCounts).toEqual([IDS_PER_STATEMENT]);
  });

  test('101件のIDは100件ずつの照会に分け、バインド変数の上限に収めて結果を統合する', async () => {
    await insertUsers(range(1, 101));
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createProfiles(database).findMany(
      range(1, 101).map(userIdOf),
    );

    expect(found.size).toBe(101);
    expect(found.get(userIdOf(101))?.nickname).toBe('利用者101');
    expectSplitWithinBindLimit(placeholderCounts);
    expect(placeholderCounts).toEqual([IDS_PER_STATEMENT, 1]);
  });
});

describe('D1InquirerProfilesの束縛', () => {
  function createContainer(): Container {
    const container = new Container();
    container.bind<Database>(PLATFORM_TYPES.Database).toConstantValue(db);
    container
      .bind<InquirerProfiles>(INQUIRY_TYPES.InquirerProfiles)
      .to(D1InquirerProfiles);
    return container;
  }

  test('照会の識別子で、データベースを注入した既定の実装を解決できる', async () => {
    await insertUser(1);

    const profiles = createContainer().get<InquirerProfiles>(
      INQUIRY_TYPES.InquirerProfiles,
    );

    expect(profiles).toBeInstanceOf(D1InquirerProfiles);
    expect((await profiles.findMany([userIdOf(1)])).size).toBe(1);
  });

  test('照会の識別子の束縛を、画像付きの別の実装へ差し替えられる', async () => {
    const withAvatar: InquirerProfiles = {
      findMany: (userIds) =>
        Promise.resolve(
          new Map(
            userIds.map((userId) => [
              userId,
              {
                userId,
                nickname: '差し替えた利用者',
                handle: 'replaced',
                avatarFileId: '01JC0FILE00000000000000001',
              },
            ]),
          ),
        ),
    };
    const container = createContainer();

    container
      .rebind<InquirerProfiles>(INQUIRY_TYPES.InquirerProfiles)
      .toConstantValue(withAvatar);
    const profiles = container.get<InquirerProfiles>(
      INQUIRY_TYPES.InquirerProfiles,
    );

    expect(profiles).toBe(withAvatar);
    expect(
      (await profiles.findMany([userIdOf(1)])).get(userIdOf(1))?.avatarFileId,
    ).toBe('01JC0FILE00000000000000001');
  });
});
