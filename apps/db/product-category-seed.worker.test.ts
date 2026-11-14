import { env } from 'cloudflare:workers';
import { beforeEach, expect, test } from 'vitest';
import { ne } from 'drizzle-orm';

import { createDatabase } from './client.ts';
import { productCategories } from './schema/product/product-categories.ts';

interface TestMigration {
  readonly name: string;
  readonly queries: readonly string[];
}

const SEED_MIGRATION_SUFFIX = '_product_launch_seed/migration.sql';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const SEEDED_AT = new Date(1731945562112);

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
      'プロダクトカテゴリの初期データのマイグレーションがありません',
    );
  }
  return found;
}

async function runSeed(): Promise<void> {
  for (const query of seedMigration().queries) {
    await env.DB.prepare(query).run();
  }
}

beforeEach(async () => {
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, OTHER_CATEGORY_ID));
});

test('マイグレーションの適用後に、固定のIDと日時の標準カテゴリ「その他」が1件だけある', async () => {
  expect(await db.select().from(productCategories)).toEqual([
    {
      id: OTHER_CATEGORY_ID,
      name: 'その他',
      handle: 'other',
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
      .select({ id: productCategories.id, name: productCategories.name })
      .from(productCategories),
  ).toEqual([{ id: OTHER_CATEGORY_ID, name: 'その他' }]);
});

test('標準カテゴリの印は0・1以外の値を拒否する', async () => {
  const reason: unknown = await env.DB.prepare(
    "INSERT INTO product_categories (id, name, handle, system_default, created_at, updated_at) VALUES ('01JD0000000000000000000099', 'Invalid', 'invalid', 2, 0, 0)",
  )
    .run()
    .then(
      () => undefined,
      (error: unknown) => error,
    );

  expect(reason).toBeInstanceOf(Error);
  expect((reason as Error).message).toContain(
    'CHECK constraint failed: product_categories_system_default_check',
  );
});
