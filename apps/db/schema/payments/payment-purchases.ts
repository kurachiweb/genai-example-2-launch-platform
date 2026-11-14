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
import { users } from '../identity/users.ts';

export const PURCHASE_KIND_VALUES = [
  'week_tournament_entry',
  'year_tournament_entry',
  'sponsorship',
  'ultras',
  'payments_smoke',
] as const;

export const PURCHASE_STATUS_VALUES = [
  'open',
  'processing',
  'fulfilled',
  'rejected',
  'expired',
  'superseded',
] as const;

export const REJECTION_REASON_VALUES = [
  'late',
  'ineligible',
  'duplicate',
] as const;

export const PAYMENT_EMAIL_REQUEST_STATUS_VALUES = [
  'none',
  'pending',
  'requested',
  'skipped',
] as const;

export const paymentPurchases = snakeCase.table(
  'payment_purchases',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    kind: text({ enum: PURCHASE_KIND_VALUES }).notNull(),
    targetId: text(),
    relatedId: text(),
    exclusivityKey: text(),
    status: text({ enum: PURCHASE_STATUS_VALUES }).notNull().default('open'),
    rejectionReason: text({ enum: REJECTION_REASON_VALUES }),
    stateToken: text().notNull(),
    priceLookupKey: text().notNull(),
    stripePriceId: text().notNull(),
    unitAmount: integer().notNull(),
    quantity: integer().notNull(),
    amountTotal: integer().notNull(),
    summaryJson: text().notNull(),
    deadlineAt: integer({ mode: 'timestamp_ms' }),
    acceptUntil: integer({ mode: 'timestamp_ms' }),
    fulfillableUntil: integer({ mode: 'timestamp_ms' }),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    stripeCheckoutSessionId: text(),
    stripePaymentIntentId: text(),
    stripeInvoiceId: text(),
    stripeSubscriptionId: text(),
    consentedAt: integer({ mode: 'timestamp_ms' }),
    consentVersion: text(),
    paidAt: integer({ mode: 'timestamp_ms' }),
    reflectedAt: integer({ mode: 'timestamp_ms' }),
    confirmationEmailStatus: text({ enum: PAYMENT_EMAIL_REQUEST_STATUS_VALUES })
      .notNull()
      .default('none'),
    lastEventAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションの部分索引とCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('payment_purchases_stripe_checkout_session_id_unique').on(
      table.stripeCheckoutSessionId,
    ),
    // 同じ購入種別・対象の権利を二重に付与しないよう、完了した購入だけを排他にする
    uniqueIndex('payment_purchases_exclusivity_key_fulfilled_unique')
      .on(table.exclusivityKey)
      .where(eq(table.status, 'fulfilled').inlineParams()),
    index('payment_purchases_user_id_status_idx').on(
      table.userId,
      table.status,
    ),
    index('payment_purchases_status_deadline_at_idx').on(
      table.status,
      table.deadlineAt,
    ),
    index('payment_purchases_status_expires_at_idx').on(
      table.status,
      table.expiresAt,
    ),
    index('payment_purchases_user_id_kind_target_id_status_idx').on(
      table.userId,
      table.kind,
      table.targetId,
      table.status,
    ),
    index('payment_purchases_stripe_payment_intent_id_idx').on(
      table.stripePaymentIntentId,
    ),
    check(
      'payment_purchases_kind_check',
      inArray(table.kind, PURCHASE_KIND_VALUES).inlineParams(),
    ),
    check(
      'payment_purchases_status_check',
      inArray(table.status, PURCHASE_STATUS_VALUES).inlineParams(),
    ),
    check(
      'payment_purchases_rejection_reason_check',
      inArray(table.rejectionReason, REJECTION_REASON_VALUES).inlineParams(),
    ),
    check(
      'payment_purchases_confirmation_email_status_check',
      inArray(
        table.confirmationEmailStatus,
        PAYMENT_EMAIL_REQUEST_STATUS_VALUES,
      ).inlineParams(),
    ),
  ],
);
