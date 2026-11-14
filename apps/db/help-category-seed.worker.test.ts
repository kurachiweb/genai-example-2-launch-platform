import { env } from 'cloudflare:workers';
import { asc, ne } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { helpArticles } from './schema/help/help-articles.ts';
import { helpCategories } from './schema/help/help-categories.ts';

interface TestMigration {
  readonly name: string;
  readonly queries: readonly string[];
}

const SEED_MIGRATION_SUFFIX = '_help_center_seed/migration.sql';

const OTHER_CATEGORY_ID = '01JC0000000000000000000001';

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
      'ヘルプ記事カテゴリの初期データのマイグレーションがありません',
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
  await db.delete(helpArticles);
  await db
    .delete(helpCategories)
    .where(ne(helpCategories.id, OTHER_CATEGORY_ID));
});

test('マイグレーションの適用後に、固定のIDと日時の標準カテゴリ「その他」が並び順1で1件だけある', async () => {
  expect(await db.select().from(helpCategories)).toEqual([
    {
      id: OTHER_CATEGORY_ID,
      name: 'その他',
      systemDefault: true,
      sortOrder: 1,
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
      .select({ id: helpCategories.id, name: helpCategories.name })
      .from(helpCategories)
      .orderBy(asc(helpCategories.sortOrder)),
  ).toEqual([{ id: OTHER_CATEGORY_ID, name: 'その他' }]);
});
