import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

// common-libのmoderation/moderation-actions.tsのMODERATION_ACTIONS・MODERATION_TARGET_KINDS・MODERATION_NOTICE_STATUSESの写しで(apps/dbはcommon-libを読み込まない)、一致はルートのconfig/ugc-moderation-contract-copies.unit.test.tsが確かめる
const MODERATION_ACTIONS = [
  'user.suspend',
  'user.unsuspend',
  'user.administrative-withdraw',
  'product.hide',
  'product.unhide',
  'comment.hide',
  'comment.unhide',
  'rating.invalidate',
  'rating.revalidate',
  'image.approve',
  'image.quarantine',
  'image.release',
  'image.delete',
] as const;

const MODERATION_TARGET_KINDS = [
  'user',
  'product',
  'comment',
  'rating',
  'image',
] as const;

const MODERATION_NOTICE_STATUSES = [
  'none',
  'pending',
  'requested',
  'skipped',
] as const;

const timestampMs = () => integer({ mode: 'timestamp_ms' });

// 措置の記録が利用者・プロダクトなどの物理削除を止めないよう、他の機能のIDに外部キーを張らず、記録は本機能の削除の処理が消す
export const moderationActions = snakeCase.table(
  'moderation_actions',
  {
    id: ulidPrimaryKey(),
    action: text({ enum: MODERATION_ACTIONS }).notNull(),
    targetKind: text({ enum: MODERATION_TARGET_KINDS }).notNull(),
    targetId: text().notNull(),
    subjectUserId: text(),
    productId: text(),
    operatorAdminId: text().notNull(),
    reason: text(),
    lifecycleEventId: text(),
    occurredAt: timestampMs().notNull(),
    noticeStatus: text({ enum: MODERATION_NOTICE_STATUSES }).notNull(),
    noticeRequestedAt: timestampMs(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('moderation_actions_target_kind_target_id_occurred_at_idx').on(
      table.targetKind,
      table.targetId,
      table.occurredAt,
    ),
    index('moderation_actions_notice_status_occurred_at_idx').on(
      table.noticeStatus,
      table.occurredAt,
    ),
    index('moderation_actions_subject_user_id_idx').on(table.subjectUserId),
    index('moderation_actions_product_id_idx').on(table.productId),
    index('moderation_actions_occurred_at_idx').on(table.occurredAt),
    check(
      'moderation_actions_action_check',
      inArray(table.action, MODERATION_ACTIONS).inlineParams(),
    ),
    check(
      'moderation_actions_target_kind_check',
      inArray(table.targetKind, MODERATION_TARGET_KINDS).inlineParams(),
    ),
    check(
      'moderation_actions_notice_status_check',
      inArray(table.noticeStatus, MODERATION_NOTICE_STATUSES).inlineParams(),
    ),
  ],
);
