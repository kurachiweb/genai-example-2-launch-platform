import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import {
  BULK_CLIENT_IP_POOL_SIZE,
  BULK_USERS_CHUNK_SIZE,
  bulkUserSeed,
  bulkUsersInsertSqls,
  clientIpOf,
  parseBulkUsersInsert,
  parsePasswordHashLookup,
  passwordHashLookupSql,
} from './bulk-users-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'db',
  'migrations',
);

const PASSWORD_HASH =
  'pbkdf2-sha512$100000$AAAAAAAAAAAAAAAAAAAAAA$' + 'B'.repeat(86);

const TEMPLATE = {
  passwordHash: PASSWORD_HASH,
  disposableEmailStatus: 'regular',
  disposableEmailCheckedAt: 1_794_000_000_000,
};

// Linuxの1つの引数の長さの上限(MAX_ARG_STRLEN)
const MAX_ARGUMENT_BYTES = 128 * 1024;

const AT = new Date('2026-11-23T09:00:00.000Z');

const SUFFIX = '0a1b2c3d';

const seedAt = (index: number) =>
  bulkUserSeed({
    suffix: SUFFIX,
    index,
    id: `01JC0BULK${String(index).padStart(17, '0')}`,
    pseudonymousId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  });

const seedsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => seedAt(index + 1));

let db: Database;

const queryRows = (sql: string): Record<string, unknown>[] =>
  db.query<Record<string, unknown>, []>(sql).all();

// wrangler d1 executeと同じく、複数の文の結果の行を文の順につなげて返す
const executeAll = (sql: string): Record<string, unknown>[] =>
  sql
    .split(';\n')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .flatMap((statement) => queryRows(statement));

beforeEach(async () => {
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of await readNestedD1Migrations(MIGRATIONS_DIR)) {
    for (const query of migration.queries) {
      db.run(query);
    }
  }
});

afterEach(() => {
  db.close();
});

describe('clientIpOf', () => {
  test('文書用の3つの範囲の外へ出ない', () => {
    const ranges = ['192.0.2.', '198.51.100.', '203.0.113.'];

    for (let index = 0; index < BULK_CLIENT_IP_POOL_SIZE; index += 1) {
      const address = clientIpOf(index, 0);

      expect(ranges.some((range) => address.startsWith(range))).toBe(true);
      const host = Number(address.slice(address.lastIndexOf('.') + 1));
      expect(host).toBeGreaterThanOrEqual(1);
      expect(host).toBeLessThanOrEqual(254);
    }
  });

  test('100人を超えても、割り当ての上限までは全員が別のIPアドレスになる', () => {
    const addresses = new Set(
      Array.from({ length: BULK_CLIENT_IP_POOL_SIZE }, (_, index) =>
        clientIpOf(index, 17),
      ),
    );

    expect(addresses.size).toBe(BULK_CLIENT_IP_POOL_SIZE);
  });

  test('開始位置を変えると同じ番号でも別のIPアドレスから始まる', () => {
    expect(clientIpOf(0, 0)).toBe('192.0.2.1');
    expect(clientIpOf(0, 254)).toBe('198.51.100.1');
    expect(clientIpOf(0, 508)).toBe('203.0.113.1');
    expect(clientIpOf(0, BULK_CLIENT_IP_POOL_SIZE)).toBe('192.0.2.1');
  });

  test('負の番号と整数でない番号は拒否する', () => {
    expect(() => clientIpOf(-1, 0)).toThrow(RangeError);
    expect(() => clientIpOf(0.5, 0)).toThrow(RangeError);
    expect(() => clientIpOf(0, -1)).toThrow(RangeError);
  });
});

describe('bulkUserSeed', () => {
  test('ハンドルは登録で生成する初期ハンドルと同じ12文字の英小文字と数字になる', () => {
    expect(seedAt(7).handle).toMatch(/^[a-z0-9]{12}$/u);
  });

  test('接尾辞と番号が違えばメールアドレスとハンドルも違う', () => {
    const other = bulkUserSeed({
      suffix: 'ffffffff',
      index: 7,
      id: 'x',
      pseudonymousId: 'y',
    });

    expect(other.email).not.toBe(seedAt(7).email);
    expect(other.handle).not.toBe(seedAt(7).handle);
    expect(seedAt(8).email).not.toBe(seedAt(7).email);
    expect(seedAt(8).handle).not.toBe(seedAt(7).handle);
  });

  test('メールアドレスはテスト用のドメインで、ニックネームに番号を含む', () => {
    const seed = seedAt(42);

    expect(seed.email).toEndWith('@test.example');
    expect(seed.nickname).toContain('42');
  });

  test('番号が3桁に収まらなければ拒否する', () => {
    expect(() => seedAt(1000)).toThrow(RangeError);
    expect(() => seedAt(-1)).toThrow(RangeError);
  });

  test('接尾辞が8桁の英小文字と数字でなければ拒否する', () => {
    expect(() =>
      bulkUserSeed({ suffix: 'ABC', index: 1, id: 'x', pseudonymousId: 'y' }),
    ).toThrow(RangeError);
  });
});

describe('passwordHashLookupSql・parsePasswordHashLookup', () => {
  const insertFirst = (status: string | null, checkedAt: number | null) => {
    db.run(
      `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, disposable_email_status, disposable_email_checked_at, created_at, updated_at) VALUES ('01JC0FIRST0000000000000001', 'p1', 'e2e-o''first@test.example', ?, 'n', 'firsthandle1', 1, 1, ?, ?, 1, 1)`,
      [PASSWORD_HASH, status, checkedAt],
    );
  };

  test('メールアドレスの大文字小文字を区別せずに利用者のIDとパスワードのハッシュと使い捨てメールアドレスの判定を引く', () => {
    insertFirst('regular', 1_794_000_000_000);

    const rows = queryRows(passwordHashLookupSql("E2E-O'FIRST@test.example"));

    expect(parsePasswordHashLookup(rows, "E2E-O'FIRST@test.example")).toEqual({
      userId: '01JC0FIRST0000000000000001',
      passwordHash: PASSWORD_HASH,
      disposableEmailStatus: 'regular',
      disposableEmailCheckedAt: 1_794_000_000_000,
    });
  });

  test('判定がまだ無い利用者はNULLのまま返す', () => {
    insertFirst(null, null);

    const rows = queryRows(passwordHashLookupSql("e2e-o'first@test.example"));

    expect(
      parsePasswordHashLookup(rows, "e2e-o'first@test.example"),
    ).toMatchObject({
      disposableEmailStatus: null,
      disposableEmailCheckedAt: null,
    });
  });

  test('利用者が見つからなければメールアドレスを示して失敗する', () => {
    const rows = queryRows(passwordHashLookupSql('missing@test.example'));

    expect(() => parsePasswordHashLookup(rows, 'missing@test.example')).toThrow(
      'missing@test.example',
    );
  });

  test('保存の形式でないハッシュは失敗する', () => {
    expect(() =>
      parsePasswordHashLookup(
        [
          {
            id: 'x',
            password_hash: 'e2e-fixture-unusable',
            disposable_email_status: null,
            disposable_email_checked_at: null,
          },
        ],
        'a@test.example',
      ),
    ).toThrow('a@test.example');
  });

  test('列が想定の型でない行は失敗する', () => {
    const valid = {
      id: 'x',
      password_hash: PASSWORD_HASH,
      disposable_email_status: null,
      disposable_email_checked_at: null,
    };

    for (const row of [
      { ...valid, id: 1 },
      { ...valid, disposable_email_status: 1 },
      { ...valid, disposable_email_checked_at: 'x' },
    ]) {
      expect(() => parsePasswordHashLookup([row], 'a@test.example')).toThrow(
        'a@test.example',
      );
    }
  });
});

describe('bulkUsersInsertSqls・parseBulkUsersInsert', () => {
  const executeEach = (sqls: readonly string[]) => sqls.flatMap(executeAll);

  test('確認済み・規約の同意済みの利用者を同じパスワードのハッシュと使い捨てメールアドレスの判定で作る', () => {
    const seeds = seedsOf(3);

    const rows = executeEach(bulkUsersInsertSqls(seeds, TEMPLATE, AT));

    expect(rows.map((row) => row.id)).toEqual(seeds.map(({ id }) => id));
    const stored = queryRows(
      'SELECT id, email, password_hash, status, email_verified_at, terms_agreed_at, disposable_email_status, disposable_email_checked_at, created_at, updated_at, deleted_at, lifecycle_version FROM users ORDER BY id',
    );
    expect(stored).toHaveLength(3);
    for (const [position, row] of stored.entries()) {
      expect(row).toEqual({
        id: seeds[position]?.id,
        email: seeds[position]?.email,
        password_hash: PASSWORD_HASH,
        status: 'active',
        email_verified_at: AT.getTime(),
        terms_agreed_at: AT.getTime(),
        disposable_email_status: 'regular',
        disposable_email_checked_at: 1_794_000_000_000,
        created_at: AT.getTime(),
        updated_at: AT.getTime(),
        deleted_at: null,
        lifecycle_version: 0,
      });
    }
  });

  test('判定がNULLの1人目からはNULLのまま写す', () => {
    executeEach(
      bulkUsersInsertSqls(
        seedsOf(1),
        {
          passwordHash: PASSWORD_HASH,
          disposableEmailStatus: null,
          disposableEmailCheckedAt: null,
        },
        AT,
      ),
    );

    expect(
      queryRows(
        'SELECT disposable_email_status, disposable_email_checked_at FROM users',
      ),
    ).toEqual([
      { disposable_email_status: null, disposable_email_checked_at: null },
    ]);
  });

  test('最大の人数でも、1つのSQLの行数を分けて全員を作る', () => {
    const count = BULK_CLIENT_IP_POOL_SIZE - 1;
    const seeds = seedsOf(count);

    const sqls = bulkUsersInsertSqls(seeds, TEMPLATE, AT);

    expect(sqls).toHaveLength(Math.ceil(count / BULK_USERS_CHUNK_SIZE));
    for (const sql of sqls) {
      expect((sql.match(/'01JC0BULK/gu) ?? []).length).toBeLessThanOrEqual(
        BULK_USERS_CHUNK_SIZE,
      );
      expect(Buffer.byteLength(sql)).toBeLessThan(MAX_ARGUMENT_BYTES);
    }
    expect(executeEach(sqls)).toHaveLength(count);
  });

  test('作った行のIDが全員分そろえば成功し、足りなければ失敗する', () => {
    const seeds = seedsOf(2);
    const rows = executeEach(bulkUsersInsertSqls(seeds, TEMPLATE, AT));

    expect(() => {
      parseBulkUsersInsert(rows, seeds);
    }).not.toThrow();
    expect(() => {
      parseBulkUsersInsert(rows.slice(1), seeds);
    }).toThrow('1');
  });

  test('保存の形式でないハッシュは拒否する', () => {
    expect(() =>
      bulkUsersInsertSqls(
        seedsOf(1),
        { ...TEMPLATE, passwordHash: 'e2e-fixture-unusable' },
        AT,
      ),
    ).toThrow(TypeError);
  });

  test('利用者が1人もなければ拒否する', () => {
    expect(() => bulkUsersInsertSqls([], TEMPLATE, AT)).toThrow(RangeError);
  });

  test('同じメールアドレスを2回作ろうとすると失敗する', () => {
    const [seed] = seedsOf(1);
    if (seed === undefined) {
      throw new Error('seedsOfが空です');
    }
    executeEach(bulkUsersInsertSqls([seed], TEMPLATE, AT));

    expect(() =>
      executeEach(
        bulkUsersInsertSqls(
          [
            {
              ...seed,
              id: 'other',
              pseudonymousId: 'other',
              handle: 'other0000001',
            },
          ],
          TEMPLATE,
          AT,
        ),
      ),
    ).toThrow();
  });
});
