import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { moderationActions } from './schema/moderation/moderation-actions.ts';

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
