import { describe, expect, test } from 'bun:test';

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { users } from '../../../db/schema/identity/users.ts';
import { userPreviousHandles } from '../../../db/schema/profile/user-previous-handles.ts';
import {
  defineHandleNamespace,
  requirePreviousSource,
} from './handle-namespace.ts';

const VALID = {
  name: 'user',
  rule: { maxLength: 30, reservedWords: ['admin'] },
  current: {
    table: users,
    ownerId: users.id,
    handle: users.handle,
  },
  previous: {
    table: userPreviousHandles,
    ownerId: userPreviousHandles.ownerId,
    handle: userPreviousHandles.handle,
    deletedAt: userPreviousHandles.deletedAt,
  },
};

describe('defineHandleNamespace', () => {
  test('正しい記述はそのまま返す', () => {
    expect(defineHandleNamespace(VALID)).toBe(VALID);
  });

  test('旧ハンドルを持たない対象も定義できる', () => {
    const currentOnly = {
      name: VALID.name,
      rule: VALID.rule,
      current: VALID.current,
    };

    expect(defineHandleNamespace(currentOnly).previous).toBeUndefined();
  });

  test.each(['product', 'help-article', 'a', 'a1-b2'])(
    '名前%sを受け付ける',
    (name) => {
      expect(defineHandleNamespace({ ...VALID, name }).name).toBe(name);
    },
  );

  test.each([
    '',
    'User',
    '1user',
    '-user',
    '_user',
    'user_x',
    'ユーザー',
    'a b',
  ])('名前「%s」は例外にする', (name) => {
    expect(() => defineHandleNamespace({ ...VALID, name })).toThrow();
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '上限%sは例外にする',
    (maxLength) => {
      expect(() =>
        defineHandleNamespace({
          ...VALID,
          rule: { ...VALID.rule, maxLength },
        }),
      ).toThrow();
    },
  );

  test('上限が1なら受け付ける', () => {
    expect(
      defineHandleNamespace({
        ...VALID,
        rule: { ...VALID.rule, maxLength: 1 },
      }).rule.maxLength,
    ).toBe(1);
  });

  test('現在のハンドルの列が別のテーブルの列なら例外にする', () => {
    expect(() =>
      defineHandleNamespace({
        ...VALID,
        current: { ...VALID.current, handle: userPreviousHandles.handle },
      }),
    ).toThrow();
  });

  test('旧ハンドルの保有者の列が別のテーブルの列なら例外にする', () => {
    expect(() =>
      defineHandleNamespace({
        ...VALID,
        previous: { ...VALID.previous, ownerId: users.id },
      }),
    ).toThrow();
  });

  test('旧ハンドルに論理削除の列が無ければ例外にする', () => {
    expect(() =>
      defineHandleNamespace({
        ...VALID,
        previous: {
          table: userPreviousHandles,
          ownerId: userPreviousHandles.ownerId,
          handle: userPreviousHandles.handle,
        },
      }),
    ).toThrow();
  });

  test('旧ハンドルのテーブルに主キー・作成日時・更新日時の列が無ければ例外にする', () => {
    const bare = sqliteTable('bare_previous_handles', {
      ownerId: text('owner_id').notNull(),
      handle: text('handle').notNull(),
      deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    });

    expect(() =>
      defineHandleNamespace({
        ...VALID,
        previous: {
          table: bare,
          ownerId: bare.ownerId,
          handle: bare.handle,
          deletedAt: bare.deletedAt,
        },
      }),
    ).toThrow();
  });
});

describe('requirePreviousSource', () => {
  test('旧ハンドルを持たない対象にはundefinedを返す', () => {
    const currentOnly = defineHandleNamespace({
      name: VALID.name,
      rule: VALID.rule,
      current: VALID.current,
    });

    expect(requirePreviousSource(currentOnly)).toBeUndefined();
  });

  test('旧ハンドルの列に主キーと日時の列を足して返す', () => {
    const source = requirePreviousSource(defineHandleNamespace(VALID));

    expect(source?.table).toBe(userPreviousHandles);
    expect(source?.ownerId).toBe(userPreviousHandles.ownerId);
    expect(source?.handle).toBe(userPreviousHandles.handle);
    expect(source?.deletedAt).toBe(userPreviousHandles.deletedAt);
    expect(source?.id).toBe(userPreviousHandles.id);
    expect(source?.createdAt).toBe(userPreviousHandles.createdAt);
    expect(source?.updatedAt).toBe(userPreviousHandles.updatedAt);
  });
});
