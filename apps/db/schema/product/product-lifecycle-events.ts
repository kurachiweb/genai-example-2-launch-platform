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
import { products } from './products.ts';

const LIFECYCLE_EVENT_TYPES = [
  'deleted',
  'hidden',
  'unhidden',
  'purge_due',
] as const;

const LIFECYCLE_EVENT_STATUSES = ['pending', 'completed'] as const;

export const productLifecycleEvents = snakeCase.table(
  'product_lifecycle_events',
  {
    id: ulidPrimaryKey(),
    productId: text()
      .notNull()
      .references(() => products.id),
    // イベントの記録が投稿者を指すだけで、プロダクトの物理削除で一緒に消えるため外部キーにしない
    ownerUserId: text().notNull(),
    type: text({ enum: LIFECYCLE_EVENT_TYPES }).notNull(),
    occurredAt: integer({ mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: LIFECYCLE_EVENT_STATUSES })
      .notNull()
      .default('pending'),
    dispatchCount: integer().notNull().default(1),
    lastDispatchedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    completedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションの部分索引とCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('product_lifecycle_events_product_id_purge_due_unique')
      .on(table.productId)
      .where(eq(table.type, 'purge_due').inlineParams()),
    index('product_lifecycle_events_product_id_status_occurred_at_id_idx').on(
      table.productId,
      table.status,
      table.occurredAt,
      table.id,
    ),
    index('product_lifecycle_events_status_last_dispatched_at_idx').on(
      table.status,
      table.lastDispatchedAt,
    ),
    check(
      'product_lifecycle_events_type_check',
      inArray(table.type, LIFECYCLE_EVENT_TYPES).inlineParams(),
    ),
    check(
      'product_lifecycle_events_status_check',
      inArray(table.status, LIFECYCLE_EVENT_STATUSES).inlineParams(),
    ),
  ],
);
