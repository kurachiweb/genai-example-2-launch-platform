import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';

interface TestMigration {
  readonly name: string;
  readonly queries: readonly string[];
}

const BACKFILL_MIGRATION_SUFFIX =
  '_identity_disposable_status_undetermined/migration.sql';

const T0 = new Date('2026-11-01T00:00:00.000Z');

const db = createDatabase(env.DB);

// TEST_MIGRATIONSはWorkers統合テストの設定だけが渡すバインディングで、実行時の環境の型には含めない
function backfillMigration(): TestMigration {
  const migrations = (
    env as unknown as { readonly TEST_MIGRATIONS: readonly TestMigration[] }
  ).TEST_MIGRATIONS;
  const found = migrations.find((migration) =>
    migration.name.endsWith(BACKFILL_MIGRATION_SUFFIX),
  );
  if (found === undefined) {
    throw new Error('使い捨て判定を揃えるマイグレーションがありません');
  }
  return found;
}

function userRowOf(
  index: number,
  columns: Partial<typeof users.$inferInsert>,
): typeof users.$inferInsert {
  return {
    id: `01JC0BACKFILL${String(index).padStart(13, '0')}`,
    pseudonymousId: `backfill-${String(index)}`,
    email: `backfill${String(index)}@mail.example`,
    passwordHash: 'pbkdf2-sha256$test',
    nickname: `利用者${String(index)}`,
    handle: `backfill${String(index)}`,
    termsAgreedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

beforeEach(async () => {
  await db.delete(users);
});

test('使い捨て判定の無い利用者を判定の日時を持たない「未判定」に揃え、判定のある利用者と更新日時を変えない', async () => {
  const checkedAt = new Date(T0.getTime() + 1000);
  await db.insert(users).values([
    userRowOf(1, {}),
    userRowOf(2, { emailVerifiedAt: T0 }),
    userRowOf(3, {
      emailVerifiedAt: T0,
      disposableEmailStatus: 'regular',
      disposableEmailCheckedAt: checkedAt,
    }),
    userRowOf(4, {
      emailVerifiedAt: T0,
      disposableEmailStatus: 'undetermined',
      disposableEmailCheckedAt: checkedAt,
    }),
  ]);

  for (const query of backfillMigration().queries) {
    await env.DB.prepare(query).run();
  }

  expect(
    await db
      .select({
        status: users.disposableEmailStatus,
        checkedAt: users.disposableEmailCheckedAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(asc(users.id)),
  ).toEqual([
    { status: 'undetermined', checkedAt: null, updatedAt: T0 },
    { status: 'undetermined', checkedAt: null, updatedAt: T0 },
    { status: 'regular', checkedAt, updatedAt: T0 },
    { status: 'undetermined', checkedAt, updatedAt: T0 },
  ]);
});
