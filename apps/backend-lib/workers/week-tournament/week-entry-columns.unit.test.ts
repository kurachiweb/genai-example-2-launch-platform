import { describe, expect, expectTypeOf, test } from 'bun:test';

import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import {
  WEEK_ENTITLEMENT_SOURCES,
  WEEK_ENTRY_CLOSE_REASONS,
  WEEK_ENTRY_STATUSES,
  WEEK_REFUND_NOTICE_STATUSES,
  WEEK_REFUND_STATUSES,
  type WeekEntitlementSource,
  type WeekEntryCloseReason,
  type WeekEntryStatus,
  type WeekRefundNoticeStatus,
  type WeekRefundStatus,
} from '../../core/week-tournament/week-entry-rules.ts';

// coreはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧とcoreの型の一致をここで確かめる
describe('Weekトーナメントの参加の枠のテーブル定義の値の一覧', () => {
  test('枠の状態の列の値がcoreの状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof weekTournamentEntries.status.enumValues)[number]
    >().toEqualTypeOf<WeekEntryStatus>();
    expect([...weekTournamentEntries.status.enumValues]).toEqual([
      ...WEEK_ENTRY_STATUSES,
    ]);
  });

  test('参加資格の出どころの列の値がcoreの出どころの一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof weekTournamentEntries.entitlementSource.enumValues)[number]
    >().toEqualTypeOf<WeekEntitlementSource>();
    expect([...weekTournamentEntries.entitlementSource.enumValues]).toEqual([
      ...WEEK_ENTITLEMENT_SOURCES,
    ]);
  });

  test('枠を閉じた理由の列の値がcoreの理由の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof weekTournamentEntries.closeReason.enumValues)[number]
    >().toEqualTypeOf<WeekEntryCloseReason>();
    expect([...weekTournamentEntries.closeReason.enumValues]).toEqual([
      ...WEEK_ENTRY_CLOSE_REASONS,
    ]);
  });

  test('返金の状態の列の値がcoreの返金の状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof weekTournamentEntries.refundStatus.enumValues)[number]
    >().toEqualTypeOf<WeekRefundStatus>();
    expect([...weekTournamentEntries.refundStatus.enumValues]).toEqual([
      ...WEEK_REFUND_STATUSES,
    ]);
  });

  test('返金の知らせの状態の列の値がcoreの知らせの状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof weekTournamentEntries.refundNoticeStatus.enumValues)[number]
    >().toEqualTypeOf<WeekRefundNoticeStatus>();
    expect([...weekTournamentEntries.refundNoticeStatus.enumValues]).toEqual([
      ...WEEK_REFUND_NOTICE_STATUSES,
    ]);
  });
});
