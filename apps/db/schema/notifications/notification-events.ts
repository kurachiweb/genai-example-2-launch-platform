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

const NOTIFICATION_EVENT_TYPES = [
  'match_preview',
  'match_result',
  'award',
] as const;

const NOTIFICATION_EVENT_STATUSES = ['pending', 'expanded'] as const;

const AWARD_KINDS = ['product_of_the_week', 'product_of_the_year'] as const;

export const notificationEvents = snakeCase.table(
  'notification_events',
  {
    id: ulidPrimaryKey(),
    type: text({ enum: NOTIFICATION_EVENT_TYPES }).notNull(),
    dedupeKey: text().notNull(),
    publisher: text().notNull(),
    // 上流の物理削除を妨げないため、マッチとプロダクトのIDは外部キーにしない
    matchId: text(),
    award: text({ enum: AWARD_KINDS }),
    period: text(),
    productId: text(),
    status: text({ enum: NOTIFICATION_EVENT_STATUSES })
      .notNull()
      .default('pending'),
    cursor: text(),
    occurredAt: integer({ mode: 'timestamp_ms' }).notNull(),
    expandedAt: integer({ mode: 'timestamp_ms' }),
    dispatchCount: integer().notNull().default(1),
    lastDispatchedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('notification_events_dedupe_key_unique').on(table.dedupeKey),
    index('notification_events_status_last_dispatched_at_idx').on(
      table.status,
      table.lastDispatchedAt,
    ),
    index('notification_events_status_expanded_at_idx').on(
      table.status,
      table.expandedAt,
    ),
    check(
      'notification_events_type_check',
      inArray(table.type, NOTIFICATION_EVENT_TYPES).inlineParams(),
    ),
    check(
      'notification_events_status_check',
      inArray(table.status, NOTIFICATION_EVENT_STATUSES).inlineParams(),
    ),
    check(
      'notification_events_award_check',
      inArray(table.award, AWARD_KINDS).inlineParams(),
    ),
  ],
);
