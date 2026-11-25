import { eq, inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

// common-libのreporting/report-rules.ts・report-case-rules.tsとmoderation/moderation-actions.tsの値の写しで(apps/dbはcommon-libを読み込まない)、一致はルートのconfig/content-reporting-contract-copies.unit.test.tsが確かめる
const REPORT_TARGET_KINDS = ['user', 'product', 'comment'] as const;

const REPORT_CASE_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'rejected',
] as const;

const CLOSED_STATUSES = ['resolved', 'rejected'] as const;

const REPORT_RESOLUTIONS = [
  'product.hide',
  'comment.hide',
  'user.suspend',
  'none',
] as const;

const REPORT_MEASURES = [
  'product.hide',
  'comment.hide',
  'user.suspend',
] as const;

const REPORT_NOTICE_STATUSES = [
  'none',
  'pending',
  'requested',
  'skipped',
] as const;

const timestampMs = () => integer({ mode: 'timestamp_ms' });

// 対象・投稿者・対象のプロダクト・措置の記録の物理削除を止めないよう、それらのIDに外部キーを張らず、参照の消去は本機能の処理が行う
export const reportCases = snakeCase.table(
  'report_cases',
  {
    id: ulidPrimaryKey(),
    targetKind: text({ enum: REPORT_TARGET_KINDS }).notNull(),
    targetId: text(),
    targetOwnerUserId: text(),
    productId: text(),
    targetDetachedAt: timestampMs(),
    status: text({ enum: REPORT_CASE_STATUSES }).notNull().default('open'),
    statusChangedAt: timestampMs().notNull(),
    lastReportedAt: timestampMs().notNull(),
    infringementReportedAt: timestampMs(),
    closedAt: timestampMs(),
    resolution: text({ enum: REPORT_RESOLUTIONS }),
    resolutionActionId: text(),
    closingReason: text(),
    posterNoticeStatus: text({ enum: REPORT_NOTICE_STATUSES })
      .notNull()
      .default('none'),
    posterNoticeRequestedAt: timestampMs(),
    lastInquiredAt: timestampMs(),
    lastInquiryMessage: text(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約と索引の条件に`?`が残るため、値を埋め込む
  (table) => [
    // 参照を消した案件はtarget_idがNULLになり、SQLiteはNULLどうしを区別するため索引で衝突しない
    uniqueIndex('report_cases_target_kind_target_id_open_unique')
      .on(table.targetKind, table.targetId)
      .where(sql`${table.closedAt} is null`),
    index('report_cases_last_reported_at_id_idx').on(
      table.lastReportedAt,
      table.id,
    ),
    index('report_cases_status_last_reported_at_idx').on(
      table.status,
      table.lastReportedAt,
    ),
    index('report_cases_target_owner_user_id_idx').on(table.targetOwnerUserId),
    index('report_cases_product_id_idx').on(table.productId),
    index('report_cases_closed_at_idx').on(table.closedAt),
    index('report_cases_target_detached_at_idx').on(table.targetDetachedAt),
    check(
      'report_cases_target_kind_check',
      inArray(table.targetKind, REPORT_TARGET_KINDS).inlineParams(),
    ),
    check(
      'report_cases_status_check',
      inArray(table.status, REPORT_CASE_STATUSES).inlineParams(),
    ),
    check(
      'report_cases_resolution_check',
      inArray(table.resolution, REPORT_RESOLUTIONS).inlineParams(),
    ),
    check(
      'report_cases_poster_notice_status_check',
      inArray(table.posterNoticeStatus, REPORT_NOTICE_STATUSES).inlineParams(),
    ),
    check(
      'report_cases_closed_at_check',
      sql`(${inArray(table.status, CLOSED_STATUSES)}) = (${table.closedAt} is not null)`.inlineParams(),
    ),
    check(
      'report_cases_target_detached_at_check',
      sql`(${table.targetId} is null) = (${table.targetDetachedAt} is not null)`,
    ),
    check(
      'report_cases_resolution_action_id_check',
      sql`(${table.resolutionActionId} is null or (${eq(table.status, 'resolved')} and ${inArray(table.resolution, REPORT_MEASURES)}))`.inlineParams(),
    ),
  ],
);
