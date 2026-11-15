import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import {
  parseSenderInfoSnapshot,
  parseUnsubscribeLinkInsert,
  parseUserId,
  SENDER_INFO_SNAPSHOT_SQL,
  senderInfoRestoreSql,
  type SenderInfoSnapshot,
  type UnsubscribeLinkWrite,
  unsubscribeLinkInsertSql,
  userIdByEmailSql,
} from './notification-fixture-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'db',
  'migrations',
);

const USER_ID = '01JC0RCPT00000000000000001';

const OTHER_USER_ID = '01JC0RCPT00000000000000002';

const USER_EMAIL = "e2e-o'user@test.example";

const AT = new Date('2026-11-15T09:00:00.000Z');

const WRITE: UnsubscribeLinkWrite = {
  userId: USER_ID,
  topic: 'match_result',
  preferenceId: '01JC0PREF00000000000000001',
  tokenRowId: '01JC0TOKEN0000000000000001',
  seed: 'seed-value',
  tokenHash: 'lookup-hash',
  at: AT,
};

const SEED_SNAPSHOT: SenderInfoSnapshot = {
  businessName: null,
  contactEmail: null,
  postalAddress: null,
  version: 0,
  updatedByAdminId: null,
  updatedAt: 1794614400000,
};

let db: Database;

const insertUser = (id: string, email: string, deletedAt: number | null) => {
  db.run(
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, deleted_at, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, 1, 1, ?, 1, 1)`,
    [id, `p-${id}`, email, id, id.toLowerCase(), deletedAt],
  );
};

const queryRows = (sql: string): Record<string, unknown>[] =>
  db.query<Record<string, unknown>, []>(sql).all();

// wrangler d1 executeと同じく、複数の文の結果の行を文の順につなげて返す
const executeAll = (sql: string): Record<string, unknown>[] =>
  sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .flatMap((statement) => queryRows(statement));

const preferenceRowsOf = (userId: string): Record<string, unknown>[] =>
  queryRows(
    `SELECT topic, enabled, updated_at FROM notification_preferences WHERE user_id = '${userId}' ORDER BY topic`,
  );

beforeEach(async () => {
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of await readNestedD1Migrations(MIGRATIONS_DIR)) {
    for (const query of migration.queries) {
      db.run(query);
    }
  }
  insertUser(USER_ID, USER_EMAIL, null);
});

afterEach(() => {
  db.close();
});

describe('userIdByEmailSql・parseUserId', () => {
  test('退会していない利用者のIDをメールアドレスの大文字小文字を区別せずに引く', () => {
    insertUser(OTHER_USER_ID, USER_EMAIL.toUpperCase(), 1);

    const rows = queryRows(userIdByEmailSql(USER_EMAIL.toUpperCase()));

    expect(parseUserId(rows, USER_EMAIL)).toBe(USER_ID);
  });

  test('利用者が見つからなければメールアドレスを示して失敗する', () => {
    const rows = queryRows(userIdByEmailSql('missing@test.example'));

    expect(() => parseUserId(rows, 'missing@test.example')).toThrow(
      'missing@test.example',
    );
  });

  test('IDが文字列でない行は失敗する', () => {
    expect(() => parseUserId([{ id: 1 }], USER_EMAIL)).toThrow(USER_EMAIL);
  });
});

describe('unsubscribeLinkInsertSql・parseUnsubscribeLinkInsert', () => {
  test('受信する設定の行と種の行を作り、作った種の行のIDを返す', () => {
    const rows = executeAll(unsubscribeLinkInsertSql(WRITE));

    expect(() => {
      parseUnsubscribeLinkInsert(rows, WRITE);
    }).not.toThrow();
    expect(preferenceRowsOf(USER_ID)).toEqual([
      { topic: 'match_result', enabled: 1, updated_at: AT.getTime() },
    ]);
    expect(
      queryRows(
        'SELECT id, user_id, topic, seed, token_hash, created_at, updated_at FROM notification_unsubscribe_tokens',
      ),
    ).toEqual([
      {
        id: WRITE.tokenRowId,
        user_id: USER_ID,
        topic: 'match_result',
        seed: 'seed-value',
        token_hash: 'lookup-hash',
        created_at: AT.getTime(),
        updated_at: AT.getTime(),
      },
    ]);
  });

  test('受信しない設定の行が既にあれば受信する設定へ変え、他の種別の行は変えない', () => {
    db.run(
      `INSERT INTO notification_preferences (id, user_id, topic, enabled, created_at, updated_at) VALUES ('01JC0PREF00000000000000009', ?, 'match_result', 0, 1, 1), ('01JC0PREF00000000000000008', ?, 'match_preview', 0, 1, 1)`,
      [USER_ID, USER_ID],
    );

    parseUnsubscribeLinkInsert(
      executeAll(unsubscribeLinkInsertSql(WRITE)),
      WRITE,
    );

    expect(preferenceRowsOf(USER_ID)).toEqual([
      { topic: 'match_preview', enabled: 0, updated_at: 1 },
      { topic: 'match_result', enabled: 1, updated_at: AT.getTime() },
    ]);
  });

  test('同じ組の種の行が既にあれば挿入に失敗する', () => {
    executeAll(unsubscribeLinkInsertSql(WRITE));

    expect(() =>
      executeAll(
        unsubscribeLinkInsertSql({
          ...WRITE,
          tokenRowId: '01JC0TOKEN0000000000000002',
          tokenHash: 'other-hash',
        }),
      ),
    ).toThrow();
  });

  test('作った種の行が返らなければ失敗する', () => {
    expect(() => {
      parseUnsubscribeLinkInsert([], WRITE);
    }).toThrow(WRITE.topic);
    expect(() => {
      parseUnsubscribeLinkInsert([{ id: 'other' }], WRITE);
    }).toThrow(WRITE.topic);
  });

  test('引用符を含む値も文字列のリテラルとして埋め込む', () => {
    const write = { ...WRITE, seed: "se'ed" };

    executeAll(unsubscribeLinkInsertSql(write));

    expect(
      queryRows('SELECT seed FROM notification_unsubscribe_tokens'),
    ).toEqual([{ seed: "se'ed" }]);
  });
});

describe('SENDER_INFO_SNAPSHOT_SQL・parseSenderInfoSnapshot・senderInfoRestoreSql', () => {
  test('初期データの送信者情報の行を読む', () => {
    expect(
      parseSenderInfoSnapshot(queryRows(SENDER_INFO_SNAPSHOT_SQL)),
    ).toEqual(SEED_SNAPSHOT);
  });

  test('保存した後に読んだ値へ、版・変更した管理者・更新日時を含めて戻す', () => {
    const snapshot = parseSenderInfoSnapshot(
      queryRows(SENDER_INFO_SNAPSHOT_SQL),
    );
    db.run(
      `UPDATE notification_sender_settings SET business_name = 'E2E', contact_email = 'a@test.example', postal_address = '住所', version = 1, updated_by_admin_id = 'admin', updated_at = 2`,
    );

    const restored = executeAll(senderInfoRestoreSql(snapshot));

    expect(restored).toHaveLength(1);
    expect(
      parseSenderInfoSnapshot(queryRows(SENDER_INFO_SNAPSHOT_SQL)),
    ).toEqual(SEED_SNAPSHOT);
  });

  test('設定済みの値も引用符を含めてそのまま戻す', () => {
    const configured: SenderInfoSnapshot = {
      businessName: "O'Brien商店",
      contactEmail: 'contact@test.example',
      postalAddress: '東京都',
      version: 3,
      updatedByAdminId: '01JC0ADMIN0000000000000001',
      updatedAt: 1794614500000,
    };

    executeAll(senderInfoRestoreSql(configured));

    expect(
      parseSenderInfoSnapshot(queryRows(SENDER_INFO_SNAPSHOT_SQL)),
    ).toEqual(configured);
  });

  test('送信者情報の行が無ければマイグレーションの適用を促して失敗する', () => {
    expect(() => parseSenderInfoSnapshot([])).toThrow('db:migrate:local');
  });

  test.each([
    ['版が整数でない', { ...SEED_SNAPSHOT, version: '0' }],
    ['更新日時が整数でない', { ...SEED_SNAPSHOT, updatedAt: null }],
    ['事業者名が文字列でもNULLでもない', { ...SEED_SNAPSHOT, businessName: 1 }],
  ])('%s行は失敗する', (_name, snapshot) => {
    const row = {
      business_name: snapshot.businessName,
      contact_email: snapshot.contactEmail,
      postal_address: snapshot.postalAddress,
      version: snapshot.version,
      updated_by_admin_id: snapshot.updatedByAdminId,
      updated_at: snapshot.updatedAt,
    };

    expect(() => parseSenderInfoSnapshot([row])).toThrow();
  });
});
