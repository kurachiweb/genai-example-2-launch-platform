import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase, type Database } from '../../../db/client.ts';
import { adminAuthTokens } from '../../../db/schema/admin/admin-auth-tokens.ts';
import { adminLoginChallenges } from '../../../db/schema/admin/admin-login-challenges.ts';
import { adminRecoveryCodes } from '../../../db/schema/admin/admin-recovery-codes.ts';
import { adminSessions } from '../../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../../db/schema/admin/admin-totp-credentials.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import type {
  AdminDirectory,
  AdminProfileView,
} from '../../core/admin/ports.ts';
import { D1AdminDirectory } from './d1-admin-directory.ts';

const MAX_BOUND_PARAMETERS = 100;

// 管理者の1行が12個前後のバインド変数を使うため、上限に収まる行数ずつ追加する
const ROWS_PER_INSERT = 5;

const T0 = new Date('2026-11-01T00:00:00.000Z');

const db = createDatabase(env.DB);

type AdminRow = typeof admins.$inferInsert;

const PROFILE_FIELDS = [
  'id',
  'nickname',
  'title',
  'avatarFileId',
] as const satisfies readonly (keyof AdminProfileView)[];

function adminIdOf(index: number): string {
  return `01JC0ADMN${String(index).padStart(17, '0')}`;
}

function rowOf(index: number, columns: Partial<AdminRow> = {}): AdminRow {
  return {
    id: adminIdOf(index),
    email: `admin${String(index)}@mail.example`,
    passwordHash: 'pbkdf2-sha256$test',
    nickname: `管理者${String(index)}`,
    role: 'viewer',
    status: 'active',
    activatedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

async function insertAdmins(
  indexes: readonly number[],
  columns: Partial<AdminRow> = {},
): Promise<void> {
  for (let start = 0; start < indexes.length; start += ROWS_PER_INSERT) {
    await db
      .insert(admins)
      .values(
        indexes
          .slice(start, start + ROWS_PER_INSERT)
          .map((index) => rowOf(index, columns)),
      );
  }
}

// 招待中の管理者は招待の完了までニックネームを持たない
async function insertInvitedAdmin(index: number): Promise<void> {
  await insertAdmins([index], {
    status: 'invited',
    passwordHash: null,
    nickname: null,
    activatedAt: null,
    invitationExpiresAt: new Date(T0.getTime() + 72 * 60 * 60 * 1000),
  });
}

async function clearAdmins(): Promise<void> {
  await db.delete(adminRecoveryCodes);
  await db.delete(adminTotpCredentials);
  await db.delete(adminLoginChallenges);
  await db.delete(adminAuthTokens);
  await db.delete(adminSessions);
  await db.delete(admins);
}

// prepareだけを差し替え、他の操作はテスト用のD1へそのまま渡す
function withPrepare(
  prepare: (query: string) => D1PreparedStatement,
): D1Database {
  const d1 = env.DB;
  return {
    prepare,
    batch: d1.batch.bind(d1),
    exec: d1.exec.bind(d1),
    withSession: d1.withSession.bind(d1),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: d1.dump.bind(d1),
  };
}

// 問い合わせの有無と分割の仕方を確かめるため、D1へ渡した各文のプレースホルダーの数を記録する
function createRecordingDatabase(): {
  readonly database: Database;
  readonly placeholderCounts: readonly number[];
} {
  const placeholderCounts: number[] = [];
  const database = createDatabase(
    withPrepare((query) => {
      placeholderCounts.push(query.match(/\?/gu)?.length ?? 0);
      return env.DB.prepare(query);
    }),
  );
  return { database, placeholderCounts };
}

function createDirectory(database: Database = db): AdminDirectory {
  return new D1AdminDirectory(database);
}

beforeEach(async () => {
  await clearAdmins();
});

describe('D1AdminDirectory.findProfiles', () => {
  test('有効な管理者のID・ニックネーム・肩書き・プロフィール画像の参照だけを返す', async () => {
    await insertAdmins([1], {
      role: 'super_admin',
      title: 'サポート担当',
      avatarFileId: '01JC0FILE00000000000000001',
    });
    await insertAdmins([2]);

    const found = await createDirectory().findProfiles([
      adminIdOf(1),
      adminIdOf(2),
    ]);

    expect(found).toEqual(
      new Map<string, AdminProfileView>([
        [
          adminIdOf(1),
          {
            id: adminIdOf(1),
            nickname: '管理者1',
            title: 'サポート担当',
            avatarFileId: '01JC0FILE00000000000000001',
          },
        ],
        [
          adminIdOf(2),
          {
            id: adminIdOf(2),
            nickname: '管理者2',
            title: null,
            avatarFileId: null,
          },
        ],
      ]),
    );
    expect(Object.keys(found.get(adminIdOf(1)) ?? {}).toSorted()).toEqual(
      [...PROFILE_FIELDS].toSorted(),
    );
  });

  test('削除済み・招待中・存在しないIDを含めず、存在しないと判別できる', async () => {
    await insertAdmins([1, 2]);
    await insertInvitedAdmin(3);
    await db.delete(admins).where(eq(admins.id, adminIdOf(2)));

    const found = await createDirectory().findProfiles([
      adminIdOf(1),
      adminIdOf(2),
      adminIdOf(3),
      adminIdOf(4),
    ]);

    expect([...found.keys()]).toEqual([adminIdOf(1)]);
    expect(found.has(adminIdOf(2))).toBe(false);
    expect(found.has(adminIdOf(3))).toBe(false);
    expect(found.has(adminIdOf(4))).toBe(false);
  });

  test('招待中の管理者が仮の保存でニックネームを持っていても含めない', async () => {
    await insertInvitedAdmin(1);
    await db
      .update(admins)
      .set({ nickname: '仮の管理者', passwordHash: 'pbkdf2-sha256$test' })
      .where(eq(admins.id, adminIdOf(1)));

    const found = await createDirectory().findProfiles([adminIdOf(1)]);

    expect(found.size).toBe(0);
  });

  test('有効でもニックネームの無い不整合な行は表示できないため含めない', async () => {
    await insertAdmins([1], { nickname: null });

    const found = await createDirectory().findProfiles([adminIdOf(1)]);

    expect(found.size).toBe(0);
  });

  test('重複したIDは1件として問い合わせる', async () => {
    await insertAdmins([1, 2]);
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createDirectory(database).findProfiles([
      adminIdOf(1),
      adminIdOf(2),
      adminIdOf(1),
    ]);

    expect([...found.keys()].toSorted()).toEqual([adminIdOf(1), adminIdOf(2)]);
    expect(placeholderCounts).toEqual([2]);
  });

  test('空の一覧ではD1へ問い合わせずに空の結果を返す', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createDirectory(database).findProfiles([]);

    expect(found.size).toBe(0);
    expect(placeholderCounts).toEqual([]);
  });

  test('100件までは1回の問い合わせで、バインド変数の上限に収めて読む', async () => {
    await insertAdmins(range(1, 100));
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createDirectory(database).findProfiles(
      range(1, 100).map(adminIdOf),
    );

    expect(found.size).toBe(100);
    expect(placeholderCounts).toEqual([MAX_BOUND_PARAMETERS]);
  });

  test('101件のIDは2回の照会に分け、結果を統合する', async () => {
    await insertAdmins(range(1, 101));
    const { database, placeholderCounts } = createRecordingDatabase();

    const found = await createDirectory(database).findProfiles(
      range(1, 101).map(adminIdOf),
    );

    expect(found.size).toBe(101);
    expect(found.get(adminIdOf(101))?.nickname).toBe('管理者101');
    expect(placeholderCounts).toEqual([MAX_BOUND_PARAMETERS, 1]);
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    const failing = createDatabase(
      withPrepare(() =>
        env.DB.prepare('SELECT * FROM table_that_does_not_exist'),
      ),
    );

    await expect(
      createDirectory(failing).findProfiles([adminIdOf(1)]),
    ).rejects.toThrow();
  });
});
