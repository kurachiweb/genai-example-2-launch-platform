import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { SQLiteDialect } from 'drizzle-orm/sqlite-core';

import { users } from './users.ts';
import {
  DISPOSABLE_EMAIL_STATUSES,
  USER_STATUSES,
  verifiedUsers,
  visibleUsers,
} from './visibility.ts';

const dialect = new SQLiteDialect();

const VERIFIED_AT = Date.UTC(2026, 9, 1);
const DELETED_AT = Date.UTC(2026, 9, 2);

interface ProbeRow {
  readonly id: string;
  readonly status: 'active' | 'suspended';
  readonly emailVerifiedAt: number | null;
  readonly deletedAt: number | null;
}

const PROBE_ROWS: readonly ProbeRow[] = [
  {
    id: 'active-verified',
    status: 'active',
    emailVerifiedAt: VERIFIED_AT,
    deletedAt: null,
  },
  {
    id: 'active-unverified',
    status: 'active',
    emailVerifiedAt: null,
    deletedAt: null,
  },
  {
    id: 'suspended-verified',
    status: 'suspended',
    emailVerifiedAt: VERIFIED_AT,
    deletedAt: null,
  },
  {
    id: 'withdrawn-verified',
    status: 'active',
    emailVerifiedAt: VERIFIED_AT,
    deletedAt: DELETED_AT,
  },
  {
    id: 'withdrawn-while-suspended',
    status: 'suspended',
    emailVerifiedAt: VERIFIED_AT,
    deletedAt: DELETED_AT,
  },
];

// 絞り込み条件が読む列だけを持つ利用者のテーブルを作り、条件の振る舞いを実際のSQLiteで確かめる
const createProbeDatabase = () => {
  const sqlite = new Database(':memory:');
  sqlite.run(
    'CREATE TABLE users (id text PRIMARY KEY, status text NOT NULL, email_verified_at integer, deleted_at integer)',
  );
  const insert = sqlite.prepare(
    'INSERT INTO users (id, status, email_verified_at, deleted_at) VALUES (?, ?, ?, ?)',
  );
  for (const row of PROBE_ROWS) {
    insert.run(row.id, row.status, row.emailVerifiedAt, row.deletedAt);
  }
  return drizzle({ client: sqlite });
};

describe('USER_STATUSES・DISPOSABLE_EMAIL_STATUSES', () => {
  test('利用者の状態は有効・停止中の2値になる', () => {
    expect(USER_STATUSES).toEqual(['active', 'suspended']);
  });

  test('使い捨て判定の結果は使い捨て・通常・未判定の3値になる', () => {
    expect(DISPOSABLE_EMAIL_STATUSES).toEqual([
      'disposable',
      'regular',
      'undetermined',
    ]);
  });
});

describe('visibleUsers', () => {
  let db: ReturnType<typeof createProbeDatabase>;

  beforeEach(() => {
    db = createProbeDatabase();
  });

  test('退会しておらず有効な利用者に絞り込む条件になる', () => {
    const query = dialect.sqlToQuery(visibleUsers());

    expect(query.sql).toBe(
      '(("users"."deleted_at" is null) and "users"."status" = ?)',
    );
    expect(query.params).toEqual(['active']);
  });

  test('退会済みと停止中の利用者を除き、確認の有無を問わずに残す', () => {
    const rows = db
      .select({ id: users.id })
      .from(users)
      .where(visibleUsers())
      .orderBy(users.id)
      .all();

    expect(rows.map((row) => row.id)).toEqual([
      'active-unverified',
      'active-verified',
    ]);
  });
});

describe('verifiedUsers', () => {
  let db: ReturnType<typeof createProbeDatabase>;

  beforeEach(() => {
    db = createProbeDatabase();
  });

  test('可視ユーザーの条件に、メールアドレスが確認済みであることを加えた条件になる', () => {
    const query = dialect.sqlToQuery(verifiedUsers());

    expect(query.sql).toBe(
      '((("users"."deleted_at" is null) and "users"."status" = ?) and ("users"."email_verified_at" is not null))',
    );
    expect(query.params).toEqual(['active']);
  });

  test('可視ユーザーのうち、メールアドレスが確認済みの利用者だけを残す', () => {
    const rows = db
      .select({ id: users.id })
      .from(users)
      .where(verifiedUsers())
      .all();

    expect(rows.map((row) => row.id)).toEqual(['active-verified']);
  });
});
