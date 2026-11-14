import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import {
  handleOccupiedCondition,
  isHandleOccupied,
  resolveHandle,
} from './handle-queries.ts';
import { previousHandleUpsert } from './previous-handle-statements.ts';
import {
  after,
  clearHandleTables,
  CURRENT_ONLY_NAMESPACE,
  db,
  insertPreviousHandle,
  insertUser,
  previousHandleIdOf,
  readPreviousHandles,
  readUserHandles,
  USER_NAMESPACE,
  userIdOf,
} from './testing/handle-fixtures.ts';

beforeEach(async () => {
  await clearHandleTables();
});

describe('resolveHandle', () => {
  test('大文字小文字の違いを同一視し、保存されている綴りの現在のハンドルを返す', async () => {
    await insertUser(1, { handle: 'Alice_01' });

    expect(await resolveHandle(db, USER_NAMESPACE, 'alice_01')).toEqual({
      kind: 'current',
      ownerId: userIdOf(1),
      handle: 'Alice_01',
    });
    expect(await resolveHandle(db, USER_NAMESPACE, 'ALICE_01')).toEqual({
      kind: 'current',
      ownerId: userIdOf(1),
      handle: 'Alice_01',
    });
  });

  test('旧ハンドルは大文字小文字を同一視して保有者のIDを返す', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertPreviousHandle(1, 1, 'Old-Alice');

    expect(await resolveHandle(db, USER_NAMESPACE, 'old-alice')).toEqual({
      kind: 'previous',
      ownerId: userIdOf(1),
    });
  });

  test('同じ文字列が別の対象の現在のハンドルと旧ハンドルにあれば現在のハンドルを優先する', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertUser(2, { handle: 'bob' });
    await insertPreviousHandle(1, 1, 'bob');

    expect(await resolveHandle(db, USER_NAMESPACE, 'bob')).toEqual({
      kind: 'current',
      ownerId: userIdOf(2),
      handle: 'bob',
    });
  });

  test('論理削除済みの旧ハンドルは解決に出さない', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertPreviousHandle(1, 1, 'old-alice', { deletedAt: after(1) });

    expect(await resolveHandle(db, USER_NAMESPACE, 'old-alice')).toEqual({
      kind: 'none',
    });
  });

  test('解決の対象にしない現在のハンドルは出さず、旧ハンドルがあればそちらを返す', async () => {
    await insertUser(1, { handle: 'alice', deletedAt: after(1) });
    await insertUser(2, { handle: 'bob' });
    await insertPreviousHandle(1, 2, 'alice');

    expect(await resolveHandle(db, USER_NAMESPACE, 'alice')).toEqual({
      kind: 'previous',
      ownerId: userIdOf(2),
    });
  });

  test('どの行にも無い文字列は何も解決しない', async () => {
    await insertUser(1, { handle: 'alice' });

    expect(await resolveHandle(db, USER_NAMESPACE, 'nobody')).toEqual({
      kind: 'none',
    });
  });

  test('旧ハンドルを持たない対象は現在のハンドルだけを解決する', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertPreviousHandle(1, 1, 'old-alice');

    expect(await resolveHandle(db, CURRENT_ONLY_NAMESPACE, 'Alice')).toEqual({
      kind: 'current',
      ownerId: userIdOf(1),
      handle: 'alice',
    });
    expect(
      await resolveHandle(db, CURRENT_ONLY_NAMESPACE, 'old-alice'),
    ).toEqual({ kind: 'none' });
  });
});

describe('isHandleOccupied', () => {
  test('何も無ければ使用中ではない', async () => {
    expect(await isHandleOccupied(db, USER_NAMESPACE, 'alice')).toBe(false);
  });

  test('他の対象の現在のハンドルを大文字小文字を区別せず使用中とする', async () => {
    await insertUser(1, { handle: 'Alice' });

    expect(await isHandleOccupied(db, USER_NAMESPACE, 'alice')).toBe(true);
    expect(
      await isHandleOccupied(db, USER_NAMESPACE, 'ALICE', {
        exceptOwnerId: userIdOf(2),
      }),
    ).toBe(true);
  });

  test('解決の対象にしない退会済みの現在のハンドルも使用中とする', async () => {
    await insertUser(1, { handle: 'alice', deletedAt: after(1) });

    expect(await isHandleOccupied(db, USER_NAMESPACE, 'alice')).toBe(true);
  });

  test('既定では他の対象の旧ハンドルを論理削除済みを含めて使用中としない', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertPreviousHandle(1, 1, 'old-alice');
    await insertUser(2, { handle: 'bob' });
    await insertPreviousHandle(2, 2, 'old-bob', { deletedAt: after(1) });

    expect(await isHandleOccupied(db, USER_NAMESPACE, 'old-alice')).toBe(false);
    expect(await isHandleOccupied(db, USER_NAMESPACE, 'old-bob')).toBe(false);
  });

  test('includePreviousのときだけ他の対象の旧ハンドルを論理削除済みを含めて使用中とする', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertPreviousHandle(1, 1, 'Old-Alice');
    await insertUser(2, { handle: 'bob' });
    await insertPreviousHandle(2, 2, 'old-bob', { deletedAt: after(1) });
    const options = { includePrevious: true, exceptOwnerId: userIdOf(3) };

    expect(
      await isHandleOccupied(db, USER_NAMESPACE, 'old-alice', options),
    ).toBe(true);
    expect(await isHandleOccupied(db, USER_NAMESPACE, 'OLD-BOB', options)).toBe(
      true,
    );
    expect(
      await isHandleOccupied(db, USER_NAMESPACE, 'alice', {
        includePrevious: true,
      }),
    ).toBe(true);
  });

  test('本人の現在のハンドルと旧ハンドルは除いて数える', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertPreviousHandle(1, 1, 'old-alice');
    const self = {
      exceptOwnerId: userIdOf(1),
      includePrevious: true,
    };

    expect(await isHandleOccupied(db, USER_NAMESPACE, 'alice', self)).toBe(
      false,
    );
    expect(await isHandleOccupied(db, USER_NAMESPACE, 'old-alice', self)).toBe(
      false,
    );
    expect(
      await isHandleOccupied(db, USER_NAMESPACE, 'alice', {
        exceptOwnerId: userIdOf(2),
      }),
    ).toBe(true);
  });

  test('旧ハンドルを持たない対象ではincludePreviousでも現在のハンドルだけを数える', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertPreviousHandle(1, 1, 'old-alice');
    const options = { includePrevious: true };

    expect(
      await isHandleOccupied(db, CURRENT_ONLY_NAMESPACE, 'old-alice', options),
    ).toBe(false);
    expect(
      await isHandleOccupied(db, CURRENT_ONLY_NAMESPACE, 'ALICE', options),
    ).toBe(true);
  });
});

describe('handleOccupiedCondition', () => {
  async function evaluate(
    handle: string,
    exceptOwnerId?: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({
        occupied: sql<number>`CASE WHEN ${handleOccupiedCondition(
          USER_NAMESPACE,
          handle,
          exceptOwnerId === undefined ? undefined : { exceptOwnerId },
        )} THEN 1 ELSE 0 END`,
      })
      .from(sql`(SELECT 1)`);
    return row?.occupied === 1;
  }

  test('他の対象の現在のハンドルと一致すれば真、本人の分と旧ハンドルは偽にする', async () => {
    await insertUser(1, { handle: 'Alice' });
    await insertUser(2, { handle: 'bob' });
    await insertPreviousHandle(1, 2, 'old-bob');

    expect(await evaluate('alice')).toBe(true);
    expect(await evaluate('alice', userIdOf(2))).toBe(true);
    expect(await evaluate('alice', userIdOf(1))).toBe(false);
    expect(await evaluate('old-bob')).toBe(false);
    expect(await evaluate('nobody')).toBe(false);
  });

  test('保存の文のCASE式に埋め込むと、使用中のときに一括の書き込み全体を取り消す', async () => {
    await insertUser(1, { handle: 'alice' });
    await insertUser(2, { handle: 'bob' });

    const rename = (handle: string) =>
      db
        .update(users)
        .set({
          handle: sql`CASE WHEN ${handleOccupiedCondition(USER_NAMESPACE, handle, { exceptOwnerId: userIdOf(2) })} THEN NULL ELSE ${handle} END`,
        })
        .where(eq(users.id, userIdOf(2)));
    const keepPrevious = previousHandleUpsert(db, USER_NAMESPACE, {
      id: previousHandleIdOf(1),
      ownerId: userIdOf(2),
      handle: 'bob',
      now: after(1),
    });

    await expect(db.batch([rename('ALICE'), keepPrevious])).rejects.toThrow();

    expect(await readUserHandles()).toEqual([
      { id: userIdOf(1), handle: 'alice' },
      { id: userIdOf(2), handle: 'bob' },
    ]);
    expect(await readPreviousHandles()).toEqual([]);

    await db.batch([rename('robert'), keepPrevious]);

    expect(await readUserHandles()).toEqual([
      { id: userIdOf(1), handle: 'alice' },
      { id: userIdOf(2), handle: 'robert' },
    ]);
    expect(await readPreviousHandles()).toEqual([
      expect.objectContaining({
        id: previousHandleIdOf(1),
        ownerId: userIdOf(2),
        handle: 'bob',
        createdAt: after(1),
        updatedAt: after(1),
        deletedAt: null,
      }),
    ]);
  });
});
