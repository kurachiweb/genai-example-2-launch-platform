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
import { weekTournaments } from './week-tournaments.ts';

const WEEK_ENTRY_STATUSES = [
  'awaiting_payment',
  'entitled',
  'drawn',
  'expired',
  'forfeited',
  'excluded',
] as const;

const WEEK_ENTITLEMENT_SOURCES = ['payment', 'ultras'] as const;

const WEEK_ENTRY_CLOSE_REASONS = [
  'deadline',
  'deleted',
  'withdrawn',
  'hidden_or_suspended',
  'late_entry',
] as const;

const WEEK_REFUND_STATUSES = [
  'none',
  'pending',
  'requested',
  'not_needed',
  'already_refunded',
  'rejected',
] as const;

const WEEK_REFUND_NOTICE_STATUSES = [
  'none',
  'pending',
  'sent',
  'skipped',
] as const;

export const weekTournamentEntries = snakeCase.table(
  'week_tournament_entries',
  {
    id: ulidPrimaryKey(),
    tournamentId: text()
      .notNull()
      .references(() => weekTournaments.id),
    launchId: text().references(() => productLaunches.id),
    productId: text().references(() => products.id),
    ownerUserId: text().references(() => users.id),
    launchDate: text().notNull(),
    // マッチの物理削除の順に縛られないよう外部キーにしない
    qualifierMatchId: text().notNull(),
    qualifierUpvoteCount: integer().notNull(),
    qualifierLastUpvoteElapsedMs: integer(),
    wonAt: integer({ mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: WEEK_ENTRY_STATUSES }).notNull(),
    entitlementSource: text({ enum: WEEK_ENTITLEMENT_SOURCES }),
    // 決済の機能の表を直接読まないため外部キーにしない
    purchaseId: text(),
    entitledAt: integer({ mode: 'timestamp_ms' }),
    closedAt: integer({ mode: 'timestamp_ms' }),
    closeReason: text({ enum: WEEK_ENTRY_CLOSE_REASONS }),
    refundStatus: text({ enum: WEEK_REFUND_STATUSES })
      .notNull()
      .default('none'),
    refundRequestedAt: integer({ mode: 'timestamp_ms' }),
    refundNoticeStatus: text({ enum: WEEK_REFUND_NOTICE_STATUSES })
      .notNull()
      .default('none'),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('week_tournament_entries_launch_id_unique').on(table.launchId),
    uniqueIndex('week_tournament_entries_tournament_id_product_id_unique').on(
      table.tournamentId,
      table.productId,
    ),
    index('week_tournament_entries_owner_user_id_status_idx').on(
      table.ownerUserId,
      table.status,
    ),
    index('week_tournament_entries_tournament_id_status_idx').on(
      table.tournamentId,
      table.status,
    ),
    index('week_tournament_entries_refund_status_updated_at_idx').on(
      table.refundStatus,
      table.updatedAt,
    ),
    index('week_tournament_entries_refund_notice_status_updated_at_idx').on(
      table.refundNoticeStatus,
      table.updatedAt,
    ),
    check(
      'week_tournament_entries_status_check',
      inArray(table.status, WEEK_ENTRY_STATUSES).inlineParams(),
    ),
    check(
      'week_tournament_entries_entitlement_source_check',
      inArray(table.entitlementSource, WEEK_ENTITLEMENT_SOURCES).inlineParams(),
    ),
    check(
      'week_tournament_entries_close_reason_check',
      inArray(table.closeReason, WEEK_ENTRY_CLOSE_REASONS).inlineParams(),
    ),
    check(
      'week_tournament_entries_refund_status_check',
      inArray(table.refundStatus, WEEK_REFUND_STATUSES).inlineParams(),
    ),
    check(
      'week_tournament_entries_refund_notice_status_check',
      inArray(
        table.refundNoticeStatus,
        WEEK_REFUND_NOTICE_STATUSES,
      ).inlineParams(),
    ),
    check(
      'week_tournament_entries_entitled_source_check',
      sql`(${table.status} not in ('entitled', 'drawn') or ${table.entitlementSource} is not null)`,
    ),
    check(
      'week_tournament_entries_payment_purchase_check',
      sql`(${table.entitlementSource} is null or ${table.entitlementSource} <> 'payment' or ${table.purchaseId} is not null)`,
    ),
  ],
);
