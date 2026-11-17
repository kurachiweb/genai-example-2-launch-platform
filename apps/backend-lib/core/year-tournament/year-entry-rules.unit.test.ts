import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  isAcceptableRequestKey,
  isRefundReason,
} from '../payments/refund-rules.ts';
import {
  type RefundRejectionCode,
  refundRejectionOutcome,
} from '../tournament/refund-rejection.ts';
import {
  GRANTABLE_STATUSES,
  OPEN_ENTRY_STATUSES,
  refundReasonFor,
  YEAR_ENTITLEMENT_SOURCES,
  YEAR_ENTRY_CLOSE_REASONS,
  YEAR_ENTRY_STATUSES,
  YEAR_REFUND_NOTICE_STATUSES,
  YEAR_REFUND_REASONS,
  YEAR_REFUND_STATUSES,
  type YearEntryCloseReason,
  type YearEntryStatus,
  type YearRefundReason,
  type YearRefundStatus,
  yearRefundRequestKey,
} from './year-entry-rules.ts';

const PURCHASE_ID = '01JD0PRCHS0000000000000001';

describe('参加の枠の値の一覧', () => {
  test('枠の状態は受付中・参加資格あり・組み合わせ済み・期限切れ・喪失・除外の6つである', () => {
    expect([...YEAR_ENTRY_STATUSES]).toEqual([
      'awaiting_payment',
      'entitled',
      'drawn',
      'expired',
      'forfeited',
      'excluded',
    ]);
    expectTypeOf<
      (typeof YEAR_ENTRY_STATUSES)[number]
    >().toEqualTypeOf<YearEntryStatus>();
  });

  test('参加資格の出どころは決済とUltrasの2つである', () => {
    expect([...YEAR_ENTITLEMENT_SOURCES]).toEqual(['payment', 'ultras']);
  });

  test('枠を閉じた理由は期限・削除・退会・非公開化と停止・上限・遅れた勝利の6つである', () => {
    expect([...YEAR_ENTRY_CLOSE_REASONS]).toEqual([
      'deadline',
      'deleted',
      'withdrawn',
      'hidden_or_suspended',
      'over_capacity',
      'late_entry',
    ]);
    expectTypeOf<
      (typeof YEAR_ENTRY_CLOSE_REASONS)[number]
    >().toEqualTypeOf<YearEntryCloseReason>();
  });

  test('返金の状態は返金済みと拒否を含む6つ、返金の知らせの状態は4つである', () => {
    expect([...YEAR_REFUND_STATUSES]).toEqual([
      'none',
      'pending',
      'requested',
      'not_needed',
      'already_refunded',
      'rejected',
    ]);
    expectTypeOf<
      (typeof YEAR_REFUND_STATUSES)[number]
    >().toEqualTypeOf<YearRefundStatus>();
    expect([...YEAR_REFUND_NOTICE_STATUSES]).toEqual([
      'none',
      'pending',
      'sent',
      'skipped',
    ]);
  });

  test('値の一覧は書き換えられない', () => {
    expect(Object.isFrozen(YEAR_ENTRY_STATUSES)).toBe(true);
    expect(Object.isFrozen(YEAR_ENTITLEMENT_SOURCES)).toBe(true);
    expect(Object.isFrozen(YEAR_ENTRY_CLOSE_REASONS)).toBe(true);
    expect(Object.isFrozen(YEAR_REFUND_STATUSES)).toBe(true);
    expect(Object.isFrozen(YEAR_REFUND_NOTICE_STATUSES)).toBe(true);
    expect(Object.isFrozen(OPEN_ENTRY_STATUSES)).toBe(true);
    expect(Object.isFrozen(GRANTABLE_STATUSES)).toBe(true);
    expect(Object.isFrozen(YEAR_REFUND_REASONS)).toBe(true);
  });
});

describe('OPEN_ENTRY_STATUSES', () => {
  test('終わっていない状態は受付中と参加資格ありの2つである', () => {
    expect([...OPEN_ENTRY_STATUSES]).toEqual(['awaiting_payment', 'entitled']);
    expectTypeOf<(typeof OPEN_ENTRY_STATUSES)[number]>().toEqualTypeOf<
      'awaiting_payment' | 'entitled'
    >();
  });

  test('組み合わせ済み・期限切れ・喪失・除外の枠は終わっている', () => {
    const closedStatuses: readonly YearEntryStatus[] = [
      'drawn',
      'expired',
      'forfeited',
      'excluded',
    ];

    for (const status of closedStatuses) {
      expect(OPEN_ENTRY_STATUSES).not.toContain(status);
    }
  });
});

describe('GRANTABLE_STATUSES', () => {
  test('参加資格を与えられる状態は受付中だけである', () => {
    expect([...GRANTABLE_STATUSES]).toEqual(['awaiting_payment']);
    expectTypeOf<
      (typeof GRANTABLE_STATUSES)[number]
    >().toEqualTypeOf<'awaiting_payment'>();
  });

  test('参加資格を得た状態は与え直す対象にならず、特典の終了で受付中へ戻らない', () => {
    const entitledStatuses: readonly YearEntryStatus[] = ['entitled', 'drawn'];

    for (const status of entitledStatuses) {
      expect(GRANTABLE_STATUSES).not.toContain(status);
    }
  });

  test('参加資格を与えられる状態は終わっていない状態に含まれる', () => {
    for (const status of GRANTABLE_STATUSES) {
      expect(OPEN_ENTRY_STATUSES).toContain(status);
    }
  });
});

describe('refundReasonFor', () => {
  test('組み合わせ決定の前の資格の喪失はentitlement_lostになる', () => {
    expect(refundReasonFor('forfeited', 'deleted')).toBe('entitlement_lost');
    expect(refundReasonFor('forfeited', 'withdrawn')).toBe('entitlement_lost');
  });

  test('組み合わせ決定の時点の非公開化と停止による除外はentitlement_suspendedになる', () => {
    expect(refundReasonFor('excluded', 'hidden_or_suspended')).toBe(
      'entitlement_suspended',
    );
  });

  test('参加数の上限による除外はcapacity_exceededになる', () => {
    expect(refundReasonFor('excluded', 'over_capacity')).toBe(
      'capacity_exceeded',
    );
  });

  test('返金の理由を持つのは喪失と除外だけで、参加資格を得た枠・組み合わせ済みの枠・期限切れの枠は返金の対象にならない', () => {
    expectTypeOf<Parameters<typeof refundReasonFor>[0]>().toEqualTypeOf<
      'forfeited' | 'excluded'
    >();
    expectTypeOf<YearRefundReason>().toEqualTypeOf<
      'entitlement_lost' | 'entitlement_suspended' | 'capacity_exceeded'
    >();
  });

  test('返金の理由の一覧は喪失と除外から導く理由とちょうど一致する', () => {
    expect([...YEAR_REFUND_REASONS]).toEqual([
      'entitlement_lost',
      'entitlement_suspended',
      'capacity_exceeded',
    ]);
    expect(
      new Set([
        refundReasonFor('forfeited', 'deleted'),
        refundReasonFor('excluded', 'hidden_or_suspended'),
        refundReasonFor('excluded', 'over_capacity'),
      ]),
    ).toEqual(new Set(YEAR_REFUND_REASONS));
    expectTypeOf<
      (typeof YEAR_REFUND_REASONS)[number]
    >().toEqualTypeOf<YearRefundReason>();
  });

  test('返金の理由は決済の機能が受け付ける理由の形式に合う', () => {
    for (const reason of YEAR_REFUND_REASONS) {
      expect(isRefundReason(reason)).toBe(true);
    }
  });
});

describe('yearRefundRequestKey', () => {
  test('依頼キーはtournament-year:<購入ID>:<理由>になる', () => {
    expect(yearRefundRequestKey(PURCHASE_ID, 'entitlement_lost')).toBe(
      `tournament-year:${PURCHASE_ID}:entitlement_lost`,
    );
    expect(yearRefundRequestKey(PURCHASE_ID, 'entitlement_suspended')).toBe(
      `tournament-year:${PURCHASE_ID}:entitlement_suspended`,
    );
    expect(yearRefundRequestKey(PURCHASE_ID, 'capacity_exceeded')).toBe(
      `tournament-year:${PURCHASE_ID}:capacity_exceeded`,
    );
  });

  test('上限による除外の依頼キーは理由の写像を通しても同じになる', () => {
    expect(
      yearRefundRequestKey(
        PURCHASE_ID,
        refundReasonFor('excluded', 'over_capacity'),
      ),
    ).toBe(`tournament-year:${PURCHASE_ID}:capacity_exceeded`);
  });

  test('依頼キーは決済の機能が依頼元から受け付ける鍵の形式に合う', () => {
    for (const reason of YEAR_REFUND_REASONS) {
      expect(
        isAcceptableRequestKey(yearRefundRequestKey(PURCHASE_ID, reason)),
      ).toBe(true);
    }
  });
});

describe('共用の返金の拒否の写像との対応', () => {
  test('拒否の分類の結果の返金の状態はYearの枠の返金の状態の値に含まれる', () => {
    const codes: readonly RefundRejectionCode[] = [
      'not_paid',
      'purchase_not_found',
      'amount_exceeds_refundable',
      'invalid_amount',
      'invalid_request_key',
    ];

    for (const code of codes) {
      expect(YEAR_REFUND_STATUSES).toContain(
        refundRejectionOutcome(code).refundStatus,
      );
    }
    expectTypeOf<
      ReturnType<typeof refundRejectionOutcome>['refundStatus']
    >().toExtend<YearRefundStatus>();
  });
});
