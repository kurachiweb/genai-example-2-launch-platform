import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createMigratedDatabase } from '../migrated-database.ts';
import type { EntityContext } from '../entities.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext } from '../sql-writer.ts';
import { commentPlansOf, commentsDataset } from './comments.ts';
import { matchesDataset } from './matches.ts';
import { productsDataset } from './products.ts';
import { usersDataset } from './users.ts';

const context: DatasetContext = { seed: 1, baseDate: '2026-11-24' };

const entities = (profile: EntityContext['profile']): EntityContext => ({
  seed: 1,
  baseDate: '2026-11-24',
  profile,
});

let db: Database;

beforeAll(() => {
  db = createMigratedDatabase();
  for (const dataset of [
    usersDataset,
    productsDataset,
    matchesDataset,
    commentsDataset,
  ]) {
    for (const statement of dataset.generate(SMOKE_PROFILE, context)) {
      db.run(statement.text);
    }
  }
});

afterAll(() => {
  db.close();
});

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

const repliesByRoot = (
  plans: Iterable<{ rootId: string; depth: number }>,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const plan of plans) {
    if (plan.depth > 1) {
      counts.set(plan.rootId, (counts.get(plan.rootId) ?? 0) + 1);
    }
  }
  return counts;
};

describe('commentsDataset', () => {
  test('予選のデータセットに依存し、名前はcommentsになる', () => {
    expect(commentsDataset.name).toBe('comments');
    expect(commentsDataset.dependsOn).toEqual(['users', 'products', 'matches']);
  });

  test('想定規模ではコメントを20万件作り、1つのスレッドだけが500件の返信を持つ', () => {
    const plans = [...commentPlansOf(entities(YEAR_ONE_PROFILE))];
    const replies = [...repliesByRoot(plans).values()].toSorted(
      (a, b) => b - a,
    );

    expect(plans).toHaveLength(200_000);
    expect(replies[0]).toBe(500);
    expect(replies[1]).toBeLessThanOrEqual(3);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(200_000);
  }, 120_000);

  test('想定規模の最大のスレッドは第2階層と第3階層の返信を持ち、返信は親より後に並ぶ', () => {
    const plans = [...commentPlansOf(entities(YEAR_ONE_PROFILE))];
    const [root] = plans;
    const thread = plans.filter((plan) => plan.rootId === root?.id);
    const seen = new Set<string>();

    expect(thread).toHaveLength(501);
    expect(thread.filter((plan) => plan.depth === 2).length).toBeGreaterThan(
      300,
    );
    expect(thread.filter((plan) => plan.depth === 3).length).toBeGreaterThan(
      100,
    );
    const violations = plans.filter((plan) => {
      const orphan = plan.parentId !== null && !seen.has(plan.parentId);
      seen.add(plan.id);
      return orphan || plan.depth < 1 || plan.depth > 3;
    });
    expect(violations).toEqual([]);
  }, 120_000);

  test('検証用の規模では200件のコメントを作り、最大のスレッドの返信は1件で他は返信を持たない', () => {
    expect(scalar('SELECT count(*) FROM launch_comments')).toBe(200);
    expect(
      db
        .query<{ replies: number }, []>(
          'SELECT count(*) AS replies FROM launch_comments WHERE depth > 1 GROUP BY root_id ORDER BY replies DESC',
        )
        .all(),
    ).toEqual([{ replies: 1 }]);
  });

  test('外部キーの違反が無く、同じ種と基準日なら同じ文を出す', () => {
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    const texts = (): string[] =>
      [...commentsDataset.generate(SMOKE_PROFILE, context)].map(
        (statement) => statement.text,
      );

    expect(texts()).toEqual(texts());
  });

  test('階層は1〜3で、トップレベルは自身をrootにし、返信は親の階層+1で親と同じローンチ・rootを持つ', () => {
    expect(
      scalar(
        'SELECT count(*) FROM launch_comments WHERE parent_id IS NULL AND (root_id <> id OR depth <> 1)',
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM launch_comments c JOIN launch_comments p ON p.id = c.parent_id
          WHERE c.depth <> p.depth + 1 OR c.launch_id <> p.launch_id OR c.root_id <> p.root_id OR c.product_id <> p.product_id OR c.created_at <= p.created_at`,
      ),
    ).toBe(0);
  });

  test('コメントは勝った予選のローンチに、キックオフ後の日時で付き、表示できる状態である', () => {
    expect(
      scalar(
        `SELECT count(*) FROM launch_comments c
           JOIN product_launches l ON l.id = c.launch_id
           JOIN match_entries e ON e.launch_id = l.id
           JOIN matches m ON m.id = e.match_id
          WHERE l.outcome = 'won' AND l.product_id = c.product_id AND c.created_at >= m.starts_at`,
      ),
    ).toBe(200);
    expect(
      scalar(
        'SELECT count(*) FROM launch_comments WHERE author_user_id IS NULL OR hidden_at IS NOT NULL OR anonymized_at IS NOT NULL OR deleted_at IS NOT NULL OR edited_at IS NOT NULL',
      ),
    ).toBe(0);
  });

  test('投稿者は作成より前に存在する利用者で、本文は空でなく上限(2,000文字)に収まる', () => {
    expect(
      scalar(
        'SELECT count(*) FROM launch_comments c JOIN users u ON u.id = c.author_user_id WHERE u.created_at >= c.created_at',
      ),
    ).toBe(0);
    expect(
      scalar(
        "SELECT count(*) FROM launch_comments WHERE body = '' OR length(body) > 2000",
      ),
    ).toBe(0);
  });

  test('見本として最大のスレッドを持つプロダクトのハンドルを返し、そのスレッドが実在する', () => {
    const samples = commentsDataset.samples?.(SMOKE_PROFILE, context);

    expect(samples?.largestThreadProductHandle).toEqual(['synthetic-p-000001']);
    expect(
      scalar(
        "SELECT count(*) FROM launch_comments c JOIN products p ON p.id = c.product_id WHERE p.handle = 'synthetic-p-000001' AND c.depth = 2",
      ),
    ).toBe(1);
  });
});
