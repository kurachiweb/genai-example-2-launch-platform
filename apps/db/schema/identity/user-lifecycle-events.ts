import { eq, inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

const LIFECYCLE_EVENT_TYPES = [
  'withdrawn',
  'suspended',
  'unsuspended',
  'purge_due',
] as const;

const LIFECYCLE_EVENT_STATUSES = ['pending', 'completed'] as const;

export const userLifecycleEvents = snakeCase.table(
  'user_lifecycle_events',
  {
    id: ulidPrimaryKey(),
    userId: text().notNull(),
    type: text({ enum: LIFECYCLE_EVENT_TYPES }).notNull(),
    occurredAt: integer({ mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: LIFECYCLE_EVENT_STATUSES })
      .notNull()
      .default('pending'),
    completedAt: integer({ mode: 'timestamp_ms' }),
    dispatchCount: integer().notNull().default(1),
    lastDispatchedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションの部分索引とCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('user_lifecycle_events_user_id_purge_due_unique')
      .on(table.userId)
      .where(eq(table.type, 'purge_due').inlineParams()),
    index('user_lifecycle_events_user_id_status_occurred_at_idx').on(
      table.userId,
      table.status,
      table.occurredAt,
    ),
    index('user_lifecycle_events_status_last_dispatched_at_idx').on(
      table.status,
      table.lastDispatchedAt,
    ),
    check(
      'user_lifecycle_events_type_check',
      inArray(table.type, LIFECYCLE_EVENT_TYPES).inlineParams(),
    ),
    check(
      'user_lifecycle_events_status_check',
      inArray(table.status, LIFECYCLE_EVENT_STATUSES).inlineParams(),
    ),
  ],
);
