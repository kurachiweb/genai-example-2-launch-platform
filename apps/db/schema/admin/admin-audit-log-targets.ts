import { index, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { adminAuditLogs } from './admin-audit-logs.ts';

export const adminAuditLogTargets = snakeCase.table(
  'admin_audit_log_targets',
  {
    id: ulidPrimaryKey(),
    logId: text()
      .notNull()
      .references(() => adminAuditLogs.id),
    targetKind: text().notNull(),
    // 利用者の物理削除の後も仮名化IDを残すため、対象の識別子は他のテーブルを参照しない
    targetId: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('admin_audit_log_targets_target_kind_target_id_log_id_idx').on(
      table.targetKind,
      table.targetId,
      table.logId,
    ),
    index('admin_audit_log_targets_log_id_idx').on(table.logId),
  ],
);
