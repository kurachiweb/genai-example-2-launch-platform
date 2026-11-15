import { beforeEach, describe, expect, test } from 'vitest';

import {
  previousHandleDelete,
  previousHandleRelease,
  previousHandleSoftDelete,
  previousHandleUpsert,
} from './previous-handle-statements.ts';
import {
  after,
  clearHandleTables,
  CURRENT_ONLY_NAMESPACE,
  db,
  insertPreviousHandle,
  insertUser,
  previousHandleIdOf,
  readPreviousHandles,
  T0,
  USER_NAMESPACE,
  userIdOf,
} from './testing/handle-fixtures.ts';

beforeEach(async () => {
  await clearHandleTables();
  await insertUser(1, { handle: 'alice' });
  await insertUser(2, { handle: 'bob' });
  await insertUser(3, { handle: 'carol' });
});

describe('previousHandleUpsert', () => {
  test('保有者に旧ハンドルが無ければ作成日時と更新日時を入れた行を挿入する', async () => {
    await db.batch([
      previousHandleUpsert(db, USER_NAMESPACE, {
        id: previousHandleIdOf(1),
        ownerId: userIdOf(1),
        handle: 'Old-Alice',
        now: after(10),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      {
        id: previousHandleIdOf(1),
        ownerId: userIdOf(1),
        handle: 'Old-Alice',
        createdAt: after(10),
        updatedAt: after(10),
        deletedAt: null,
      },
    ]);
  });

  test('保有者に旧ハンドルがあれば1行のまま値を置き換え、論理削除を解く', async () => {
    await insertPreviousHandle(1, 1, 'older-alice', { deletedAt: after(5) });
    await insertPreviousHandle(2, 2, 'old-bob');

    await db.batch([
      previousHandleUpsert(db, USER_NAMESPACE, {
        id: previousHandleIdOf(9),
        ownerId: userIdOf(1),
        handle: 'old-alice',
        now: after(10),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      {
        id: previousHandleIdOf(1),
        ownerId: userIdOf(1),
        handle: 'old-alice',
        createdAt: T0,
        updatedAt: after(10),
        deletedAt: null,
      },
      expect.objectContaining({ id: previousHandleIdOf(2), handle: 'old-bob' }),
    ]);
  });

  test('他の対象が同じ旧ハンドルを持っていれば一意索引の違反で一括の書き込みを取り消す', async () => {
    await insertPreviousHandle(1, 2, 'shared');

    await expect(
      db.batch([
        previousHandleUpsert(db, USER_NAMESPACE, {
          id: previousHandleIdOf(2),
          ownerId: userIdOf(1),
          handle: 'SHARED',
          now: after(10),
        }),
      ]),
    ).rejects.toThrow();

    expect(await readPreviousHandles()).toHaveLength(1);
  });

  test('旧ハンドルを持たない対象では例外にする', () => {
    expect(() =>
      previousHandleUpsert(db, CURRENT_ONLY_NAMESPACE, {
        id: previousHandleIdOf(1),
        ownerId: userIdOf(1),
        handle: 'old',
        now: T0,
      }),
    ).toThrow();
  });
});

describe('previousHandleRelease', () => {
  test('他の対象の同じ文字列の旧ハンドルを論理削除済みを含めて物理削除する', async () => {
    await insertPreviousHandle(1, 1, 'Taken');
    await insertPreviousHandle(2, 2, 'other');

    await db.batch([
      previousHandleRelease(db, USER_NAMESPACE, {
        handle: 'taken',
        exceptOwnerId: userIdOf(3),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      expect.objectContaining({ id: previousHandleIdOf(2), handle: 'other' }),
    ]);
  });

  test('論理削除済みの旧ハンドルも物理削除する', async () => {
    await insertPreviousHandle(3, 1, 'gone', { deletedAt: after(1) });
    await db.batch([
      previousHandleRelease(db, USER_NAMESPACE, {
        handle: 'GONE',
        exceptOwnerId: userIdOf(3),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([]);
  });

  test('本人の旧ハンドルの行は消さない', async () => {
    await insertPreviousHandle(1, 1, 'mine');

    await db.batch([
      previousHandleRelease(db, USER_NAMESPACE, {
        handle: 'MINE',
        exceptOwnerId: userIdOf(1),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      expect.objectContaining({ id: previousHandleIdOf(1), handle: 'mine' }),
    ]);
  });

  test('同じ旧ハンドルが無くても失敗せず、他の行を変えない', async () => {
    await insertPreviousHandle(1, 1, 'one');

    await db.batch([
      previousHandleRelease(db, USER_NAMESPACE, {
        handle: 'nothing',
        exceptOwnerId: userIdOf(2),
      }),
    ]);

    expect(await readPreviousHandles()).toHaveLength(1);
  });

  test('旧ハンドルを持たない対象では何もしない文を返す', async () => {
    await insertPreviousHandle(1, 1, 'one');

    await db.batch([
      previousHandleRelease(db, CURRENT_ONLY_NAMESPACE, {
        handle: 'one',
        exceptOwnerId: userIdOf(2),
      }),
    ]);

    expect(await readPreviousHandles()).toHaveLength(1);
  });
});

describe('previousHandleSoftDelete', () => {
  test('保有者の旧ハンドルだけに論理削除と更新日時を入れ、行は残す', async () => {
    await insertPreviousHandle(1, 1, 'old-alice');
    await insertPreviousHandle(2, 2, 'old-bob');

    await db.batch([
      previousHandleSoftDelete(db, USER_NAMESPACE, {
        ownerId: userIdOf(1),
        now: after(20),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      expect.objectContaining({
        id: previousHandleIdOf(1),
        handle: 'old-alice',
        updatedAt: after(20),
        deletedAt: after(20),
      }),
      expect.objectContaining({
        id: previousHandleIdOf(2),
        updatedAt: T0,
        deletedAt: null,
      }),
    ]);
  });

  test('論理削除済みの行の削除日時は変えない', async () => {
    await insertPreviousHandle(1, 1, 'old-alice', { deletedAt: after(5) });

    await db.batch([
      previousHandleSoftDelete(db, USER_NAMESPACE, {
        ownerId: userIdOf(1),
        now: after(20),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      expect.objectContaining({ updatedAt: T0, deletedAt: after(5) }),
    ]);
  });

  test('旧ハンドルを持たない対象では何もしない文を返す', async () => {
    await insertPreviousHandle(1, 1, 'old-alice');

    await db.batch([
      previousHandleSoftDelete(db, CURRENT_ONLY_NAMESPACE, {
        ownerId: userIdOf(1),
        now: after(20),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      expect.objectContaining({ deletedAt: null }),
    ]);
  });
});

describe('previousHandleDelete', () => {
  test('保有者の旧ハンドルを論理削除済みを含めて物理削除し、他の行は残す', async () => {
    await insertPreviousHandle(1, 1, 'old-alice', { deletedAt: after(5) });
    await insertPreviousHandle(2, 2, 'old-bob');

    await db.batch([previousHandleDelete(db, USER_NAMESPACE, userIdOf(1))]);

    expect(await readPreviousHandles()).toEqual([
      expect.objectContaining({ id: previousHandleIdOf(2) }),
    ]);
  });

  test('旧ハンドルを持たない対象では何もしない文を返す', async () => {
    await insertPreviousHandle(1, 1, 'old-alice');

    await db.batch([
      previousHandleDelete(db, CURRENT_ONLY_NAMESPACE, userIdOf(1)),
    ]);

    expect(await readPreviousHandles()).toHaveLength(1);
  });
});
