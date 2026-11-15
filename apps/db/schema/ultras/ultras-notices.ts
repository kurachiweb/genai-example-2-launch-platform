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

export const ULTRAS_NOTICE_KIND_VALUES = [
  'payment_failed',
  'cancellation_accepted',
] as const;

export const ULTRAS_NOTICE_STATUS_VALUES = [
  'pending',
  'requested',
  'skipped',
] as const;

export const ultrasNotices = snakeCase.table(
  'ultras_notices',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    stripeSubscriptionId: text().notNull(),
    kind: text({ enum: ULTRAS_NOTICE_KIND_VALUES }).notNull(),
    dedupeKey: text().notNull(),
    payloadJson: text().notNull(),
    status: text({ enum: ULTRAS_NOTICE_STATUS_VALUES })
      .notNull()
      .default('pending'),
    finishedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('ultras_notices_dedupe_key_unique').on(table.dedupeKey),
    index('ultras_notices_stripe_subscription_id_idx').on(
      table.stripeSubscriptionId,
    ),
    index('ultras_notices_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
    check(
      'ultras_notices_kind_check',
      inArray(table.kind, ULTRAS_NOTICE_KIND_VALUES).inlineParams(),
    ),
    check(
      'ultras_notices_status_check',
      inArray(table.status, ULTRAS_NOTICE_STATUS_VALUES).inlineParams(),
    ),
  ],
);
