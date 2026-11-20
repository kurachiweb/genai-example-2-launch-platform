import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../apps/common-lib/product/product-category-constants.ts';
import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import {
  type EngagementTargetsPlan,
  engagementTargetsInsertSql,
  type ModerationProduct,
  moderationProductSql,
  moderationTargetsStateSql,
  parseEngagementTargetsInsert,
  parseModerationProduct,
  parseModerationTargetsState,
  planEngagementTargets,
} from './moderation-fixture-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'db',
  'migrations',
);

const NOW = new Date('2026-11-20T03:00:00.000Z');

const OWNER_ID = 'U1';

const PRODUCT_ID = 'P1';

const LAUNCH_ID = 'L1';

const HANDLE = 'e2e-mod-product';

const OWNER_HANDLE = 'e2e-mod-owner';

const OWNER_EMAIL = 'e2e-mod-owner@test.example';

const SUFFIX = 'a1b2c3d4';

// 登録の時に作る仮名化IDと同じ、小文字のバージョン4のUUID
const PSEUDONYMOUS_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const PRODUCT: ModerationProduct = {
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  ownerUserId: OWNER_ID,
  ownerHandle: OWNER_HANDLE,
  ownerEmail: OWNER_EMAIL,
  ownerPseudonymousId: `p-${OWNER_ID}`,
  ownerNickname: OWNER_ID,
  launchDate: '2026-11-19',
};

let db: Database;

let idCount = 0;

const nextId = (): string => {
  idCount += 1;
  return `ID${String(idCount).padStart(4, '0')}`;
};

const queryRows = (sql: string): LocalD1Row[] =>
  db.query<Record<string, unknown>, []>(sql).all();

// 複数の文を順に実行し、RETURNINGの行を文の順につなげて返す(ローカルのD1の実行結果と同じ形)
const executeAll = (sql: string): LocalD1Row[] =>
  sql
    .split('\n')
    .flatMap((statement) =>
      db.query<Record<string, unknown>, []>(statement).all(),
    );

const insertUser = (
  id: string,
  handle: string,
  columns: {
    readonly emailVerifiedAt?: number | null;
    readonly status?: string;
  } = {},
): void => {
  db.run(
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, status, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, ?, ?, 1, 1, 1)`,
    [
      id,
      `p-${id}`,
      `${handle}@test.example`,
      id,
      handle,
      columns.status ?? 'active',
      columns.emailVerifiedAt === undefined ? 1 : columns.emailVerifiedAt,
    ],
  );
};

const insertProduct = (
  id: string,
  ownerId: string,
  handle: string,
  columns: { readonly deletedAt?: number; readonly hiddenAt?: number } = {},
): void => {
  db.run(
    `INSERT INTO products (id, user_id, category_id, handle, name, tagline, website_url, description_markdown, logo_file_id, latest_launch_date, created_at, updated_at, deleted_at, hidden_at) VALUES (?, ?, ?, ?, ?, 'タグライン', 'https://moderation.example', '説明', 'LOGO', '2026-11-19', 1, 1, ?, ?)`,
    [
      id,
      ownerId,
      PRODUCT_CATEGORY_OTHER_ID,
      handle,
      `名称${id}`,
      columns.deletedAt ?? null,
      columns.hiddenAt ?? null,
    ],
  );
};

const insertLaunch = (
  id: string,
  productId: string,
  columns: {
    readonly outcome?: string | null;
    readonly cancelledAt?: number;
  } = {},
): void => {
  const outcome = columns.outcome === undefined ? 'won' : columns.outcome;
  db.run(
    `INSERT INTO product_launches (id, product_id, launch_date, outcome, decided_at, cancelled_at, created_at, updated_at) VALUES (?, ?, '2026-11-19', ?, ?, ?, 1, 1)`,
    [
      id,
      productId,
      outcome,
      outcome === null ? null : 1,
      columns.cancelledAt ?? null,
    ],
  );
};

const planOf = (
  overrides: Partial<Parameters<typeof planEngagementTargets>[0]> = {},
): EngagementTargetsPlan =>
  planEngagementTargets({
    product: PRODUCT,
    ratingScores: [5, 1],
    suffix: SUFFIX,
    now: NOW,
    nextId,
    ...overrides,
  });

const MASKED_PSEUDONYMOUS_ID = '<仮名化ID>';

const withMaskedPseudonymousIds = (
  plan: EngagementTargetsPlan,
): EngagementTargetsPlan => ({
  ...plan,
  comment: {
    ...plan.comment,
    author: { ...plan.comment.author, pseudonymousId: MASKED_PSEUDONYMOUS_ID },
  },
  ratings: plan.ratings.map((rating) => ({
    ...rating,
    rater: { ...rating.rater, pseudonymousId: MASKED_PSEUDONYMOUS_ID },
  })),
});

beforeEach(async () => {
  idCount = 0;
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of await readNestedD1Migrations(MIGRATIONS_DIR)) {
    for (const query of migration.queries) {
      db.run(query);
    }
  }
  insertUser(OWNER_ID, OWNER_HANDLE);
  insertProduct(PRODUCT_ID, OWNER_ID, HANDLE);
  insertLaunch(LAUNCH_ID, PRODUCT_ID);
});

afterEach(() => {
  db.close();
});

describe('moderationProductSql・parseModerationProduct', () => {
  test('ハンドルから掲載中のプロダクト・勝ちのローンチとその日付・確認済みの投稿者とその仮名化IDとニックネームを読む', () => {
    insertLaunch('L0', PRODUCT_ID, { outcome: 'lost' });
    insertLaunch('L2', PRODUCT_ID, { outcome: null });

    expect(
      parseModerationProduct(queryRows(moderationProductSql(HANDLE)), HANDLE),
    ).toEqual(PRODUCT);
  });

  test('ハンドルの大文字と小文字を区別しない', () => {
    const handle = HANDLE.toUpperCase();

    expect(
      parseModerationProduct(queryRows(moderationProductSql(handle)), handle),
    ).toEqual(PRODUCT);
  });

  test('削除・非公開のプロダクト、勝ちのローンチの無いプロダクト、未確認・停止中の投稿者のプロダクトは見つからない', () => {
    insertProduct('P2', OWNER_ID, 'e2e-deleted', { deletedAt: 1 });
    insertLaunch('L2', 'P2');
    insertProduct('P3', OWNER_ID, 'e2e-hidden', { hiddenAt: 1 });
    insertLaunch('L3', 'P3');
    insertProduct('P4', OWNER_ID, 'e2e-cancelled');
    insertLaunch('L4', 'P4', { cancelledAt: 1 });
    insertProduct('P5', OWNER_ID, 'e2e-undecided');
    insertLaunch('L5', 'P5', { outcome: null });
    insertUser('U6', 'e2e-unverified', { emailVerifiedAt: null });
    insertProduct('P6', 'U6', 'e2e-unverified-owner');
    insertLaunch('L6', 'P6');
    insertUser('U7', 'e2e-suspended', { status: 'suspended' });
    insertProduct('P7', 'U7', 'e2e-suspended-owner');
    insertLaunch('L7', 'P7');

    for (const handle of [
      'e2e-deleted',
      'e2e-hidden',
      'e2e-cancelled',
      'e2e-undecided',
      'e2e-unverified-owner',
      'e2e-suspended-owner',
      'e2e-missing',
    ]) {
      expect(() =>
        parseModerationProduct(queryRows(moderationProductSql(handle)), handle),
      ).toThrow(
        `プロダクト(${handle})の掲載中のローンチが見つかりません。確認済みの利用者の公開中のプロダクトで、勝ちのローンチを1件だけ持つハンドルを指定してください`,
      );
    }
  });

  test('勝ちのローンチを2件持つプロダクトは1件に決められず失敗する', () => {
    insertLaunch('L9', PRODUCT_ID);

    expect(() =>
      parseModerationProduct(queryRows(moderationProductSql(HANDLE)), HANDLE),
    ).toThrow(`プロダクト(${HANDLE})の掲載中のローンチが見つかりません`);
  });

  test('引用符を含むハンドルも文字列のリテラルとして照会する', () => {
    const handle = "it's'; DROP TABLE products; --";

    expect(queryRows(moderationProductSql(handle))).toEqual([]);
    expect(queryRows('SELECT id FROM products')).toEqual([{ id: PRODUCT_ID }]);
  });

  test('照会の結果の形式が違えば失敗する', () => {
    expect(() =>
      parseModerationProduct(
        [
          {
            product_id: PRODUCT_ID,
            launch_id: LAUNCH_ID,
            owner_user_id: 1,
            owner_handle: OWNER_HANDLE,
            owner_email: OWNER_EMAIL,
            owner_pseudonymous_id: PRODUCT.ownerPseudonymousId,
            owner_nickname: PRODUCT.ownerNickname,
            launch_date: PRODUCT.launchDate,
          },
        ],
        HANDLE,
      ),
    ).toThrow('プロダクトの照会の結果の形式が正しくありません');
  });
});

describe('planEngagementTargets', () => {
  test('接尾辞で分けた確認済みの利用者として、コメントの投稿者1人と評価の数の評価者を計画する', () => {
    const plan = planOf();

    // 仮名化IDは乱数のUUIDのため印に置き換えて比べ、形と一意性は次の場合で確かめる
    expect(withMaskedPseudonymousIds(plan)).toEqual({
      product: PRODUCT,
      comment: {
        commentId: 'ID0002',
        body: `E2Eモデレーションのコメント${SUFFIX}です。`,
        author: {
          id: 'ID0001',
          pseudonymousId: MASKED_PSEUDONYMOUS_ID,
          handle: `e2e-mod-${SUFFIX}-c`,
          nickname: `E2Eモデレーションの投稿者${SUFFIX}`,
          email: `e2e-mod-${SUFFIX}-c@test.example`,
        },
      },
      ratings: [
        {
          ratingId: 'ID0004',
          score: 5,
          rater: {
            id: 'ID0003',
            pseudonymousId: MASKED_PSEUDONYMOUS_ID,
            handle: `e2e-mod-${SUFFIX}-r1`,
            nickname: `E2Eモデレーションの評価者${SUFFIX}-1`,
            email: `e2e-mod-${SUFFIX}-r1@test.example`,
          },
        },
        {
          ratingId: 'ID0006',
          score: 1,
          rater: {
            id: 'ID0005',
            pseudonymousId: MASKED_PSEUDONYMOUS_ID,
            handle: `e2e-mod-${SUFFIX}-r2`,
            nickname: `E2Eモデレーションの評価者${SUFFIX}-2`,
            email: `e2e-mod-${SUFFIX}-r2@test.example`,
          },
        },
      ],
      now: NOW,
    });
  });

  test('利用者の仮名化IDを、監査ログが利用者を指す識別子と同じUUIDの形で、利用者ごとに別の値で作る', () => {
    const { comment, ratings } = planOf({ ratingScores: [5, 4, 3] });
    const pseudonymousIds = [
      comment.author.pseudonymousId,
      ...ratings.map(({ rater }) => rater.pseudonymousId),
    ];

    for (const pseudonymousId of pseudonymousIds) {
      expect(pseudonymousId).toMatch(PSEUDONYMOUS_ID_PATTERN);
    }
    expect(new Set(pseudonymousIds).size).toBe(pseudonymousIds.length);
  });

  test('評価の数が1〜9でなければ失敗する', () => {
    expect(() => planOf({ ratingScores: [] })).toThrow(
      '評価の数は1〜9で指定してください: 0',
    );
    expect(() =>
      planOf({ ratingScores: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5] }),
    ).toThrow('評価の数は1〜9で指定してください: 10');
  });

  test('接尾辞が英小文字と数字の4〜12文字でなければ失敗する', () => {
    for (const suffix of ['abc', 'a'.repeat(13), 'ABCD', 'ab-c']) {
      expect(() => planOf({ suffix })).toThrow(
        `識別子の接尾辞は英小文字と数字の4〜12文字で指定してください: ${suffix}`,
      );
    }
  });
});

describe('engagementTargetsInsertSql・parseEngagementTargetsInsert', () => {
  test('確認済みの利用者・勝ちのローンチへのトップレベルのコメント・プロダクトへの評価を作る', () => {
    const plan = planOf();

    const rows = executeAll(engagementTargetsInsertSql(plan));

    expect(() => {
      parseEngagementTargetsInsert(rows, plan);
    }).not.toThrow();
    expect(
      queryRows(
        `SELECT id, handle, email, status, email_verified_at, terms_agreed_at, password_hash FROM users WHERE id <> '${OWNER_ID}' ORDER BY id`,
      ),
    ).toEqual(
      [plan.comment.author, ...plan.ratings.map(({ rater }) => rater)].map(
        (user) => ({
          id: user.id,
          handle: user.handle,
          email: user.email,
          status: 'active',
          email_verified_at: NOW.getTime(),
          terms_agreed_at: NOW.getTime(),
          password_hash: 'e2e-fixture-unusable',
        }),
      ),
    );
    expect(
      queryRows(
        'SELECT id, product_id, launch_id, parent_id, root_id, depth, author_user_id, body, hidden_at, deleted_at, created_at FROM launch_comments',
      ),
    ).toEqual([
      {
        id: plan.comment.commentId,
        product_id: PRODUCT_ID,
        launch_id: LAUNCH_ID,
        parent_id: null,
        root_id: plan.comment.commentId,
        depth: 1,
        author_user_id: plan.comment.author.id,
        body: plan.comment.body,
        hidden_at: null,
        deleted_at: null,
        created_at: NOW.getTime(),
      },
    ]);
    expect(
      queryRows(
        'SELECT id, product_id, user_id, score, invalidated_at FROM product_ratings ORDER BY id',
      ),
    ).toEqual(
      plan.ratings.map((rating) => ({
        id: rating.ratingId,
        product_id: PRODUCT_ID,
        user_id: rating.rater.id,
        score: rating.score,
        invalidated_at: null,
      })),
    );
  });

  test('作った行の数がコメントと評価の数と違えば失敗する', () => {
    const plan = planOf();

    expect(() => {
      parseEngagementTargetsInsert([{ id: plan.comment.commentId }], plan);
    }).toThrow(
      `プロダクト(${PRODUCT_ID})へのコメント1件と評価2件を作れませんでした`,
    );
  });

  test('同じ接尾辞で2回作ると利用者のハンドルの一意で失敗し、行を増やさない', () => {
    executeAll(engagementTargetsInsertSql(planOf()));

    expect(() => executeAll(engagementTargetsInsertSql(planOf()))).toThrow();
    expect(queryRows('SELECT COUNT(*) AS count FROM users')).toEqual([
      { count: 4 },
    ]);
  });
});

describe('moderationTargetsStateSql・parseModerationTargetsState', () => {
  const stateOf = (plan: EngagementTargetsPlan) =>
    parseModerationTargetsState(
      queryRows(moderationTargetsStateSql(plan)),
      plan,
    );

  test('作った直後は投稿者が有効・プロダクトとコメントが公開・評価が全て有効の状態を読む', () => {
    const plan = planOf();
    executeAll(engagementTargetsInsertSql(plan));

    expect(stateOf(plan)).toEqual({
      ownerStatus: 'active',
      productHidden: false,
      commentHidden: false,
      validRatingCount: 2,
      validRatingAverage: 3,
    });
  });

  test('停止・非公開化・無効化の後の状態を読み、無効な評価と停止中の評価者の評価を平均に数えない', () => {
    const plan = planOf({ ratingScores: [5, 1, 2] });
    executeAll(engagementTargetsInsertSql(plan));
    const [, invalidated, suspended] = plan.ratings;
    db.run(`UPDATE users SET status = 'suspended' WHERE id IN (?, ?)`, [
      OWNER_ID,
      suspended?.rater.id ?? '',
    ]);
    db.run('UPDATE products SET hidden_at = 1 WHERE id = ?', [PRODUCT_ID]);
    db.run('UPDATE launch_comments SET hidden_at = 1 WHERE id = ?', [
      plan.comment.commentId,
    ]);
    db.run('UPDATE product_ratings SET invalidated_at = 1 WHERE id = ?', [
      invalidated?.ratingId ?? '',
    ]);

    expect(stateOf(plan)).toEqual({
      ownerStatus: 'suspended',
      productHidden: true,
      commentHidden: true,
      validRatingCount: 1,
      validRatingAverage: 5,
    });
  });

  test('有効な評価が無ければ平均をnullにする', () => {
    const plan = planOf({ ratingScores: [4] });
    executeAll(engagementTargetsInsertSql(plan));
    db.run('UPDATE product_ratings SET invalidated_at = 1');

    expect(stateOf(plan)).toMatchObject({
      validRatingCount: 0,
      validRatingAverage: null,
    });
  });

  test('対象が見つからない・結果の形式が違えば失敗する', () => {
    const plan = planOf();

    expect(() => stateOf(plan)).toThrow(
      `ローカルのD1にプロダクト(${PRODUCT_ID})とコメント(${plan.comment.commentId})がありません`,
    );
    expect(() =>
      parseModerationTargetsState(
        [
          {
            owner_status: 'active',
            product_hidden_at: null,
            comment_hidden_at: null,
            valid_rating_count: '2',
            valid_rating_average: 3,
          },
        ],
        plan,
      ),
    ).toThrow('UGC管理の対象の状態の照会の結果の形式が正しくありません');
  });
});
