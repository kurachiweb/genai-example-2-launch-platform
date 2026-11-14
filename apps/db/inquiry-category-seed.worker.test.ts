import { env } from 'cloudflare:workers';
import { asc, ne } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { inquiryCategories } from './schema/inquiry/inquiry-categories.ts';

interface TestMigration {
  readonly name: string;
  readonly queries: readonly string[];
}

const SEED_MIGRATION_SUFFIX = '_inquiry_chat_seed/migration.sql';

const OTHER_CATEGORY_ID = '01JC0000000000000000000000';

const SEEDED_AT = new Date(1730871820288);

const db = createDatabase(env.DB);

// TEST_MIGRATIONSはWorkers統合テストの設定だけが渡すバインディングで、実行時の環境の型には含めない
function seedMigration(): TestMigration {
  const migrations = (
    env as unknown as { readonly TEST_MIGRATIONS: readonly TestMigration[] }
  ).TEST_MIGRATIONS;
  const found = migrations.find((migration) =>
    migration.name.endsWith(SEED_MIGRATION_SUFFIX),
  );
  if (found === undefined) {
    throw new Error(
      '問い合わせカテゴリの初期データのマイグレーションがありません',
    );
  }
  return found;
}

async function runSeed(): Promise<void> {
  for (const query of seedMigration().queries) {
    await env.DB.prepare(query).run();
  }
}

// Drizzleは単独のクエリの失敗をDrizzleQueryErrorで包んでD1のエラーをcauseに持つため、原因をたどって文言を集める
async function rejectionMessagesOf(
  pending: Promise<unknown>,
): Promise<string[]> {
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
}

beforeEach(async () => {
  await db
    .delete(inquiryCategories)
    .where(ne(inquiryCategories.id, OTHER_CATEGORY_ID));
});

test('マイグレーションの適用後に、固定のIDと日時の標準カテゴリ「その他」が1件だけある', async () => {
  expect(await db.select().from(inquiryCategories)).toEqual([
    {
      id: OTHER_CATEGORY_ID,
      name: 'その他',
      systemDefault: true,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    },
  ]);
});

test('初期データのSQLを2回実行しても、失敗せず「その他」は1件だけのままになる', async () => {
  await runSeed();
  await runSeed();

  expect(
    await db
      .select({ id: inquiryCategories.id, name: inquiryCategories.name })
      .from(inquiryCategories),
  ).toEqual([{ id: OTHER_CATEGORY_ID, name: 'その他' }]);
});

test('大文字小文字だけが異なる名前のカテゴリは一意制約で追加できない', async () => {
  await db.insert(inquiryCategories).values({ name: 'Billing' });

  expect(
    await rejectionMessagesOf(
      db.insert(inquiryCategories).values({ name: 'BILLING' }),
    ),
  ).toContainEqual(
    expect.stringContaining(
      'UNIQUE constraint failed: inquiry_categories.name',
    ),
  );
  expect(
    await db
      .select({ name: inquiryCategories.name })
      .from(inquiryCategories)
      .orderBy(asc(inquiryCategories.createdAt)),
  ).toEqual([{ name: 'その他' }, { name: 'Billing' }]);
});

test('標準カテゴリの印は0・1以外の値を拒否する', async () => {
  expect(
    await rejectionMessagesOf(
      env.DB.prepare(
        "INSERT INTO inquiry_categories (id, name, system_default, created_at, updated_at) VALUES ('01JC0000000000000000000099', 'Invalid', 2, 0, 0)",
      ).run(),
    ),
  ).toContainEqual(
    expect.stringContaining(
      'CHECK constraint failed: inquiry_categories_system_default_check',
    ),
  );
});
