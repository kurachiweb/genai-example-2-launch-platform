import { inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

// common-libのdata-export/data-export-rules.tsの値の写しで(apps/dbはcommon-libを読み込まない)、noticeStatusはcontent-reportingの通知の状態と同じ値を取る
const DATA_EXPORT_STATUSES = [
  'queued',
  'generating',
  'ready',
  'expired',
  'failed',
] as const;

const DATA_EXPORT_FAILURE_KINDS = ['error', 'too_large'] as const;

const DATA_EXPORT_NOTICE_STATUSES = [
  'none',
  'pending',
  'requested',
  'skipped',
] as const;

const timestampMs = () => integer({ mode: 'timestamp_ms' });

// 利用者の退会・物理削除の処理が記録を消すため、削除の連鎖は指定しない
export const dataExports = snakeCase.table(
  'data_exports',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    status: text({ enum: DATA_EXPORT_STATUSES }).notNull(),
    requestedAt: timestampMs().notNull(),
    runToken: text(),
    leaseExpiresAt: timestampMs(),
    attempts: integer().notNull().default(0),
    uploadId: text(),
    objectKey: text(),
    fileName: text(),
    byteSize: integer(),
    completedAt: timestampMs(),
    expiresAt: timestampMs(),
    failedAt: timestampMs(),
    failureKind: text({ enum: DATA_EXPORT_FAILURE_KINDS }),
    noticeStatus: text({ enum: DATA_EXPORT_NOTICE_STATUSES })
      .notNull()
      .default('none'),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('data_exports_user_id_requested_at_idx').on(
      table.userId,
      table.requestedAt,
    ),
    index('data_exports_status_expires_at_idx').on(
      table.status,
      table.expiresAt,
    ),
    index('data_exports_status_upload_id_idx').on(table.status, table.uploadId),
    index('data_exports_status_requested_at_idx').on(
      table.status,
      table.requestedAt,
    ),
    index('data_exports_notice_status_updated_at_idx').on(
      table.noticeStatus,
      table.updatedAt,
    ),
    check(
      'data_exports_status_check',
      inArray(table.status, DATA_EXPORT_STATUSES).inlineParams(),
    ),
    check(
      'data_exports_failure_kind_check',
      inArray(table.failureKind, DATA_EXPORT_FAILURE_KINDS).inlineParams(),
    ),
    check(
      'data_exports_notice_status_check',
      inArray(table.noticeStatus, DATA_EXPORT_NOTICE_STATUSES).inlineParams(),
    ),
    // 完了の記録はZIPの置き場所と大きさ・期限を必ず持ち、未完了のアップロードを残さない
    check(
      'data_exports_ready_check',
      sql`(${table.status} <> 'ready' or (${table.objectKey} is not null and ${table.fileName} is not null and ${table.byteSize} is not null and ${table.completedAt} is not null and ${table.expiresAt} is not null and ${table.uploadId} is null))`,
    ),
    // 期限切れの記録はZIPを削除した後も履歴として名前と大きさを残し、置き場所を持たない
    check(
      'data_exports_expired_check',
      sql`(${table.status} <> 'expired' or (${table.fileName} is not null and ${table.byteSize} is not null and ${table.completedAt} is not null and ${table.expiresAt} is not null and ${table.objectKey} is null and ${table.uploadId} is null))`,
    ),
    check(
      'data_exports_failed_check',
      sql`(${table.status} <> 'failed' or (${table.failedAt} is not null and ${table.failureKind} is not null))`,
    ),
  ],
);
