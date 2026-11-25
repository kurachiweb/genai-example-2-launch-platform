import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { moderationActions } from './schema/moderation/moderation-actions.ts';
import { moderationWeeklyStatistics } from './schema/moderation/moderation-weekly-statistics.ts';

const ACTION_ID = '01JQ0000000000000000000M01';

const USER_ID = '01JQ0000000000000000000U01';

const MISSING_PRODUCT_ID = '01JQ0000000000000000000P99';

const MISSING_ADMIN_ID = '01JQ0000000000000000000A99';

const MISSING_EVENT_ID = '01JQ0000000000000000000E99';

const AT = new Date(Date.UTC(2026, 10, 20));

const db = createDatabase(env.DB);

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

function recordOf(
  overrides: Partial<typeof moderationActions.$inferInsert> = {},
): typeof moderationActions.$inferInsert {
  return {
    id: ACTION_ID,
    action: 'product.hide',
    targetKind: 'product',
    targetId: MISSING_PRODUCT_ID,
    subjectUserId: USER_ID,
    productId: MISSING_PRODUCT_ID,
    operatorAdminId: MISSING_ADMIN_ID,
    reason: '規約に反する宣伝のため',
    lifecycleEventId: MISSING_EVENT_ID,
    occurredAt: AT,
    noticeStatus: 'pending',
    ...overrides,
  };
}

// 型で拒まれる値をD1へ渡すため、Drizzleを通さずに挿入の文を組み立てる
function insertWith(column: string, value: string): Promise<unknown> {
  const values = {
    action: 'product.hide',
    target_kind: 'product',
    notice_status: 'pending',
    [column]: value,
  };
  return env.DB.prepare(
    'INSERT INTO moderation_actions (id, action, target_kind, target_id, operator_admin_id, occurred_at, notice_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0)',
  )
    .bind(
      ACTION_ID,
      values.action,
      values.target_kind,
      MISSING_PRODUCT_ID,
      MISSING_ADMIN_ID,
      values.notice_status,
    )
    .run();
}

beforeEach(async () => {
  await db.delete(moderationActions);
  await db.delete(moderationWeeklyStatistics);
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

describe('措置の記録の制約', () => {
  test('存在しないプロダクト・管理者・イベントのIDを持つ記録を作れる', async () => {
    await db.insert(moderationActions).values(recordOf());

    const rows = await db
      .select({
        productId: moderationActions.productId,
        operatorAdminId: moderationActions.operatorAdminId,
        lifecycleEventId: moderationActions.lifecycleEventId,
        noticeRequestedAt: moderationActions.noticeRequestedAt,
      })
      .from(moderationActions);

    expect(rows).toEqual([
      {
        productId: MISSING_PRODUCT_ID,
        operatorAdminId: MISSING_ADMIN_ID,
        lifecycleEventId: MISSING_EVENT_ID,
        noticeRequestedAt: null,
      },
    ]);
  });

  test('関わる利用者・プロダクト・理由・イベントが無い記録を作れる', async () => {
    await db.insert(moderationActions).values(
      recordOf({
        action: 'image.approve',
        targetKind: 'image',
        targetId: '01JQ0000000000000000000I01',
        subjectUserId: null,
        productId: null,
        reason: null,
        lifecycleEventId: null,
        noticeStatus: 'none',
      }),
    );

    expect(await db.$count(moderationActions)).toBe(1);
  });

  test('通知の状態を依頼待ちから依頼済みに進め、依頼の日時を残せる', async () => {
    await db.insert(moderationActions).values(recordOf());

    await db
      .update(moderationActions)
      .set({ noticeStatus: 'requested', noticeRequestedAt: AT })
      .where(eq(moderationActions.id, ACTION_ID));

    const [row] = await db
      .select({
        noticeStatus: moderationActions.noticeStatus,
        noticeRequestedAt: moderationActions.noticeRequestedAt,
      })
      .from(moderationActions);

    expect(row).toEqual({ noticeStatus: 'requested', noticeRequestedAt: AT });
  });

  test('記録が残る利用者を消せる', async () => {
    await db.insert(moderationActions).values(
      recordOf({
        action: 'user.suspend',
        targetKind: 'user',
        targetId: USER_ID,
        productId: null,
      }),
    );

    await db.delete(users).where(eq(users.id, USER_ID));

    expect(await db.$count(users)).toBe(0);
    expect(await db.$count(moderationActions)).toBe(1);
  });

  test.each([
    ['action', 'user.delete'],
    ['target_kind', 'admin'],
    ['notice_status', 'sent'],
  ])('%sに未知の値(%s)を指定した記録は作れない', async (column, value) => {
    expect(await rejectionMessagesOf(insertWith(column, value))).toContainEqual(
      expect.stringContaining(
        `CHECK constraint failed: moderation_actions_${column}_check`,
      ),
    );
  });
});

const STATISTICS_ID = '01JQ0000000000000000000W01';

const WEEK_START = '2026-11-16';

function weekRowOf(
  overrides: Partial<typeof moderationWeeklyStatistics.$inferInsert> = {},
): typeof moderationWeeklyStatistics.$inferInsert {
  return {
    id: STATISTICS_ID,
    weekStart: WEEK_START,
    netRevenue: 12000,
    usersTotal: 30,
    productsTotal: 12,
    qualifierMatches: 4,
    upvotes: 56,
    finalized: false,
    computedAt: AT,
    ...overrides,
  };
}

// 型で拒まれる値をD1へ渡すため、Drizzleを通さずに挿入の文を組み立てる
function insertWeekWith(column: string, value: number): Promise<unknown> {
  const values = {
    net_revenue: 0,
    users_total: 0,
    products_total: 0,
    qualifier_matches: 0,
    upvotes: 0,
    finalized: 0,
    [column]: value,
  };
  return env.DB.prepare(
    'INSERT INTO moderation_weekly_statistics (id, week_start, net_revenue, users_total, products_total, qualifier_matches, upvotes, finalized, computed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)',
  )
    .bind(
      STATISTICS_ID,
      WEEK_START,
      values.net_revenue,
      values.users_total,
      values.products_total,
      values.qualifier_matches,
      values.upvotes,
      values.finalized,
    )
    .run();
}

describe('週ごとの統計の制約', () => {
  test('週の行を作り、確定と集計日時を読み戻せる', async () => {
    await db
      .insert(moderationWeeklyStatistics)
      .values(weekRowOf({ finalized: true }));

    const rows = await db
      .select({
        weekStart: moderationWeeklyStatistics.weekStart,
        finalized: moderationWeeklyStatistics.finalized,
        computedAt: moderationWeeklyStatistics.computedAt,
      })
      .from(moderationWeeklyStatistics);

    expect(rows).toEqual([
      { weekStart: WEEK_START, finalized: true, computedAt: AT },
    ]);
  });

  test('返金が上回った週の負の収益と、件数が0の週を保存できる', async () => {
    await db.insert(moderationWeeklyStatistics).values(
      weekRowOf({
        netRevenue: -500,
        usersTotal: 0,
        productsTotal: 0,
        qualifierMatches: 0,
        upvotes: 0,
      }),
    );

    const [row] = await db
      .select({ netRevenue: moderationWeeklyStatistics.netRevenue })
      .from(moderationWeeklyStatistics);

    expect(row).toEqual({ netRevenue: -500 });
  });

  test('同じ週の開始日を持つ2つ目の行は、IDが違っても作れない', async () => {
    await db.insert(moderationWeeklyStatistics).values(weekRowOf());

    expect(
      await rejectionMessagesOf(
        db
          .insert(moderationWeeklyStatistics)
          .values(weekRowOf({ id: '01JQ0000000000000000000W02' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: moderation_weekly_statistics.week_start',
      ),
    );
    expect(await db.$count(moderationWeeklyStatistics)).toBe(1);
  });

  test('週の開始日の一意索引を対象に、未確定の週だけを書き換えるupsertができる', async () => {
    await db.insert(moderationWeeklyStatistics).values(weekRowOf());
    const upsert = (upvotes: number) =>
      db
        .insert(moderationWeeklyStatistics)
        .values(
          weekRowOf({
            id: '01JQ0000000000000000000W02',
            upvotes,
            finalized: true,
          }),
        )
        .onConflictDoUpdate({
          target: moderationWeeklyStatistics.weekStart,
          set: { upvotes, finalized: true },
          setWhere: eq(moderationWeeklyStatistics.finalized, false),
        });

    await upsert(60);
    await upsert(99);

    const rows = await db
      .select({
        id: moderationWeeklyStatistics.id,
        upvotes: moderationWeeklyStatistics.upvotes,
        finalized: moderationWeeklyStatistics.finalized,
      })
      .from(moderationWeeklyStatistics);

    expect(rows).toEqual([{ id: STATISTICS_ID, upvotes: 60, finalized: true }]);
  });

  test.each([
    ['users_total', -1],
    ['products_total', -1],
    ['qualifier_matches', -1],
    ['upvotes', -1],
    ['finalized', 2],
  ])('%sに範囲外の値(%d)を指定した行は作れない', async (column, value) => {
    expect(
      await rejectionMessagesOf(insertWeekWith(column, value)),
    ).toContainEqual(
      expect.stringContaining(
        `CHECK constraint failed: moderation_weekly_statistics_${column}_check`,
      ),
    );
  });
});
