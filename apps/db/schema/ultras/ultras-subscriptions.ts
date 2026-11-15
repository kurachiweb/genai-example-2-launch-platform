import { inArray, sql } from 'drizzle-orm';
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

export const STRIPE_SUBSCRIPTION_STATUS_VALUES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;

export const CANCELLATION_SOURCE_VALUES = [
  'user',
  'suspension',
  'withdrawal',
] as const;

export const PENDING_CANCELLATION_SOURCE_VALUES = [
  'suspension',
  'withdrawal',
] as const;

export const ultrasSubscriptions = snakeCase.table(
  'ultras_subscriptions',
  {
    id: ulidPrimaryKey(),
    stripeSubscriptionId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id),
    // paymentsの購入の行は別のライフサイクルの処理が物理削除するため、削除の順に縛られないよう外部キーにしない
    purchaseId: text(),
    stripeStatus: text({ enum: STRIPE_SUBSCRIPTION_STATUS_VALUES }).notNull(),
    cancelScheduled: integer({ mode: 'boolean' }).notNull().default(false),
    cancelAt: integer({ mode: 'timestamp_ms' }),
    currentPeriodEnd: integer({ mode: 'timestamp_ms' }),
    endedAt: integer({ mode: 'timestamp_ms' }),
    startedAt: integer({ mode: 'timestamp_ms' }),
    benefitEndsAt: integer({ mode: 'timestamp_ms' }),
    benefitEndFixed: integer({ mode: 'boolean' }).notNull().default(false),
    canceledAt: integer({ mode: 'timestamp_ms' }),
    cancellationSource: text({ enum: CANCELLATION_SOURCE_VALUES }),
    pendingCancellationSource: text({
      enum: PENDING_CANCELLATION_SOURCE_VALUES,
    }),
    pastDueSince: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('ultras_subscriptions_stripe_subscription_id_unique').on(
      table.stripeSubscriptionId,
    ),
    // 同じ利用者の2つの加入が同時に有効になっても、特典の継続期間が右に開いた加入を1つに限る
    uniqueIndex('ultras_subscriptions_user_id_benefit_open_unique')
      .on(table.userId)
      .where(
        sql`${table.startedAt} is not null and ${table.benefitEndsAt} is null`,
      ),
    index('ultras_subscriptions_user_id_started_at_idx').on(
      table.userId,
      table.startedAt,
    ),
    index('ultras_subscriptions_stripe_status_idx').on(table.stripeStatus),
    check(
      'ultras_subscriptions_stripe_status_check',
      inArray(
        table.stripeStatus,
        STRIPE_SUBSCRIPTION_STATUS_VALUES,
      ).inlineParams(),
    ),
    check(
      'ultras_subscriptions_cancel_scheduled_check',
      sql`${table.cancelScheduled} in (0, 1)`,
    ),
    check(
      'ultras_subscriptions_benefit_end_fixed_check',
      sql`${table.benefitEndFixed} in (0, 1)`,
    ),
    check(
      'ultras_subscriptions_cancellation_source_check',
      inArray(
        table.cancellationSource,
        CANCELLATION_SOURCE_VALUES,
      ).inlineParams(),
    ),
    check(
      'ultras_subscriptions_pending_cancellation_source_check',
      inArray(
        table.pendingCancellationSource,
        PENDING_CANCELLATION_SOURCE_VALUES,
      ).inlineParams(),
    ),
  ],
);
