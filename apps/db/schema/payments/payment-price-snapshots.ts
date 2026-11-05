import { inArray } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { PAYMENT_CURRENCY_VALUES } from './payment-records.ts';

const RECURRING_INTERVALS = ['month'] as const;

export const paymentPriceSnapshots = snakeCase.table(
  'payment_price_snapshots',
  {
    id: ulidPrimaryKey(),
    lookupKey: text().notNull(),
    stripePriceId: text().notNull(),
    unitAmount: integer().notNull(),
    currency: text({ enum: PAYMENT_CURRENCY_VALUES }).notNull(),
    recurringInterval: text({ enum: RECURRING_INTERVALS }),
    fetchedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('payment_price_snapshots_lookup_key_unique').on(
      table.lookupKey,
    ),
    check(
      'payment_price_snapshots_currency_check',
      inArray(table.currency, PAYMENT_CURRENCY_VALUES).inlineParams(),
    ),
    check(
      'payment_price_snapshots_recurring_interval_check',
      inArray(table.recurringInterval, RECURRING_INTERVALS).inlineParams(),
    ),
  ],
);
