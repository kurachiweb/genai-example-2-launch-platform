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
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';

const YEAR_ENTRY_STATUSES = [
  'awaiting_payment',
  'entitled',
  'drawn',
  'expired',
  'forfeited',
  'excluded',
] as const;

const YEAR_ENTITLEMENT_SOURCES = ['payment', 'ultras'] as const;

const YEAR_ENTRY_CLOSE_REASONS = [
  'deadline',
  'deleted',
  'withdrawn',
  'hidden_or_suspended',
  'over_capacity',
  'late_entry',
] as const;

const YEAR_REFUND_STATUSES = [
  'none',
  'pending',
  'requested',
  'not_needed',
  'already_refunded',
  'rejected',
] as const;

const YEAR_REFUND_NOTICE_STATUSES = [
  'none',
  'pending',
  'sent',
  'skipped',
] as const;

export const yearTournamentEntries = snakeCase.table(
  'year_tournament_entries',
  {
    id: ulidPrimaryKey(),
    // Weekトーナメントの機能の表を直接読まないため外部キーにしない
    weekTournamentId: text().notNull(),
    weekPeriod: text().notNull(),
    launchId: text().references(() => productLaunches.id),
    productId: text().references(() => products.id),
    ownerUserId: text().references(() => users.id),
    launchDate: text().notNull(),
    // マッチの物理削除の順に縛られないよう外部キーにしない
    qualifierMatchId: text().notNull(),
    qualifierUpvoteCount: integer().notNull(),
    qualifierLastUpvoteElapsedMs: integer(),
    awardedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    awardedDate: text().notNull(),
    status: text({ enum: YEAR_ENTRY_STATUSES }).notNull(),
    entitlementSource: text({ enum: YEAR_ENTITLEMENT_SOURCES }),
    // 決済の機能の表を直接読まないため外部キーにしない
    purchaseId: text(),
    entitledAt: integer({ mode: 'timestamp_ms' }),
    closedAt: integer({ mode: 'timestamp_ms' }),
    closeReason: text({ enum: YEAR_ENTRY_CLOSE_REASONS }),
    classifiedYear: integer(),
    refundStatus: text({ enum: YEAR_REFUND_STATUSES })
      .notNull()
      .default('none'),
    refundRequestedAt: integer({ mode: 'timestamp_ms' }),
    refundNoticeStatus: text({ enum: YEAR_REFUND_NOTICE_STATUSES })
      .notNull()
      .default('none'),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('year_tournament_entries_week_tournament_id_unique').on(
      table.weekTournamentId,
    ),
    uniqueIndex('year_tournament_entries_launch_id_unique').on(table.launchId),
    index('year_tournament_entries_status_awarded_date_idx').on(
      table.status,
      table.awardedDate,
    ),
    index('year_tournament_entries_owner_user_id_status_idx').on(
      table.ownerUserId,
      table.status,
    ),
    index('year_tournament_entries_product_id_idx').on(table.productId),
    index('year_tournament_entries_classified_year_status_idx').on(
      table.classifiedYear,
      table.status,
    ),
    index('year_tournament_entries_refund_status_updated_at_idx').on(
      table.refundStatus,
      table.updatedAt,
    ),
    index('year_tournament_entries_refund_notice_status_updated_at_idx').on(
      table.refundNoticeStatus,
      table.updatedAt,
    ),
    check(
      'year_tournament_entries_status_check',
      inArray(table.status, YEAR_ENTRY_STATUSES).inlineParams(),
    ),
    check(
      'year_tournament_entries_entitlement_source_check',
      inArray(table.entitlementSource, YEAR_ENTITLEMENT_SOURCES).inlineParams(),
    ),
    check(
      'year_tournament_entries_close_reason_check',
      inArray(table.closeReason, YEAR_ENTRY_CLOSE_REASONS).inlineParams(),
    ),
    check(
      'year_tournament_entries_refund_status_check',
      inArray(table.refundStatus, YEAR_REFUND_STATUSES).inlineParams(),
    ),
    check(
      'year_tournament_entries_refund_notice_status_check',
      inArray(
        table.refundNoticeStatus,
        YEAR_REFUND_NOTICE_STATUSES,
      ).inlineParams(),
    ),
    check(
      'year_tournament_entries_entitled_source_check',
      sql`(${table.status} not in ('entitled', 'drawn') or ${table.entitlementSource} is not null)`,
    ),
    check(
      'year_tournament_entries_payment_purchase_check',
      sql`(${table.entitlementSource} is null or ${table.entitlementSource} <> 'payment' or ${table.purchaseId} is not null)`,
    ),
    check(
      'year_tournament_entries_classified_year_check',
      sql`(${table.classifiedYear} is not null or (${table.status} not in ('drawn', 'excluded') and (${table.closeReason} is null or ${table.closeReason} <> 'late_entry')))`,
    ),
  ],
);
