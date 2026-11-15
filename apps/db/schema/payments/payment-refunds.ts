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
import {
  PAYMENT_EMAIL_REQUEST_STATUS_VALUES,
  paymentPurchases,
} from './payment-purchases.ts';

export const REFUND_REQUEST_STATUS_VALUES = [
  'requested',
  'submitted',
  'succeeded',
  'failed',
  'canceled',
] as const;

export const paymentRefunds = snakeCase.table(
  'payment_refunds',
  {
    id: ulidPrimaryKey(),
    purchaseId: text()
      .notNull()
      .references(() => paymentPurchases.id),
    requestKey: text().notNull(),
    amount: integer().notNull(),
    reason: text().notNull(),
    status: text({ enum: REFUND_REQUEST_STATUS_VALUES })
      .notNull()
      .default('requested'),
    stripeRefundId: text(),
    failureCode: text(),
    dispatchedAt: integer({ mode: 'timestamp_ms' }),
    noticeStatus: text({ enum: PAYMENT_EMAIL_REQUEST_STATUS_VALUES })
      .notNull()
      .default('none'),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('payment_refunds_request_key_unique').on(table.requestKey),
    uniqueIndex('payment_refunds_stripe_refund_id_unique').on(
      table.stripeRefundId,
    ),
    index('payment_refunds_purchase_id_idx').on(table.purchaseId),
    check(
      'payment_refunds_status_check',
      inArray(table.status, REFUND_REQUEST_STATUS_VALUES).inlineParams(),
    ),
    check(
      'payment_refunds_notice_status_check',
      inArray(
        table.noticeStatus,
        PAYMENT_EMAIL_REQUEST_STATUS_VALUES,
      ).inlineParams(),
    ),
  ],
);
