import { describe, expect, expectTypeOf, test } from 'bun:test';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import {
  YEAR_ENTITLEMENT_SOURCES,
  YEAR_ENTRY_CLOSE_REASONS,
  YEAR_ENTRY_STATUSES,
  YEAR_REFUND_NOTICE_STATUSES,
  YEAR_REFUND_STATUSES,
  type YearEntitlementSource,
  type YearEntryCloseReason,
  type YearEntryStatus,
  type YearRefundNoticeStatus,
  type YearRefundStatus,
} from '../../core/year-tournament/year-entry-rules.ts';

// coreはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧とcoreの型の一致をここで確かめる
describe('Yearトーナメントの参加の枠のテーブル定義の値の一覧', () => {
  test('枠の状態の列の値がcoreの状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof yearTournamentEntries.status.enumValues)[number]
    >().toEqualTypeOf<YearEntryStatus>();
    expect([...yearTournamentEntries.status.enumValues]).toEqual([
      ...YEAR_ENTRY_STATUSES,
    ]);
  });

  test('参加資格の出どころの列の値がcoreの出どころの一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof yearTournamentEntries.entitlementSource.enumValues)[number]
    >().toEqualTypeOf<YearEntitlementSource>();
    expect([...yearTournamentEntries.entitlementSource.enumValues]).toEqual([
      ...YEAR_ENTITLEMENT_SOURCES,
    ]);
  });

  test('枠を閉じた理由の列の値がcoreの理由の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof yearTournamentEntries.closeReason.enumValues)[number]
    >().toEqualTypeOf<YearEntryCloseReason>();
    expect([...yearTournamentEntries.closeReason.enumValues]).toEqual([
      ...YEAR_ENTRY_CLOSE_REASONS,
    ]);
  });

  test('返金の状態の列の値がcoreの返金の状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof yearTournamentEntries.refundStatus.enumValues)[number]
    >().toEqualTypeOf<YearRefundStatus>();
    expect([...yearTournamentEntries.refundStatus.enumValues]).toEqual([
      ...YEAR_REFUND_STATUSES,
    ]);
  });

  test('返金の知らせの状態の列の値がcoreの知らせの状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof yearTournamentEntries.refundNoticeStatus.enumValues)[number]
    >().toEqualTypeOf<YearRefundNoticeStatus>();
    expect([...yearTournamentEntries.refundNoticeStatus.enumValues]).toEqual([
      ...YEAR_REFUND_NOTICE_STATUSES,
    ]);
  });
});
