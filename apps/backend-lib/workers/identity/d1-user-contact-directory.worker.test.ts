import { beforeEach, describe, expect, test } from 'vitest';

import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { D1UserContactDirectory } from './d1-user-contact-directory.ts';
import {
  after,
  clearIdentityTables,
  createFailingDatabase,
  db,
  insertUser,
  userIdOf,
} from './testing/identity-store-fixtures.ts';

function createDirectory(database = db): UserContactDirectory {
  return new D1UserContactDirectory(database);
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('D1UserContactDirectory', () => {
  test('メールアドレスを確認済みの利用者の連絡先を返す', async () => {
    await insertUser(1, {
      email: 'Taro.Yamada@Mail.Example',
      nickname: '山田太郎',
      emailVerifiedAt: after(1000),
    });

    const contact = await createDirectory().findContact(userIdOf(1));

    expect(contact).toEqual({
      userId: userIdOf(1),
      email: 'Taro.Yamada@Mail.Example',
      nickname: '山田太郎',
      emailVerified: true,
    });
  });

  test('メールアドレスが未確認の利用者は確認済みを偽として返す', async () => {
    await insertUser(1, { emailVerifiedAt: null });

    const contact = await createDirectory().findContact(userIdOf(1));

    expect(contact).toEqual({
      userId: userIdOf(1),
      email: 'user1@mail.example',
      nickname: '利用者1',
      emailVerified: false,
    });
  });

  test('停止中の利用者の連絡先も返す', async () => {
    await insertUser(1, {
      status: 'suspended',
      suspendedAt: after(2000),
      emailVerifiedAt: after(1000),
    });

    const contact = await createDirectory().findContact(userIdOf(1));

    expect(contact).toEqual({
      userId: userIdOf(1),
      email: 'user1@mail.example',
      nickname: '利用者1',
      emailVerified: true,
    });
  });

  test('退会済みの利用者の連絡先は返さない', async () => {
    await insertUser(1, {
      emailVerifiedAt: after(1000),
      deletedAt: after(2000),
    });

    await expect(
      createDirectory().findContact(userIdOf(1)),
    ).resolves.toBeUndefined();
  });

  test('存在しない利用者の連絡先は返さない', async () => {
    await insertUser(1);

    await expect(
      createDirectory().findContact(userIdOf(2)),
    ).resolves.toBeUndefined();
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    await insertUser(1);

    await expect(
      createDirectory(createFailingDatabase()).findContact(userIdOf(1)),
    ).rejects.toThrow();
  });
});
