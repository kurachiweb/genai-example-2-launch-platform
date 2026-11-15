import { inArray } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

const STRIPE_OBJECT_TYPES = ['subscription'] as const;

export const paymentStripeObjects = snakeCase.table(
  'payment_stripe_objects',
  {
    id: ulidPrimaryKey(),
    objectId: text().notNull(),
    objectType: text({ enum: STRIPE_OBJECT_TYPES }).notNull(),
    lastEventAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('payment_stripe_objects_object_id_unique').on(table.objectId),
    check(
      'payment_stripe_objects_object_type_check',
      inArray(table.objectType, STRIPE_OBJECT_TYPES).inlineParams(),
    ),
  ],
);
