import { describe, expect, test } from 'bun:test';

import { getTableColumns } from 'drizzle-orm';

import { createDatabase } from '../../../db/client.ts';
import { notificationNotices } from '../../../db/schema/notifications/notification-notices.ts';
import {
  NOTICE_ROWS_PER_INSERT,
  noticeInsertStatements,
} from './d1-notification-notice-store.ts';

const MAX_BOUND_PARAMETERS = 100;

const T0 = new Date('2026-11-01T00:00:00.000Z');

type NoticeRow = typeof notificationNotices.$inferInsert;

// 文の組み立てだけを確かめるため、問い合わせを実行しない偽物のD1を渡す
const db = createDatabase({} as D1Database);

// 任意の列も含めてすべての列に値を入れ、1行が使うバインド変数を最大にする
function fullRowOf(index: number): Required<NoticeRow> {
  return {
    id: `01JC0NOTICE${String(index).padStart(15, '0')}`,
    dedupeKey: `dedupe-${String(index)}`,
    slotKey: 'evening:2026-11-01',
    groupKey: `evening:2026-11-01:recipient-${String(index)}:product`,
    topic: 'match_result',
    recipientUserId: `recipient-${String(index)}`,
    matchId: `match-${String(index)}`,
    entryId: `entry-${String(index)}`,
    productId: `product-${String(index)}`,
    eventId: `event-${String(index)}`,
    status: 'sent',
    skipReason: 'stale',
    emailRequestId: `email-${String(index)}`,
    settledAt: T0,
    createdAt: T0,
    updatedAt: T0,
  };
}

function rowsOf(count: number): Required<NoticeRow>[] {
  return Array.from({ length: count }, (_, index) => fullRowOf(index));
}

describe('NOTICE_ROWS_PER_INSERT', () => {
  test('通知の表の16列から、1文のバインド変数が上限に収まる最大の6行に決まる', () => {
    const columnCount = Object.keys(
      getTableColumns(notificationNotices),
    ).length;

    expect(columnCount).toBe(16);
    expect(NOTICE_ROWS_PER_INSERT).toBe(6);
    expect(NOTICE_ROWS_PER_INSERT * columnCount).toBeLessThanOrEqual(
      MAX_BOUND_PARAMETERS,
    );
    expect((NOTICE_ROWS_PER_INSERT + 1) * columnCount).toBeGreaterThan(
      MAX_BOUND_PARAMETERS,
    );
  });
});

describe('noticeInsertStatements', () => {
  test('すべての列に値がある行でも、各文のバインド変数を100個以下に分ける', () => {
    const statements = noticeInsertStatements(db, rowsOf(13));

    const paramCounts = statements.map(
      (statement) => statement.toSQL().params.length,
    );
    expect(paramCounts).toEqual([96, 96, 16]);
    for (const count of paramCounts) {
      expect(count).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
    }
  });

  test('重複のキーの衝突を無視し、作った行のIDだけを返す文にする', () => {
    const [statement] = noticeInsertStatements(db, rowsOf(1));

    const { sql } = statement?.toSQL() ?? { sql: '' };
    expect(sql).toContain(
      'on conflict ("notification_notices"."dedupe_key") do nothing',
    );
    expect(sql).toContain('returning "id"');
  });

  test('空の行は文を作らない', () => {
    expect(noticeInsertStatements(db, [])).toEqual([]);
  });
});
