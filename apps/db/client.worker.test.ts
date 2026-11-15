import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  getTableConfig,
  snakeCase,
  type SQLiteTable,
} from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import {
  notDeleted,
  softDelete,
  timestamps,
  ulidPrimaryKey,
} from './schema/_shared/columns.ts';
import { textNoCase } from './schema/_shared/text-no-case.ts';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const probeItems = snakeCase.table('probe_items', {
  id: ulidPrimaryKey(),
  handle: textNoCase().notNull().unique(),
  ...timestamps(),
  ...softDelete(),
});

// 共通部品のSQL型・制約がD1上の振る舞いに反映されることを確かめるため、列の定義はテーブル定義から組み立てる
const createTableStatementOf = (table: SQLiteTable) => {
  const { name, columns } = getTableConfig(table);
  const columnDefinitions = columns.map((column) =>
    [
      column.name,
      column.getSQLType(),
      column.primary ? 'PRIMARY KEY' : '',
      column.notNull ? 'NOT NULL' : '',
      column.isUnique ? 'UNIQUE' : '',
    ]
      .filter((part) => part !== '')
      .join(' '),
  );
  return `CREATE TABLE ${name} (${columnDefinitions.join(', ')})`;
};

const db = createDatabase(env.DB);

const findByHandle = async (handle: string) => {
  const [row] = await db
    .select()
    .from(probeItems)
    .where(eq(probeItems.handle, handle));
  return row;
};

// Drizzleは単独のクエリの失敗をDrizzleQueryErrorで包んでD1のエラーをcauseに持つため、原因をたどって文言を集める
const rejectionMessagesOf = async (pending: Promise<unknown>) => {
  const reason: unknown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const messages: string[] = [];
  for (
    let current = reason;
    current instanceof Error;
    current = current.cause
  ) {
    messages.push(current.message);
  }
  return messages;
};

const UNIQUE_HANDLE_VIOLATION: unknown = expect.stringContaining(
  'UNIQUE constraint failed: probe_items.handle',
);

const listHandles = async () => {
  const rows = await db
    .select({ handle: probeItems.handle })
    .from(probeItems)
    .orderBy(probeItems.handle);
  return rows.map((row) => row.handle);
};

beforeEach(async () => {
  await env.DB.prepare('DROP TABLE IF EXISTS probe_items').run();
  await env.DB.prepare(createTableStatementOf(probeItems)).run();
});

describe('createDatabase', () => {
  test('追加時に呼び出し側の指定なしでULIDの主キーと作成・更新日時を設定する', async () => {
    const before = Date.now();

    await db.insert(probeItems).values({ handle: 'launch-stadium' });

    const after = Date.now();
    const row = await findByHandle('launch-stadium');
    expect(row?.id).toMatch(ULID_PATTERN);
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.createdAt.getTime()).toBeLessThanOrEqual(after);
    expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.updatedAt.getTime()).toBeLessThanOrEqual(after);
    expect(row?.deletedAt).toBeNull();
  });

  test('日時をUTCのエポックミリ秒の整数で保存する', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.678Z');

    await db.insert(probeItems).values({
      handle: 'launch-stadium',
      createdAt,
      updatedAt: createdAt,
    });

    const stored = await env.DB.prepare(
      'SELECT created_at, typeof(created_at) AS created_at_type FROM probe_items',
    ).first<{ created_at: number; created_at_type: string }>();
    expect(stored).toEqual({
      created_at: createdAt.getTime(),
      created_at_type: 'integer',
    });
  });

  test('更新時に呼び出し側の指定なしで更新日時だけを現在時刻にする', async () => {
    const insertedAt = new Date('2026-01-02T03:04:05.678Z');
    await db.insert(probeItems).values({
      handle: 'launch-stadium',
      createdAt: insertedAt,
      updatedAt: insertedAt,
    });
    const before = Date.now();

    await db
      .update(probeItems)
      .set({ handle: 'launch-stadium-renamed' })
      .where(eq(probeItems.handle, 'launch-stadium'));

    const after = Date.now();
    const row = await findByHandle('launch-stadium-renamed');
    expect(row?.createdAt.getTime()).toBe(insertedAt.getTime());
    expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.updatedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test('論理削除の絞り込み条件で削除日時の無い行だけを返す', async () => {
    await db
      .insert(probeItems)
      .values([{ handle: 'kept' }, { handle: 'removed' }]);
    await db
      .update(probeItems)
      .set({ deletedAt: new Date() })
      .where(eq(probeItems.handle, 'removed'));

    const visible = await db
      .select({ handle: probeItems.handle })
      .from(probeItems)
      .where(notDeleted(probeItems.deletedAt));

    expect(visible).toEqual([{ handle: 'kept' }]);
    expect(await listHandles()).toEqual(['kept', 'removed']);
  });

  test('大文字小文字だけが異なる値を一意制約の違反にする', async () => {
    await db.insert(probeItems).values({ handle: 'Launch-Stadium' });

    const messages = await rejectionMessagesOf(
      db.insert(probeItems).values({ handle: 'launch-STADIUM' }),
    );

    expect(messages).toContainEqual(UNIQUE_HANDLE_VIOLATION);
    expect(await listHandles()).toEqual(['Launch-Stadium']);
  });

  test('大文字小文字を区別せずに照合する', async () => {
    await db.insert(probeItems).values({ handle: 'Launch-Stadium' });

    const row = await findByHandle('LAUNCH-stadium');

    expect(row?.handle).toBe('Launch-Stadium');
  });

  test('値をSQL文に埋め込まずパラメータとして渡す', async () => {
    const hostileHandle = "x'); DROP TABLE probe_items; --";
    const query = db.insert(probeItems).values({ handle: hostileHandle });

    await query;

    expect(query.toSQL().sql).not.toContain(hostileHandle);
    expect(query.toSQL().params).toContain(hostileHandle);
    expect(await listHandles()).toEqual([hostileHandle]);
  });

  test('一括実行の途中の文が失敗すると、先行する書き込みも取り消す', async () => {
    await db.insert(probeItems).values({ handle: 'existing' });

    const batch = db.batch([
      db.insert(probeItems).values({ handle: 'first' }),
      db
        .update(probeItems)
        .set({ deletedAt: new Date() })
        .where(eq(probeItems.handle, 'existing')),
      db.insert(probeItems).values({ handle: 'EXISTING' }),
      db.insert(probeItems).values({ handle: 'last' }),
    ]);

    expect(await rejectionMessagesOf(batch)).toContainEqual(
      UNIQUE_HANDLE_VIOLATION,
    );
    expect(await listHandles()).toEqual(['existing']);
    expect((await findByHandle('existing'))?.deletedAt).toBeNull();
  });
});
