import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildInvitationSql,
  buildLookupSql,
  sqlStringLiteral,
} from './invitation-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'db',
  'migrations',
);

const NOW = new Date(Date.UTC(2026, 10, 3, 9, 0, 0));
const EXPIRES_AT = new Date(Date.UTC(2026, 10, 4, 9, 0, 0));
const EARLIER = Date.UTC(2026, 10, 1, 9, 0, 0);
const EARLIER_EXPIRES_AT = Date.UTC(2026, 10, 2, 9, 0, 0);

const NEW_ADMIN_ID = '01JBNEWADMIN0000000000000A';
const INVITED_ADMIN_ID = '01JBINVITEDADMIN0000000000';
const ACTIVE_ADMIN_ID = '01JBACTIVEADMIN00000000000';
const NEW_TOKEN_ID = '01JBNEWTOKEN0000000000000A';
const NEW_TOKEN_HASH = 'new-invitation-token-hash';

interface AdminRow {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly invitation_expires_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface TokenRow {
  readonly id: string;
  readonly admin_id: string;
  readonly purpose: string;
  readonly token_hash: string;
  readonly expires_at: number;
  readonly new_email: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

function migratedDatabase(): Database {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
    .sort();
  for (const name of names) {
    sqlite.run(
      readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'),
    );
  }
  return sqlite;
}

function insertAdmin(
  sqlite: Database,
  admin: Pick<AdminRow, 'id' | 'email' | 'role' | 'status'>,
): void {
  sqlite
    .prepare(
      'INSERT INTO admins (id, email, role, status, invitation_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
      admin.status === 'invited' ? EARLIER_EXPIRES_AT : null,
      EARLIER,
      EARLIER,
    );
}

function insertToken(
  sqlite: Database,
  token: Pick<TokenRow, 'id' | 'admin_id' | 'purpose' | 'token_hash'>,
): void {
  sqlite
    .prepare(
      'INSERT INTO admin_auth_tokens (id, admin_id, purpose, token_hash, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      token.id,
      token.admin_id,
      token.purpose,
      token.token_hash,
      EARLIER_EXPIRES_AT,
      EARLIER,
      EARLIER,
    );
}

function adminRows(sqlite: Database): readonly AdminRow[] {
  return sqlite
    .query<AdminRow, []>(
      'SELECT id, email, role, status, invitation_expires_at, created_at, updated_at FROM admins ORDER BY id',
    )
    .all();
}

function tokenRows(sqlite: Database): readonly TokenRow[] {
  return sqlite
    .query<TokenRow, []>('SELECT * FROM admin_auth_tokens ORDER BY id')
    .all();
}

function unsetAdminColumns(sqlite: Database): Record<string, unknown> {
  return (
    sqlite
      .query<Record<string, unknown>, []>(
        'SELECT password_hash, nickname, title, avatar_file_id, activated_at FROM admins',
      )
      .get() ?? {}
  );
}

const invitation = (
  existingInvitedAdminId: string | undefined,
  email = 'owner@launch.example',
): Parameters<typeof buildInvitationSql>[0] => ({
  existingInvitedAdminId,
  newAdminId: NEW_ADMIN_ID,
  email,
  tokenId: NEW_TOKEN_ID,
  tokenHash: NEW_TOKEN_HASH,
  now: NOW,
  expiresAt: EXPIRES_AT,
});

describe('sqlStringLiteral', () => {
  test.each([
    ['通常の文字列', 'owner@launch.example', "'owner@launch.example'"],
    ['空の文字列', '', "''"],
    [
      '単一引用符を含む文字列',
      "o'neil@launch.example",
      "'o''neil@launch.example'",
    ],
    ['単一引用符だけの文字列', "''", "''''''"],
    ['日本語', '管理者', "'管理者'"],
  ])(
    '%sを単一引用符で囲み、単一引用符を二重にする',
    (_label, value, expected) => {
      expect(sqlStringLiteral(value)).toBe(expected);
    },
  );

  test.each(["x'); DROP TABLE admins; --", "' OR '1'='1", "\\'; SELECT 1; --"])(
    'SQLiteで評価すると元の値(%s)に戻る',
    (value) => {
      const sqlite = new Database(':memory:');

      const row = sqlite
        .query<{ value: string }, []>(
          `SELECT ${sqlStringLiteral(value)} AS value`,
        )
        .get();

      expect(row?.value).toBe(value);
    },
  );

  test.each([
    ['NUL', 'a\u0000b'],
    ['改行', 'a\nb'],
    ['復帰', 'a\rb'],
    ['タブ', 'a\tb'],
    ['DEL', 'a\u007Fb'],
    ['C1制御文字', 'a\u0085b'],
  ])('%sを含む値は拒否する', (_label, value) => {
    expect(() => sqlStringLiteral(value)).toThrow(
      'SQLの文字列のリテラルに制御文字は使えません。',
    );
  });
});

describe('buildLookupSql', () => {
  let sqlite: Database;

  beforeEach(() => {
    sqlite = migratedDatabase();
    insertAdmin(sqlite, {
      id: ACTIVE_ADMIN_ID,
      email: 'Owner@Launch.example',
      role: 'super_admin',
      status: 'active',
    });
  });

  test('メールアドレスの大文字小文字を区別せずに管理者のIDと状態を返す', () => {
    const rows = sqlite.query(buildLookupSql('owner@launch.example')).all();

    expect(rows).toEqual([{ id: ACTIVE_ADMIN_ID, status: 'active' }]);
  });

  test('該当する管理者がいなければ行を返さない', () => {
    const rows = sqlite.query(buildLookupSql('other@launch.example')).all();

    expect(rows).toEqual([]);
  });

  test('単一引用符を含むアドレスも1つの値として照合する', () => {
    const rows = sqlite.query(buildLookupSql("x' OR '1'='1")).all();

    expect(rows).toEqual([]);
  });
});

describe('buildInvitationSql', () => {
  let sqlite: Database;

  beforeEach(() => {
    sqlite = migratedDatabase();
  });

  describe('招待中の管理者がいない場合', () => {
    test('最上位管理者ロールの招待中の管理者と、招待のトークンのハッシュを挿入する', () => {
      sqlite.run(buildInvitationSql(invitation(undefined)));

      expect(adminRows(sqlite)).toEqual([
        {
          id: NEW_ADMIN_ID,
          email: 'owner@launch.example',
          role: 'super_admin',
          status: 'invited',
          invitation_expires_at: EXPIRES_AT.getTime(),
          created_at: NOW.getTime(),
          updated_at: NOW.getTime(),
        },
      ]);
      expect(unsetAdminColumns(sqlite)).toEqual({
        password_hash: null,
        nickname: null,
        title: null,
        avatar_file_id: null,
        activated_at: null,
      });
      expect(tokenRows(sqlite)).toEqual([
        {
          id: NEW_TOKEN_ID,
          admin_id: NEW_ADMIN_ID,
          purpose: 'invitation',
          token_hash: NEW_TOKEN_HASH,
          expires_at: EXPIRES_AT.getTime(),
          new_email: null,
          created_at: NOW.getTime(),
          updated_at: NOW.getTime(),
        },
      ]);
    });

    test('照会の後に同じアドレスの管理者が作られていれば、一意制約の違反で失敗し何も書き込まない', () => {
      insertAdmin(sqlite, {
        id: ACTIVE_ADMIN_ID,
        email: 'OWNER@launch.example',
        role: 'viewer',
        status: 'active',
      });

      expect(() =>
        sqlite.run(buildInvitationSql(invitation(undefined))),
      ).toThrow('UNIQUE constraint failed');
      expect(adminRows(sqlite).map((row) => row.id)).toEqual([ACTIVE_ADMIN_ID]);
      expect(tokenRows(sqlite)).toEqual([]);
    });

    test('単一引用符を含むアドレスもそのまま保存する', () => {
      sqlite.run(
        buildInvitationSql(invitation(undefined, "o'neil@launch.example")),
      );

      expect(adminRows(sqlite).map((row) => row.email)).toEqual([
        "o'neil@launch.example",
      ]);
    });
  });

  describe('招待中の管理者がいる場合', () => {
    beforeEach(() => {
      insertAdmin(sqlite, {
        id: INVITED_ADMIN_ID,
        email: 'Owner@Launch.example',
        role: 'viewer',
        status: 'invited',
      });
      insertToken(sqlite, {
        id: '01JBOLDTOKEN00000000000001',
        admin_id: INVITED_ADMIN_ID,
        purpose: 'invitation',
        token_hash: 'old-invitation-token-hash-1',
      });
      insertToken(sqlite, {
        id: '01JBOLDTOKEN00000000000002',
        admin_id: INVITED_ADMIN_ID,
        purpose: 'invitation',
        token_hash: 'old-invitation-token-hash-2',
      });
      insertToken(sqlite, {
        id: '01JBOLDTOKEN00000000000003',
        admin_id: INVITED_ADMIN_ID,
        purpose: 'password_reset',
        token_hash: 'other-purpose-token-hash',
      });
    });

    test('最上位管理者ロールにして招待の有効期限を改め、未使用の招待のトークンを消して新しいトークンを挿入する', () => {
      sqlite.run(buildInvitationSql(invitation(INVITED_ADMIN_ID)));

      expect(adminRows(sqlite)).toEqual([
        {
          id: INVITED_ADMIN_ID,
          email: 'Owner@Launch.example',
          role: 'super_admin',
          status: 'invited',
          invitation_expires_at: EXPIRES_AT.getTime(),
          created_at: EARLIER,
          updated_at: NOW.getTime(),
        },
      ]);
      expect(
        tokenRows(sqlite).map((row) => [
          row.id,
          row.admin_id,
          row.purpose,
          row.token_hash,
        ]),
      ).toEqual([
        [NEW_TOKEN_ID, INVITED_ADMIN_ID, 'invitation', NEW_TOKEN_HASH],
        [
          '01JBOLDTOKEN00000000000003',
          INVITED_ADMIN_ID,
          'password_reset',
          'other-purpose-token-hash',
        ],
      ]);
    });

    test('新しい管理者は挿入しない', () => {
      sqlite.run(buildInvitationSql(invitation(INVITED_ADMIN_ID)));

      expect(adminRows(sqlite).map((row) => row.id)).toEqual([
        INVITED_ADMIN_ID,
      ]);
    });
  });

  test('照会の後に有効になった管理者には、ロールを変えずトークンも挿入せずに失敗する', () => {
    insertAdmin(sqlite, {
      id: ACTIVE_ADMIN_ID,
      email: 'owner@launch.example',
      role: 'viewer',
      status: 'active',
    });

    expect(() =>
      sqlite.run(buildInvitationSql(invitation(ACTIVE_ADMIN_ID))),
    ).toThrow('NOT NULL constraint failed: admin_auth_tokens.admin_id');
    expect(adminRows(sqlite).map((row) => [row.role, row.updated_at])).toEqual([
      ['viewer', EARLIER],
    ]);
    expect(tokenRows(sqlite)).toEqual([]);
  });

  test.each([
    ['現在の日時', { now: new Date(Number.NaN) }],
    ['有効期限', { expiresAt: new Date(Number.NaN) }],
  ])('%sが無効な日時なら失敗する', (_label, override) => {
    expect(() =>
      buildInvitationSql({ ...invitation(undefined), ...override }),
    ).toThrow('日時が正しくありません。');
  });

  test('制御文字を含む値は拒否する', () => {
    expect(() =>
      buildInvitationSql(invitation(undefined, 'owner@launch.example\n')),
    ).toThrow('SQLの文字列のリテラルに制御文字は使えません。');
  });
});
