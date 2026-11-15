import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import {
  after,
  clearIdentityTables,
  db,
  emailOf,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { D1DisposableStatusStore } from './d1-disposable-status-store.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const SAVED_AT = after(60_000);

const UNDETERMINED_VERIFIED = {
  emailVerifiedAt: after(1000),
  disposableEmailStatus: 'undetermined',
  disposableEmailCheckedAt: after(1000),
} as const;

async function readRow(index: number) {
  const [row] = await db
    .select({
      status: users.disposableEmailStatus,
      checkedAt: users.disposableEmailCheckedAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userIdOf(index)));
  return row;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearIdentityTables();
});

describe('D1DisposableStatusStore.findSubject', () => {
  test('メールアドレス・退会と確認の有無・判定を返す', async () => {
    await insertUser(1, UNDETERMINED_VERIFIED);
    await insertUser(2, { deletedAt: after(2000) });

    const store = new D1DisposableStatusStore(db);

    await expect(store.findSubject(userIdOf(1))).resolves.toEqual({
      email: emailOf(1),
      withdrawn: false,
      emailVerified: true,
      status: 'undetermined',
    });
    await expect(store.findSubject(userIdOf(2))).resolves.toEqual({
      email: emailOf(2),
      withdrawn: true,
      emailVerified: false,
      status: null,
    });
  });

  test('利用者の行が無ければundefinedを返す', async () => {
    await expect(
      new D1DisposableStatusStore(db).findSubject(userIdOf(9)),
    ).resolves.toBeUndefined();
  });
});

describe('D1DisposableStatusStore.saveRecheckResult', () => {
  test.each([
    { label: '未判定', status: 'undetermined' },
    { label: '空の判定', status: null },
  ] as const)(
    '判定が$labelの確認済みの利用者に、結果と判定の日時を保存する',
    async ({ status }) => {
      await insertUser(1, {
        ...UNDETERMINED_VERIFIED,
        disposableEmailStatus: status,
      });

      await new D1DisposableStatusStore(db).saveRecheckResult(
        userIdOf(1),
        emailOf(1).toUpperCase(),
        'disposable',
        SAVED_AT,
      );

      expect(await readRow(1)).toEqual({
        status: 'disposable',
        checkedAt: SAVED_AT,
        updatedAt: SAVED_AT,
      });
    },
  );

  test.each([
    {
      label: '判定したメールアドレスから変わっていれば',
      columns: { ...UNDETERMINED_VERIFIED, email: 'changed@mail.example' },
      expected: { status: 'undetermined', checkedAt: after(1000) },
    },
    {
      label: '退会済みなら',
      columns: { ...UNDETERMINED_VERIFIED, deletedAt: after(2000) },
      expected: { status: 'undetermined', checkedAt: after(1000) },
    },
    {
      label: '未確認なら',
      columns: { ...UNDETERMINED_VERIFIED, emailVerifiedAt: null },
      expected: { status: 'undetermined', checkedAt: after(1000) },
    },
    {
      label: '判定が確定していれば',
      columns: { ...UNDETERMINED_VERIFIED, disposableEmailStatus: 'regular' },
      expected: { status: 'regular', checkedAt: after(1000) },
    },
  ] as const)('$label保存しない', async ({ columns, expected }) => {
    await insertUser(1, columns);

    await new D1DisposableStatusStore(db).saveRecheckResult(
      userIdOf(1),
      emailOf(1),
      'disposable',
      SAVED_AT,
    );

    expect(await readRow(1)).toEqual({ ...expected, updatedAt: T0 });
  });
});
