import { between, inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { products } from '../product/products.ts';

// common-libのsponsorship/sponsorship-tiers.tsのSPONSORSHIP_TIERSの写しで(apps/dbはcommon-libを読み込まない)、一致はルートのconfig/sponsorship-contract-copies.unit.test.tsが確かめる
const SPONSORSHIP_TIERS = ['legend', 'gold', 'silver'] as const;

// common-libのsponsorship/sponsorship-period.tsのSPONSORSHIP_MAX_DAYSの写しで、一致はルートのconfig/sponsorship-contract-copies.unit.test.tsが確かめる
const SPONSORSHIP_MAX_DAYS = 366;

const SPONSORSHIP_MIN_DAYS = 1;

const SPONSORSHIP_STATES = ['pending_payment', 'paid', 'terminated'] as const;

const SPONSORSHIP_NOTICE_STATES = [
  'none',
  'pending',
  'requested',
  'skipped',
] as const;

const SPONSORSHIP_REFUND_STATUSES = [
  'none',
  'requested',
  'not_needed',
  'already_refunded',
  'rejected',
] as const;

export const sponsorships = snakeCase.table(
  'sponsorships',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    productId: text()
      .notNull()
      .references(() => products.id),
    tier: text({ enum: SPONSORSHIP_TIERS }).notNull(),
    startsOn: text().notNull(),
    endsOn: text().notNull(),
    days: integer().notNull(),
    state: text({ enum: SPONSORSHIP_STATES }).notNull(),
    // 決済の機能の表を直接読まないため外部キーにしない
    purchaseId: text(),
    paymentRecordId: text(),
    amountTotal: integer(),
    paidAt: integer({ mode: 'timestamp_ms' }),
    terminatedAt: integer({ mode: 'timestamp_ms' }),
    terminationReason: text(),
    startNotice: text({ enum: SPONSORSHIP_NOTICE_STATES })
      .notNull()
      .default('none'),
    endNotice: text({ enum: SPONSORSHIP_NOTICE_STATES })
      .notNull()
      .default('none'),
    terminationNotice: text({ enum: SPONSORSHIP_NOTICE_STATES })
      .notNull()
      .default('none'),
    productDeletedAt: integer({ mode: 'timestamp_ms' }),
    terminationRefundStatus: text({ enum: SPONSORSHIP_REFUND_STATUSES })
      .notNull()
      .default('none'),
    terminationRefundDays: integer(),
    terminationRefundAmount: integer(),
    terminationRefundRequestId: text(),
    stopRefundStatus: text({ enum: SPONSORSHIP_REFUND_STATUSES })
      .notNull()
      .default('none'),
    stopRefundDays: integer(),
    stopRefundAmount: integer(),
    stopRefundRequestId: text(),
    ...timestamps(),
    ...softDelete(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('sponsorships_display_idx').on(
      table.state,
      table.startsOn,
      table.endsOn,
    ),
    index('sponsorships_user_idx').on(table.userId, table.createdAt),
    index('sponsorships_product_tier_idx').on(
      table.productId,
      table.tier,
      table.state,
    ),
    index('sponsorships_created_idx').on(table.createdAt),
    // SQLiteは問い合わせの条件が部分索引の条件を含むと分かるときだけ使うため、問い合わせ側も'paid'・'none'をリテラルで書く
    index('sponsorships_unsettled_end_idx')
      .on(table.endsOn)
      .where(
        sql`(${table.state} = 'paid' and ${table.deletedAt} is null and (${table.stopRefundStatus} = 'none' or ${table.endNotice} = 'none'))`,
      ),
    index('sponsorships_pending_notice_idx')
      .on(table.updatedAt)
      .where(
        sql`(${table.startNotice} = 'pending' or ${table.endNotice} = 'pending' or ${table.terminationNotice} = 'pending')`,
      ),
    check(
      'sponsorships_tier_check',
      inArray(table.tier, SPONSORSHIP_TIERS).inlineParams(),
    ),
    check(
      'sponsorships_state_check',
      inArray(table.state, SPONSORSHIP_STATES).inlineParams(),
    ),
    check(
      'sponsorships_start_notice_check',
      inArray(table.startNotice, SPONSORSHIP_NOTICE_STATES).inlineParams(),
    ),
    check(
      'sponsorships_end_notice_check',
      inArray(table.endNotice, SPONSORSHIP_NOTICE_STATES).inlineParams(),
    ),
    check(
      'sponsorships_termination_notice_check',
      inArray(
        table.terminationNotice,
        SPONSORSHIP_NOTICE_STATES,
      ).inlineParams(),
    ),
    check(
      'sponsorships_termination_refund_status_check',
      inArray(
        table.terminationRefundStatus,
        SPONSORSHIP_REFUND_STATUSES,
      ).inlineParams(),
    ),
    check(
      'sponsorships_stop_refund_status_check',
      inArray(
        table.stopRefundStatus,
        SPONSORSHIP_REFUND_STATUSES,
      ).inlineParams(),
    ),
    check(
      'sponsorships_days_range_check',
      between(
        table.days,
        SPONSORSHIP_MIN_DAYS,
        SPONSORSHIP_MAX_DAYS,
      ).inlineParams(),
    ),
    check(
      'sponsorships_paid_columns_check',
      sql`(${table.state} not in ('paid', 'terminated') or (${table.purchaseId} is not null and ${table.paymentRecordId} is not null and ${table.amountTotal} is not null and ${table.paidAt} is not null))`,
    ),
    check(
      'sponsorships_terminated_columns_check',
      sql`(${table.state} <> 'terminated' or (${table.terminatedAt} is not null and ${table.terminationReason} is not null))`,
    ),
  ],
);
