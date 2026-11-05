import { eq, inArray, ne } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { PURCHASE_KIND_VALUES } from './payment-purchases.ts';

export const PAYMENT_RECORD_KIND_VALUES = [
  'one_time',
  'subscription',
  'refund',
  'dispute',
] as const;

export const PAYMENT_RECORD_STATUS_VALUES = [
  'succeeded',
  'failed',
  'pending',
  'disputed',
  'dispute_won',
  'dispute_lost',
] as const;

export const PAYMENT_CURRENCY_VALUES = ['usd'] as const;

// 利用者の物理削除の後も7年残すため、利用者と結び付く仮名化IDと購入のIDは外部キーにしない
export const paymentRecords = snakeCase.table(
  'payment_records',
  {
    id: ulidPrimaryKey(),
    pseudonymousId: text().notNull(),
    kind: text({ enum: PAYMENT_RECORD_KIND_VALUES }).notNull(),
    purpose: text({ enum: PURCHASE_KIND_VALUES }).notNull(),
    status: text({ enum: PAYMENT_RECORD_STATUS_VALUES }).notNull(),
    amount: integer().notNull(),
    currency: text({ enum: PAYMENT_CURRENCY_VALUES }).notNull(),
    quantity: integer(),
    stripeReference: text().notNull(),
    relatedId: text(),
    purchaseId: text(),
    consentedAt: integer({ mode: 'timestamp_ms' }),
    consentVersion: text(),
    linkFundingSourceGroup: text(),
    occurredAt: integer({ mode: 'timestamp_ms' }).notNull(),
    lastEventAt: integer({ mode: 'timestamp_ms' }).notNull(),
    recordedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションの部分索引とCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('payment_records_stripe_reference_kind_unique')
      .on(table.stripeReference, table.kind)
      .where(ne(table.kind, 'dispute').inlineParams()),
    // チャージバックは段階(係争中・勝訴・敗訴)ごとに行を残すため、状態まで含めて一意にする
    uniqueIndex('payment_records_stripe_reference_kind_status_dispute_unique')
      .on(table.stripeReference, table.kind, table.status)
      .where(eq(table.kind, 'dispute').inlineParams()),
    index('payment_records_pseudonymous_id_occurred_at_id_idx').on(
      table.pseudonymousId,
      table.occurredAt,
      table.id,
    ),
    index('payment_records_occurred_at_idx').on(table.occurredAt),
    index('payment_records_recorded_at_idx').on(table.recordedAt),
    check(
      'payment_records_kind_check',
      inArray(table.kind, PAYMENT_RECORD_KIND_VALUES).inlineParams(),
    ),
    check(
      'payment_records_purpose_check',
      inArray(table.purpose, PURCHASE_KIND_VALUES).inlineParams(),
    ),
    check(
      'payment_records_status_check',
      inArray(table.status, PAYMENT_RECORD_STATUS_VALUES).inlineParams(),
    ),
    check(
      'payment_records_currency_check',
      inArray(table.currency, PAYMENT_CURRENCY_VALUES).inlineParams(),
    ),
  ],
);
