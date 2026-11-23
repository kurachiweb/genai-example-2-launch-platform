import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createMigratedDatabase } from '../migrated-database.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext, SqlStatement } from '../sql-writer.ts';
import { productsDataset } from './products.ts';
import { usersDataset } from './users.ts';

const context: DatasetContext = { seed: 1, baseDate: '2026-11-24' };

const smokeStatements = (): SqlStatement[] => [
  ...productsDataset.generate(SMOKE_PROFILE, context),
];

let db: Database;

beforeEach(() => {
  db = createMigratedDatabase();
});

afterEach(() => {
  db.close();
});

const applyAll = (statements: Iterable<SqlStatement>): void => {
  for (const statement of statements) {
    db.run(statement.text);
  }
};

const applySmoke = (): void => {
  applyAll(usersDataset.generate(SMOKE_PROFILE, context));
  applyAll(smokeStatements());
};

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

describe('productsDataset', () => {
  test('利用者のデータセットに依存する', () => {
    expect(productsDataset.name).toBe('products');
    expect(productsDataset.dependsOn).toEqual(['users']);
  });

  test('想定規模の件数のプロダクトとローンチと、合成のカテゴリを作る', () => {
    const counts: Record<string, number> = {};
    for (const statement of productsDataset.generate(
      YEAR_ONE_PROFILE,
      context,
    )) {
      counts[statement.table] =
        (counts[statement.table] ?? 0) + statement.insertedRows;
    }

    expect(counts).toEqual({
      product_categories: 10,
      products: 20_000,
      product_launches: 20_000,
    });
  });

  test('外部キーの順に、カテゴリ・プロダクト・ローンチの順で文を並べる', () => {
    const order = [
      ...new Set(smokeStatements().map((statement) => statement.table)),
    ];

    expect(order).toEqual([
      'product_categories',
      'products',
      'product_launches',
    ]);
  });

  test('利用者を作らずに適用すると外部キーの違反になり、利用者の後なら誤り無く適用できる', () => {
    expect(() => {
      applyAll(smokeStatements());
    }).toThrow(/FOREIGN KEY/u);

    db.close();
    db = createMigratedDatabase();
    applySmoke();

    expect(scalar('SELECT count(*) FROM products')).toBe(20);
    expect(scalar('SELECT count(*) FROM product_launches')).toBe(20);
    expect(scalar('SELECT count(*) FROM product_categories')).toBe(11);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('全てのプロダクトは未確定のローンチを1件持ち、最新のローンチ日と一致する', () => {
    applySmoke();

    expect(
      scalar(
        'SELECT count(*) FROM products p JOIN product_launches l ON l.product_id = p.id WHERE l.outcome IS NULL AND l.cancelled_at IS NULL AND l.launch_date = p.latest_launch_date',
      ),
    ).toBe(20);
  });

  test('フォロワーの最も多い作り手のプロダクトのローンチは、基準日の翌業務日に1件だけある', () => {
    applySmoke();

    expect(
      scalar(
        "SELECT p.handle FROM product_launches l JOIN products p ON p.id = l.product_id WHERE l.launch_date = '2026-11-25'",
      ),
    ).toBe('synthetic-p-000001');
    expect(
      scalar(
        "SELECT count(*) FROM product_launches WHERE launch_date = '2026-11-25'",
      ),
    ).toBe(1);
    expect(
      scalar(
        "SELECT count(*) FROM products p JOIN users u ON u.id = p.user_id WHERE p.handle = 'synthetic-p-000001' AND u.handle = 'synthetic-u-000001'",
      ),
    ).toBe(1);
  });

  test('他のローンチは基準日の翌日より後で、90日先までの間にある', () => {
    applySmoke();

    expect(
      scalar(
        "SELECT count(*) FROM product_launches WHERE launch_date <> '2026-11-25' AND (launch_date < '2026-11-26' OR launch_date > '2027-02-22')",
      ),
    ).toBe(0);
  });

  test('URLは.exampleのドメインだけで、プロダクトは表示できる状態(非表示・削除なし)にする', () => {
    applySmoke();

    expect(
      scalar(
        "SELECT count(*) FROM products WHERE website_url NOT LIKE 'https://synthetic-%.example'",
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM products WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL',
      ),
    ).toBe(0);
  });

  test('全てのカテゴリに割り当てるプロダクトがある(その他を含む)', () => {
    applySmoke();

    expect(scalar('SELECT count(DISTINCT category_id) FROM products')).toBe(11);
  });

  test('説明文は上限(20,000文字)に収まる', () => {
    applySmoke();

    expect(
      scalar('SELECT max(length(description_markdown)) FROM products'),
    ).toBeLessThanOrEqual(20_000);
  });

  test('ロゴのファイルのIDの指定を全てのプロダクトへ使う', () => {
    applyAll(usersDataset.generate(SMOKE_PROFILE, context));
    applyAll(
      productsDataset.generate(SMOKE_PROFILE, {
        ...context,
        logoFileId: 'shared-logo',
      }),
    );

    expect(
      scalar(
        "SELECT count(*) FROM products WHERE logo_file_id = 'shared-logo'",
      ),
    ).toBe(20);
  });

  test('同じ種と基準日なら同じ文を出す', () => {
    const texts = (): string[] =>
      smokeStatements().map((statement) => statement.text);

    expect(texts()).toEqual(texts());
  });

  test('見本としてプロダクトのハンドルと、作り手のプロダクトのハンドルを返す', () => {
    const samples = productsDataset.samples?.(SMOKE_PROFILE, context);

    expect(samples?.largestCreatorProductHandle).toEqual([
      'synthetic-p-000001',
    ]);
    expect(samples?.productHandles).toEqual([
      'synthetic-p-000001',
      'synthetic-p-000002',
      'synthetic-p-000003',
      'synthetic-p-000004',
      'synthetic-p-000005',
    ]);
  });
});
