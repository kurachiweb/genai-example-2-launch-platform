import { env } from 'cloudflare:workers';
import { asc, eq, ne, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { reportCases } from './schema/reporting/report-cases.ts';
import { reportCategories } from './schema/reporting/report-categories.ts';
import { reports } from './schema/reporting/reports.ts';

interface TestMigration {
  readonly name: string;
  readonly queries: readonly string[];
}

const SEED_MIGRATION_SUFFIX = '_content_reporting_seed/migration.sql';

const INFRINGEMENT_CATEGORY_ID = '01JE0000000000000000000001';

const OTHER_CATEGORY_ID = '01JE0000000000000000000002';

const SEEDED_AT = new Date(1733019303936);

const CASE_ID = '01JR0000000000000000000C01';

const SECOND_CASE_ID = '01JR0000000000000000000C02';

const REPORT_ID = '01JR0000000000000000000R01';

const USER_ID = '01JR0000000000000000000U01';

const MISSING_PRODUCT_ID = '01JR0000000000000000000P99';

const MISSING_OWNER_ID = '01JR0000000000000000000U99';

const MISSING_ACTION_ID = '01JR0000000000000000000M99';

const AT = new Date(Date.UTC(2026, 10, 22));

const LATER = new Date(Date.UTC(2026, 10, 23));

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
    throw new Error('通報カテゴリの初期データのマイグレーションがありません');
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

function caseOf(
  overrides: Partial<typeof reportCases.$inferInsert> = {},
): typeof reportCases.$inferInsert {
  return {
    id: CASE_ID,
    targetKind: 'product',
    targetId: MISSING_PRODUCT_ID,
    targetOwnerUserId: MISSING_OWNER_ID,
    productId: MISSING_PRODUCT_ID,
    statusChangedAt: AT,
    lastReportedAt: AT,
    ...overrides,
  };
}

function reportOf(
  overrides: Partial<typeof reports.$inferInsert> = {},
): typeof reports.$inferInsert {
  return {
    id: REPORT_ID,
    caseId: CASE_ID,
    reporterUserId: USER_ID,
    categoryId: OTHER_CATEGORY_ID,
    categoryName: 'その他',
    reason: '規約に反する宣伝です',
    reportedAt: AT,
    ...overrides,
  };
}

function checkFailureOf(name: string): unknown {
  return expect.stringContaining(`CHECK constraint failed: ${name}`);
}

beforeEach(async () => {
  await db.delete(reports);
  await db.delete(reportCases);
  await db
    .delete(reportCategories)
    .where(ne(reportCategories.systemDefault, true));
  await db.delete(users);
  await db.insert(users).values({
    id: USER_ID,
    pseudonymousId: 'pseudonymous-0',
    email: 'user0@launch.example',
    passwordHash: 'hash',
    nickname: '利用者0',
    handle: 'user0',
    termsAgreedAt: AT,
  });
});

describe('標準カテゴリの初期データ', () => {
  test('マイグレーションの適用後に、固定のIDと日時の「権利侵害」「その他」の2件だけがある', async () => {
    expect(
      await db
        .select()
        .from(reportCategories)
        .orderBy(asc(reportCategories.id)),
    ).toEqual([
      {
        id: INFRINGEMENT_CATEGORY_ID,
        name: '権利侵害',
        systemDefault: true,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        id: OTHER_CATEGORY_ID,
        name: 'その他',
        systemDefault: true,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ]);
  });

  test('初期データのSQLを2回実行しても、失敗せず2件のままになる', async () => {
    await runSeed();
    await runSeed();

    expect(await db.$count(reportCategories)).toBe(2);
  });

  test('大文字小文字だけが異なる名前のカテゴリは一意制約で追加できない', async () => {
    await db.insert(reportCategories).values({ name: 'Spam' });

    expect(
      await rejectionMessagesOf(
        db.insert(reportCategories).values({ name: 'SPAM' }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: report_categories.name',
      ),
    );
  });
});

describe('案件の制約', () => {
  test('存在しない対象・投稿者・プロダクト・措置の記録のIDを持つ案件を、未対応・送らないの既定で作れる', async () => {
    await db.insert(reportCases).values(caseOf());
    await db
      .update(reportCases)
      .set({
        status: 'resolved',
        closedAt: LATER,
        resolution: 'product.hide',
        resolutionActionId: MISSING_ACTION_ID,
      })
      .where(eq(reportCases.id, CASE_ID));

    const [row] = await db
      .select({
        status: reportCases.status,
        resolutionActionId: reportCases.resolutionActionId,
        posterNoticeStatus: reportCases.posterNoticeStatus,
      })
      .from(reportCases);

    expect(row).toEqual({
      status: 'resolved',
      resolutionActionId: MISSING_ACTION_ID,
      posterNoticeStatus: 'none',
    });
  });

  test('対象の未完了の案件は2つ目を作れないが、完了した案件の対象には新しい案件を作れる', async () => {
    await db.insert(reportCases).values(caseOf());

    expect(
      await rejectionMessagesOf(
        db.insert(reportCases).values(caseOf({ id: SECOND_CASE_ID })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: report_cases.target_kind, report_cases.target_id',
      ),
    );

    await db
      .update(reportCases)
      .set({ status: 'rejected', closedAt: LATER, resolution: null })
      .where(eq(reportCases.id, CASE_ID));
    await db.insert(reportCases).values(caseOf({ id: SECOND_CASE_ID }));

    expect(await db.$count(reportCases)).toBe(2);
  });

  test('同じIDの別の種類の対象と、参照を消した未完了の案件どうしは衝突しない', async () => {
    await db.insert(reportCases).values(caseOf());
    await db
      .insert(reportCases)
      .values(caseOf({ id: SECOND_CASE_ID, targetKind: 'comment' }));
    await db.insert(reportCases).values([
      caseOf({
        id: '01JR0000000000000000000C03',
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        targetDetachedAt: AT,
      }),
      caseOf({
        id: '01JR0000000000000000000C04',
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        targetDetachedAt: AT,
      }),
    ]);

    expect(await db.$count(reportCases)).toBe(4);
  });

  test('部分一意索引を対象に、未完了の案件を更新するupsertができる', async () => {
    await db.insert(reportCases).values(caseOf());

    await db
      .insert(reportCases)
      .values(caseOf({ id: SECOND_CASE_ID, lastReportedAt: LATER }))
      .onConflictDoUpdate({
        target: [reportCases.targetKind, reportCases.targetId],
        targetWhere: sql`${reportCases.closedAt} is null`,
        set: { lastReportedAt: LATER },
      });

    expect(
      await db
        .select({
          id: reportCases.id,
          lastReportedAt: reportCases.lastReportedAt,
        })
        .from(reportCases),
    ).toEqual([{ id: CASE_ID, lastReportedAt: LATER }]);
  });

  test.each([
    [
      '対応済で完了の日時が無い',
      { status: 'resolved' as const },
      'report_cases_closed_at_check',
    ],
    [
      '対応中で完了の日時がある',
      { status: 'in_progress' as const, closedAt: LATER },
      'report_cases_closed_at_check',
    ],
    [
      '対象のIDが無く参照の消去の日時も無い',
      { targetId: null },
      'report_cases_target_detached_at_check',
    ],
    [
      '対象のIDがあり参照の消去の日時もある',
      { targetDetachedAt: AT },
      'report_cases_target_detached_at_check',
    ],
    [
      '却下で措置の記録のIDを持つ',
      {
        status: 'rejected' as const,
        closedAt: LATER,
        resolutionActionId: MISSING_ACTION_ID,
      },
      'report_cases_resolution_action_id_check',
    ],
    [
      '措置なしの対応済で措置の記録のIDを持つ',
      {
        status: 'resolved' as const,
        closedAt: LATER,
        resolution: 'none' as const,
        resolutionActionId: MISSING_ACTION_ID,
      },
      'report_cases_resolution_action_id_check',
    ],
  ])('%s案件は作れない', async (_, overrides, constraint) => {
    expect(
      await rejectionMessagesOf(
        db.insert(reportCases).values(caseOf(overrides)),
      ),
    ).toContainEqual(checkFailureOf(constraint));
  });

  test.each([
    ['target_kind', 'image'],
    ['status', 'closed'],
    ['resolution', 'product.delete'],
    ['poster_notice_status', 'sent'],
  ])('%sに未知の値(%s)を指定した案件は作れない', async (column, value) => {
    const values: Record<string, string | null> = {
      target_kind: 'product',
      status: 'open',
      resolution: null,
      poster_notice_status: 'none',
      [column]: value,
    };

    expect(
      await rejectionMessagesOf(
        env.DB.prepare(
          'INSERT INTO report_cases (id, target_kind, target_id, status, status_changed_at, last_reported_at, resolution, poster_notice_status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0, 0)',
        )
          .bind(
            CASE_ID,
            values.target_kind,
            MISSING_PRODUCT_ID,
            values.status,
            values.resolution,
            values.poster_notice_status,
          )
          .run(),
      ),
    ).toContainEqual(checkFailureOf(`report_cases_${column}_check`));
  });
});

describe('通報の制約', () => {
  beforeEach(async () => {
    await db.insert(reportCases).values(caseOf());
  });

  test('ログイン中の利用者の通報と、未ログインで連絡先のある通報を、送らないの既定で作れる', async () => {
    await db.insert(reports).values(reportOf());
    await db.insert(reports).values(
      reportOf({
        id: '01JR0000000000000000000R02',
        reporterUserId: null,
        contactEmail: 'reporter@launch.example',
        categoryId: INFRINGEMENT_CATEGORY_ID,
        categoryName: '権利侵害',
      }),
    );

    expect(
      await db
        .select({ outcomeNoticeStatus: reports.outcomeNoticeStatus })
        .from(reports),
    ).toEqual([
      { outcomeNoticeStatus: 'none' },
      { outcomeNoticeStatus: 'none' },
    ]);
  });

  test('通報者と連絡先を同時に持つ通報は作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(reports)
          .values(reportOf({ contactEmail: 'reporter@launch.example' })),
      ),
    ).toContainEqual(checkFailureOf('reports_contact_email_check'));
  });

  test('通知の状態に未知の値を指定した通報は作れない', async () => {
    expect(
      await rejectionMessagesOf(
        env.DB.prepare(
          "INSERT INTO reports (id, case_id, category_id, category_name, reason, reported_at, outcome_notice_status, created_at, updated_at) VALUES (?, ?, ?, 'その他', '理由', 0, 'sent', 0, 0)",
        )
          .bind(REPORT_ID, CASE_ID, OTHER_CATEGORY_ID)
          .run(),
      ),
    ).toContainEqual(checkFailureOf('reports_outcome_notice_status_check'));
  });

  test.each([
    ['案件', { caseId: SECOND_CASE_ID }],
    ['利用者', { reporterUserId: MISSING_OWNER_ID }],
    ['カテゴリ', { categoryId: '01JR0000000000000000000K99' }],
  ])('存在しない%sを参照する通報は作れない', async (_, overrides) => {
    expect(
      await rejectionMessagesOf(db.insert(reports).values(reportOf(overrides))),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));
  });

  test('通報が残る案件・利用者・カテゴリは、通報を消すまで消せない', async () => {
    await db.insert(reports).values(reportOf());

    for (const pending of [
      db.delete(reportCases).where(eq(reportCases.id, CASE_ID)),
      db.delete(users).where(eq(users.id, USER_ID)),
      db
        .delete(reportCategories)
        .where(eq(reportCategories.id, OTHER_CATEGORY_ID)),
    ]) {
      expect(await rejectionMessagesOf(pending)).toContainEqual(
        expect.stringContaining('FOREIGN KEY constraint failed'),
      );
    }
    expect(await db.$count(reports)).toBe(1);
  });
});
