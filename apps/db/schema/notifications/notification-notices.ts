import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { notificationPreferences } from './notification-preferences.ts';

const NOTIFICATION_NOTICE_STATUSES = ['pending', 'sent', 'skipped'] as const;

const NOTICE_SKIP_REASONS = [
  'topic_disabled',
  'recipient_unavailable',
  'email_not_verified',
  'suppressed',
  'sender_info_missing',
  'own_product_unavailable',
  'stale',
  'recipient_withdrawn',
  'send_rejected',
  'expired',
] as const;

export const notificationNotices = snakeCase.table(
  'notification_notices',
  {
    id: ulidPrimaryKey(),
    dedupeKey: text().notNull(),
    slotKey: text().notNull(),
    groupKey: text().notNull(),
    topic: text({ enum: notificationPreferences.topic.enumValues }).notNull(),
    recipientUserId: text()
      .notNull()
      .references(() => users.id),
    // 上流の物理削除と本機能の削除の順を縛らないため、出どころのIDと枠のキーは外部キーにしない
    matchId: text(),
    entryId: text(),
    productId: text(),
    eventId: text(),
    status: text({ enum: NOTIFICATION_NOTICE_STATUSES })
      .notNull()
      .default('pending'),
    skipReason: text({ enum: NOTICE_SKIP_REASONS }),
    emailRequestId: text(),
    settledAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('notification_notices_dedupe_key_unique').on(table.dedupeKey),
    index('notification_notices_slot_key_status_group_key_id_idx').on(
      table.slotKey,
      table.status,
      table.groupKey,
      table.id,
    ),
    index('notification_notices_recipient_user_id_idx').on(
      table.recipientUserId,
    ),
    index('notification_notices_status_settled_at_idx').on(
      table.status,
      table.settledAt,
    ),
    check(
      'notification_notices_topic_check',
      inArray(
        table.topic,
        notificationPreferences.topic.enumValues,
      ).inlineParams(),
    ),
    check(
      'notification_notices_status_check',
      inArray(table.status, NOTIFICATION_NOTICE_STATUSES).inlineParams(),
    ),
    check(
      'notification_notices_skip_reason_check',
      inArray(table.skipReason, NOTICE_SKIP_REASONS).inlineParams(),
    ),
  ],
);
