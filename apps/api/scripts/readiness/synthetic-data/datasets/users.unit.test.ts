import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createMigratedDatabase } from '../migrated-database.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext, SqlStatement } from '../sql-writer.ts';
import { usersDataset } from './users.ts';

const context: DatasetContext = { seed: 1, baseDate: '2026-11-24' };

const smokeStatements = (): SqlStatement[] => [
  ...usersDataset.generate(SMOKE_PROFILE, context),
];

const countRows = (
  statements: Iterable<SqlStatement>,
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const statement of statements) {
    counts[statement.table] =
      (counts[statement.table] ?? 0) + statement.insertedRows;
  }
  return counts;
};

let db: Database;

beforeEach(() => {
  db = createMigratedDatabase();
});

afterEach(() => {
  db.close();
});

const applySmoke = (): void => {
  for (const statement of smokeStatements()) {
    db.run(statement.text);
  }
};

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

describe('usersDataset', () => {
  test('依存先を持たず、名前はusersになる', () => {
    expect(usersDataset.name).toBe('users');
    expect(usersDataset.dependsOn).toEqual([]);
  });

  test('想定規模の件数の利用者・プロフィール・フォロー・開催通知の受信設定を作る', () => {
    const counts = countRows(usersDataset.generate(YEAR_ONE_PROFILE, context));

    expect(counts).toEqual({
      users: 50_000,
      user_profiles: 50_000,
      user_follows: 10_000,
      notification_preferences: 10_000,
    });
  }, 120_000);

  test('外部キーの順に、利用者・プロフィール・フォロー・受信設定の順で文を並べる', () => {
    const tables = smokeStatements().map((statement) => statement.table);
    const order = [...new Set(tables)];

    expect(order).toEqual([
      'users',
      'user_profiles',
      'user_follows',
      'notification_preferences',
    ]);
    expect(tables.join(',')).toBe(
      [...tables]
        .toSorted((a, b) => order.indexOf(a) - order.indexOf(b))
        .join(','),
    );
  });

  test('検証用の規模の出力を、外部キーを有効にしたマイグレーション済みのSQLiteへ誤り無く適用できる', () => {
    applySmoke();

    expect(scalar('SELECT count(*) FROM users')).toBe(50);
    expect(scalar('SELECT count(*) FROM user_profiles')).toBe(50);
    expect(scalar('SELECT count(*) FROM user_follows')).toBe(10);
    expect(scalar('SELECT count(*) FROM notification_preferences')).toBe(10);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('メールアドレスのドメインはreadiness.exampleだけで、全員が確認済みで有効な利用者になる', () => {
    applySmoke();

    expect(
      scalar(
        "SELECT count(*) FROM users WHERE email NOT LIKE '%@readiness.example'",
      ),
    ).toBe(0);
    expect(
      scalar(
        "SELECT count(*) FROM users WHERE status = 'active' AND deleted_at IS NULL AND email_verified_at IS NOT NULL AND disposable_email_status = 'regular' AND disposable_email_checked_at IS NOT NULL",
      ),
    ).toBe(50);
  });

  test('出力した全ての文字列に、.example以外のトップレベルドメインのURLやメールアドレスが無い', () => {
    const text = smokeStatements()
      .map((statement) => statement.text)
      .join('\n');

    const hosts = [...text.matchAll(/(?:https?:\/\/|@)([A-Za-z0-9.-]+)/gu)].map(
      (match) => match[1] ?? '',
    );
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.every((host) => host.endsWith('.example'))).toBe(true);
  });

  test('作り手(番号0)のフォロワーが規模の人数で、作り手自身と他の利用者は含まない', () => {
    applySmoke();

    expect(
      scalar('SELECT count(*) FROM user_follows WHERE deleted_at IS NULL'),
    ).toBe(10);
    expect(
      scalar(
        "SELECT count(DISTINCT followee_id) FROM user_follows WHERE followee_id = (SELECT id FROM users WHERE handle = 'synthetic-u-000001')",
      ),
    ).toBe(1);
    expect(
      scalar(
        "SELECT count(*) FROM user_follows WHERE follower_id = (SELECT id FROM users WHERE handle = 'synthetic-u-000001')",
      ),
    ).toBe(0);
  });

  test('フォロワー全員の開催通知(followed_user_match)の受信設定が有効で、他の種別と他の利用者の行は作らない', () => {
    applySmoke();

    expect(
      scalar(
        "SELECT count(*) FROM notification_preferences WHERE topic = 'followed_user_match' AND enabled = 1 AND user_id IN (SELECT follower_id FROM user_follows)",
      ),
    ).toBe(10);
    expect(scalar('SELECT count(*) FROM notification_preferences')).toBe(10);
  });

  test('同じ種と基準日なら同じ文を出し、種が変わると変わる', () => {
    const texts = (seed: number): string[] =>
      [...usersDataset.generate(SMOKE_PROFILE, { ...context, seed })].map(
        (statement) => statement.text,
      );

    expect(texts(1)).toEqual(texts(1));
    expect(texts(2)).not.toEqual(texts(1));
  });

  test('プロフィールの文字数は上限(見出し50・自己紹介5000)に収まり、アバターは空にする', () => {
    applySmoke();

    expect(
      scalar('SELECT max(length(headline)) FROM user_profiles'),
    ).toBeLessThanOrEqual(50);
    expect(
      scalar('SELECT max(length(bio_markdown)) FROM user_profiles'),
    ).toBeLessThanOrEqual(5000);
    expect(scalar('SELECT count(avatar_file_id) FROM user_profiles')).toBe(0);
  });

  test('全ての文が1行で90,000バイト以下になる', () => {
    for (const statement of smokeStatements()) {
      expect(statement.text).not.toContain('\n');
      expect(Buffer.byteLength(statement.text, 'utf8')).toBeLessThanOrEqual(
        90_000,
      );
    }
  });

  test('見本として作り手と先頭の利用者のハンドルを返す', () => {
    const samples = usersDataset.samples?.(SMOKE_PROFILE, context);

    expect(samples?.largestCreatorHandle).toEqual(['synthetic-u-000001']);
    expect(samples?.profileHandles).toEqual([
      'synthetic-u-000001',
      'synthetic-u-000002',
      'synthetic-u-000003',
      'synthetic-u-000004',
      'synthetic-u-000005',
    ]);
  });

  test('規模が検証の条件を満たさないと例外にする', () => {
    expect(() => [
      ...usersDataset.generate({ ...SMOKE_PROFILE, users: 10 }, context),
    ]).toThrow(/フォロワー/u);
  });
});
