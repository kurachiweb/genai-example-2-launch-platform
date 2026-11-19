import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  SPONSORSHIP_STATES,
  type SponsorshipState,
} from '../../../common-lib/sponsorship/sponsorship-status.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import {
  SPONSORSHIP_REFUND_STATUSES,
  type SponsorshipRefundRecord,
} from '../../core/sponsorship/ports.ts';

// common-libとcoreはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧と型の一致をここで確かめる
describe('スポンサー広告の申込のテーブル定義の値の一覧', () => {
  test('申込の状態の列の値がcommon-libの申込の状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof sponsorships.state.enumValues)[number]
    >().toEqualTypeOf<SponsorshipState>();
    expect([...sponsorships.state.enumValues]).toEqual([...SPONSORSHIP_STATES]);
  });

  test.each([
    ['強制終了の返金', sponsorships.terminationRefundStatus],
    ['表示停止の返金', sponsorships.stopRefundStatus],
  ] as const)(
    '%sの状態の列の値がcoreの返金の状態の一覧と同じ順で同じになる',
    (_, column) => {
      expect([...column.enumValues]).toEqual([...SPONSORSHIP_REFUND_STATUSES]);
    },
  );

  test('返金の状態の列の型がcoreの返金の記録の状態の型と同じになる', () => {
    expectTypeOf<
      (typeof sponsorships.terminationRefundStatus.enumValues)[number]
    >().toEqualTypeOf<SponsorshipRefundRecord['status']>();
    expectTypeOf<
      (typeof sponsorships.stopRefundStatus.enumValues)[number]
    >().toEqualTypeOf<SponsorshipRefundRecord['status']>();
  });
});
