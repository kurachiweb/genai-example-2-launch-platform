import { beforeEach, describe, expect, test } from 'vitest';

import type {
  AccountExport,
  AccountExportRecord,
} from '../../core/identity/ports.ts';
import { D1AccountExport } from './d1-account-export.ts';
import {
  after,
  clearIdentityTables,
  createFailingDatabase,
  db,
  insertTotpCredential,
  insertUser,
  T0,
  userIdOf,
} from './testing/identity-store-fixtures.ts';

const EXPORTED_FIELDS = [
  'userId',
  'pseudonymousId',
  'email',
  'emailVerifiedAt',
  'registeredAt',
  'mfaEnabled',
] as const satisfies readonly (keyof AccountExportRecord)[];

function createAccountExport(database = db): AccountExport {
  return new D1AccountExport(database);
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('D1AccountExport', () => {
  test('通常の利用者の仮名化ID・メールアドレス・確認日時・登録日時を返す', async () => {
    await insertUser(1, {
      pseudonymousId: 'pseudonymous-taro',
      email: 'Taro.Yamada@Mail.Example',
      emailVerifiedAt: after(1000),
      createdAt: after(500),
    });

    const record = await createAccountExport().find(userIdOf(1));

    expect(record).toEqual({
      userId: userIdOf(1),
      pseudonymousId: 'pseudonymous-taro',
      email: 'Taro.Yamada@Mail.Example',
      emailVerifiedAt: after(1000),
      registeredAt: after(500),
      mfaEnabled: false,
    });
  });

  test('メールアドレスが未確認の利用者は確認日時をnullとして返す', async () => {
    await insertUser(1, { emailVerifiedAt: null });

    const record = await createAccountExport().find(userIdOf(1));

    expect(record?.emailVerifiedAt).toBeNull();
    expect(record?.registeredAt).toEqual(T0);
  });

  test('多要素認証が有効な利用者は有効状態を真として返す', async () => {
    await insertUser(1, { emailVerifiedAt: after(1000) });
    await insertTotpCredential(1, { enabledAt: after(2000) });

    const record = await createAccountExport().find(userIdOf(1));

    expect(record?.mfaEnabled).toBe(true);
  });

  test('多要素認証が設定途中の待ちだけの利用者は有効状態を偽として返す', async () => {
    await insertUser(1, { emailVerifiedAt: after(1000) });
    await insertTotpCredential(1, {
      enabledAt: null,
      pendingExpiresAt: after(600_000),
    });

    const record = await createAccountExport().find(userIdOf(1));

    expect(record?.mfaEnabled).toBe(false);
  });

  test('多要素認証の有効状態は他の利用者の設定に左右されない', async () => {
    await insertUser(1);
    await insertUser(2);
    await insertTotpCredential(2, { enabledAt: after(2000) });

    const [first, second] = await Promise.all([
      createAccountExport().find(userIdOf(1)),
      createAccountExport().find(userIdOf(2)),
    ]);

    expect(first?.mfaEnabled).toBe(false);
    expect(second?.mfaEnabled).toBe(true);
  });

  test('停止中の利用者のアカウントの部分も返す', async () => {
    await insertUser(1, {
      status: 'suspended',
      suspendedAt: after(2000),
      emailVerifiedAt: after(1000),
    });

    const record = await createAccountExport().find(userIdOf(1));

    expect(record).toEqual({
      userId: userIdOf(1),
      pseudonymousId: 'pseudonymous-1',
      email: 'user1@mail.example',
      emailVerifiedAt: after(1000),
      registeredAt: T0,
      mfaEnabled: false,
    });
  });

  test('退会済みの利用者のアカウントの部分は返さない', async () => {
    await insertUser(1, {
      emailVerifiedAt: after(1000),
      deletedAt: after(2000),
    });
    await insertTotpCredential(1, { enabledAt: after(1500) });

    await expect(
      createAccountExport().find(userIdOf(1)),
    ).resolves.toBeUndefined();
  });

  test('存在しない利用者のアカウントの部分は返さない', async () => {
    await insertUser(1);

    await expect(
      createAccountExport().find(userIdOf(2)),
    ).resolves.toBeUndefined();
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    await insertUser(1);

    await expect(
      createAccountExport(createFailingDatabase()).find(userIdOf(1)),
    ).rejects.toThrow();
  });

  test('結果にパスワードハッシュ・TOTPの秘密鍵などの秘密情報の項目を含めない', async () => {
    await insertUser(1, {
      passwordHash: 'pbkdf2-sha256$secret-hash',
      emailVerifiedAt: after(1000),
    });
    await insertTotpCredential(1, {
      sealedSecret: 'sealed-totp-secret',
      enabledAt: after(2000),
      lastUsedStep: 42,
    });

    const record = await createAccountExport().find(userIdOf(1));

    expect(Object.keys(record ?? {}).toSorted()).toEqual(
      [...EXPORTED_FIELDS].toSorted(),
    );
    expect(Object.values(record ?? {})).not.toContain(
      'pbkdf2-sha256$secret-hash',
    );
    expect(Object.values(record ?? {})).not.toContain('sealed-totp-secret');
  });
});
