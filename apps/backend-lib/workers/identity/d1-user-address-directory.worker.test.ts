import { beforeEach, describe, expect, test } from 'vitest';

import type { UserAddressDirectory } from '../../core/email/ports.ts';
import { D1UserAddressDirectory } from './d1-user-address-directory.ts';
import {
  after,
  clearIdentityTables,
  createFailingDatabase,
  createRecordingDatabase,
  db,
  emailOf,
  expectSplitWithinBindLimit,
  expectWithinBindLimit,
  insertUser,
  insertUsers,
} from './testing/identity-store-fixtures.ts';

function createDirectory(database = db): UserAddressDirectory {
  return new D1UserAddressDirectory(database);
}

function indexesUpTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('D1UserAddressDirectory', () => {
  test('退会していない利用者のメールアドレスを照合キーの集合で返し、未登録のアドレスを含めない', async () => {
    await insertUser(1, { email: 'Taro.Yamada@Mail.Example' });
    await insertUser(2, { status: 'suspended' });

    const lookup = await createDirectory().findRegistered([
      '  TARO.yamada@mail.example ',
      emailOf(2),
      'unknown@mail.example',
    ]);

    expect(lookup).toEqual({
      kind: 'available',
      registered: new Set(['taro.yamada@mail.example', emailOf(2)]),
    });
  });

  test('退会済みの利用者のメールアドレスは登録済みとみなさない', async () => {
    await insertUser(1, { deletedAt: after(1000) });

    const lookup = await createDirectory().findRegistered([emailOf(1)]);

    expect(lookup).toEqual({ kind: 'available', registered: new Set() });
  });

  test('退会した利用者と同じアドレスで登録し直した利用者がいれば登録済みとみなす', async () => {
    await insertUser(1, { deletedAt: after(1000) });
    await insertUser(2, { email: emailOf(1) });

    const lookup = await createDirectory().findRegistered([emailOf(1)]);

    expect(lookup).toEqual({
      kind: 'available',
      registered: new Set([emailOf(1)]),
    });
  });

  test('空の一覧はD1へ問い合わせずに空の集合を返す', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();

    const lookup = await createDirectory(database).findRegistered([]);

    expect(lookup).toEqual({ kind: 'available', registered: new Set() });
    expect(placeholderCounts).toEqual([]);
  });

  test('90件は1文で照会する', async () => {
    await insertUsers(indexesUpTo(90));
    const { database, placeholderCounts } = createRecordingDatabase();

    const lookup = await createDirectory(database).findRegistered(
      indexesUpTo(90).map(emailOf),
    );

    expect(lookup.kind === 'available' && lookup.registered.size).toBe(90);
    expect(placeholderCounts).toHaveLength(1);
    expectWithinBindLimit(placeholderCounts);
  });

  test('91件以上はバインド変数の上限に収まるよう分割して照会し、全件の結果を合わせて返す', async () => {
    await insertUsers(indexesUpTo(95));
    const { database, placeholderCounts } = createRecordingDatabase();

    const lookup = await createDirectory(database).findRegistered([
      ...indexesUpTo(95).map(emailOf),
      'unknown@mail.example',
    ]);

    expect(lookup).toEqual({
      kind: 'available',
      registered: new Set(indexesUpTo(95).map(emailOf)),
    });
    expectSplitWithinBindLimit(placeholderCounts);
  });

  test('D1への問い合わせに失敗したら照会口が使えないことを返す', async () => {
    await insertUser(1);

    const lookup = await createDirectory(
      createFailingDatabase(),
    ).findRegistered([emailOf(1)]);

    expect(lookup).toEqual({ kind: 'unavailable' });
  });
});
