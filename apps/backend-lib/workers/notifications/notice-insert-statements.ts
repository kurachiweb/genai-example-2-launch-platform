import { getTableColumns } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import { notificationNotices } from '../../../db/schema/notifications/notification-notices.ts';

const notices = notificationNotices;

const MAX_BOUND_PARAMETERS = 100;

// 任意の列も含めて1行がすべての列のバインド変数を使う場合でも上限に収まる行数
export const NOTICE_ROWS_PER_INSERT = Math.floor(
  MAX_BOUND_PARAMETERS / Object.keys(getTableColumns(notices)).length,
);

type NoticeRow = typeof notices.$inferInsert;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

export function noticeInsertStatements(
  db: Database,
  rows: readonly NoticeRow[],
) {
  return chunk(rows, NOTICE_ROWS_PER_INSERT).map((page) =>
    db
      .insert(notices)
      .values(page)
      .onConflictDoNothing({ target: notices.dedupeKey })
      .returning({ id: notices.id }),
  );
}
