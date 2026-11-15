import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

export const adminAuditLogs = snakeCase.table(
  'admin_audit_logs',
  {
    id: ulidPrimaryKey(),
    // 管理者の削除後も監査ログを残すため、操作者のIDは外部キーにしない
    operatorAdminId: text().notNull(),
    action: text().notNull(),
    targetKind: text(),
    reason: text(),
    detail: text({ mode: 'json' })
      .$type<Readonly<Record<string, string>>>()
      .notNull()
      .default({}),
    occurredAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('admin_audit_logs_occurred_at_id_idx').on(table.occurredAt, table.id),
    index('admin_audit_logs_operator_admin_id_occurred_at_idx').on(
      table.operatorAdminId,
      table.occurredAt,
    ),
    index('admin_audit_logs_action_occurred_at_idx').on(
      table.action,
      table.occurredAt,
    ),
  ],
);
