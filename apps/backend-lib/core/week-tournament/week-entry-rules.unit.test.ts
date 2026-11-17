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
  refundReasonFor,
  ultrasExemptionPeriodOf,
  WEEK_ENTITLEMENT_SOURCES,
  WEEK_ENTRY_CLOSE_REASONS,
  WEEK_ENTRY_STATUSES,
  WEEK_REFUND_NOTICE_STATUSES,
  WEEK_REFUND_REASONS,
  WEEK_REFUND_STATUSES,
  type WeekEntryStatus,
  type WeekRefundReason,
  type WeekRefundStatus,
  weekRefundRequestKey,
} from './week-entry-rules.ts';

const PURCHASE_ID = '01JD0PRCHS0000000000000001';

const WON_AT = new Date('2026-09-13T14:30:00.000Z');
const DEADLINE_AT = new Date('2026-09-14T14:35:00.000Z');

describe('参加の枠の値の一覧', () => {
  test('枠の状態は受付中・参加資格あり・組み合わせ済み・期限切れ・喪失・除外の6つである', () => {
    expect([...WEEK_ENTRY_STATUSES]).toEqual([
      'awaiting_payment',
      'entitled',
      'drawn',
      'expired',
      'forfeited',
      'excluded',
    ]);
  });

  test('参加資格の出どころは決済とUltrasの2つである', () => {
    expect([...WEEK_ENTITLEMENT_SOURCES]).toEqual(['payment', 'ultras']);
  });

  test('枠を閉じた理由は期限・削除・退会・非公開化と停止・遅れた勝利の5つである', () => {
    expect([...WEEK_ENTRY_CLOSE_REASONS]).toEqual([
      'deadline',
      'deleted',
      'withdrawn',
      'hidden_or_suspended',
      'late_entry',
    ]);
  });

  test('返金の状態は6つ、返金の知らせの状態は4つである', () => {
    expect([...WEEK_REFUND_STATUSES]).toEqual([
      'none',
      'pending',
      'requested',
      'not_needed',
      'already_refunded',
      'rejected',
    ]);
    expect([...WEEK_REFUND_NOTICE_STATUSES]).toEqual([
      'none',
      'pending',
      'sent',
      'skipped',
    ]);
  });

  test('値の一覧は書き換えられない', () => {
    expect(Object.isFrozen(WEEK_ENTRY_STATUSES)).toBe(true);
    expect(Object.isFrozen(WEEK_ENTITLEMENT_SOURCES)).toBe(true);
    expect(Object.isFrozen(WEEK_ENTRY_CLOSE_REASONS)).toBe(true);
    expect(Object.isFrozen(WEEK_REFUND_STATUSES)).toBe(true);
    expect(Object.isFrozen(WEEK_REFUND_NOTICE_STATUSES)).toBe(true);
    expect(Object.isFrozen(GRANTABLE_STATUSES)).toBe(true);
    expect(Object.isFrozen(WEEK_REFUND_REASONS)).toBe(true);
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
    const entitledStatuses: readonly WeekEntryStatus[] = ['entitled', 'drawn'];

    for (const status of entitledStatuses) {
      expect(GRANTABLE_STATUSES).not.toContain(status);
    }
  });

  test('閉じた枠は参加資格を与えられる状態に含まれない', () => {
    const closedStatuses: readonly WeekEntryStatus[] = [
      'expired',
      'forfeited',
      'excluded',
    ];

    for (const status of closedStatuses) {
      expect(GRANTABLE_STATUSES).not.toContain(status);
    }
  });
});

describe('refundReasonFor', () => {
  test('組み合わせ決定の前の資格の喪失はentitlement_lostになる', () => {
    expect(refundReasonFor('forfeited')).toBe('entitlement_lost');
  });

  test('組み合わせ決定の時点の資格の停止はentitlement_suspendedになる', () => {
    expect(refundReasonFor('excluded')).toBe('entitlement_suspended');
  });

  test('返金の理由を持つのは喪失と停止だけで、参加資格を得た枠・組み合わせ済みの枠・期限切れの枠は返金の対象にならない', () => {
    expectTypeOf<Parameters<typeof refundReasonFor>[0]>().toEqualTypeOf<
      'forfeited' | 'excluded'
    >();
    expectTypeOf<WeekRefundReason>().toEqualTypeOf<
      'entitlement_lost' | 'entitlement_suspended'
    >();
  });

  test('返金の理由の一覧は喪失と停止から導く理由とちょうど一致する', () => {
    expect([...WEEK_REFUND_REASONS]).toEqual([
      'entitlement_lost',
      'entitlement_suspended',
    ]);
    expect(
      new Set([refundReasonFor('forfeited'), refundReasonFor('excluded')]),
    ).toEqual(new Set(WEEK_REFUND_REASONS));
    expectTypeOf<
      (typeof WEEK_REFUND_REASONS)[number]
    >().toEqualTypeOf<WeekRefundReason>();
  });

  test('返金の理由は決済の機能が受け付ける理由の形式に合う', () => {
    expect(isRefundReason(refundReasonFor('forfeited'))).toBe(true);
    expect(isRefundReason(refundReasonFor('excluded'))).toBe(true);
  });
});

describe('weekRefundRequestKey', () => {
  test('依頼キーはtournament-week:<購入ID>:<理由>になる', () => {
    expect(weekRefundRequestKey(PURCHASE_ID, 'entitlement_lost')).toBe(
      `tournament-week:${PURCHASE_ID}:entitlement_lost`,
    );
    expect(weekRefundRequestKey(PURCHASE_ID, 'entitlement_suspended')).toBe(
      `tournament-week:${PURCHASE_ID}:entitlement_suspended`,
    );
  });

  test('同じ購入と理由なら経路によらず同じ依頼キーになる', () => {
    expect(
      weekRefundRequestKey(PURCHASE_ID, refundReasonFor('forfeited')),
    ).toBe(weekRefundRequestKey(PURCHASE_ID, 'entitlement_lost'));
  });

  test('依頼キーは決済の機能が依頼元から受け付ける鍵の形式に合う', () => {
    expect(
      isAcceptableRequestKey(
        weekRefundRequestKey(PURCHASE_ID, 'entitlement_suspended'),
      ),
    ).toBe(true);
  });
});

describe('共用の返金の拒否の写像との対応', () => {
  test('拒否の分類の結果の返金の状態はWeekの枠の返金の状態の値に含まれる', () => {
    const codes: readonly RefundRejectionCode[] = [
      'not_paid',
      'purchase_not_found',
      'amount_exceeds_refundable',
      'invalid_amount',
      'invalid_request_key',
    ];

    for (const code of codes) {
      expect(WEEK_REFUND_STATUSES).toContain(
        refundRejectionOutcome(code).refundStatus,
      );
    }
    expectTypeOf<
      ReturnType<typeof refundRejectionOutcome>['refundStatus']
    >().toExtend<WeekRefundStatus>();
  });
});

describe('ultrasExemptionPeriodOf', () => {
  test('現在を渡さなければ、勝利の確定から決済期限までを期間にする', () => {
    expect(ultrasExemptionPeriodOf(WON_AT, DEADLINE_AT)).toEqual({
      from: WON_AT,
      to: DEADLINE_AT,
    });
  });

  test('決済期限の前の現在なら、勝利の確定から現在までを期間にする', () => {
    const now = new Date('2026-09-14T03:00:00.000Z');

    expect(ultrasExemptionPeriodOf(WON_AT, DEADLINE_AT, now)).toEqual({
      from: WON_AT,
      to: now,
    });
  });

  test('決済期限の後の現在なら、終わりを決済期限で止める', () => {
    const now = new Date('2026-09-14T15:00:00.000Z');

    expect(ultrasExemptionPeriodOf(WON_AT, DEADLINE_AT, now)).toEqual({
      from: WON_AT,
      to: DEADLINE_AT,
    });
  });

  test('勝利の確定が期間の終わりと同時なら、その一瞬を期間にする', () => {
    expect(ultrasExemptionPeriodOf(DEADLINE_AT, DEADLINE_AT)).toEqual({
      from: DEADLINE_AT,
      to: DEADLINE_AT,
    });
    expect(ultrasExemptionPeriodOf(WON_AT, DEADLINE_AT, WON_AT)).toEqual({
      from: WON_AT,
      to: WON_AT,
    });
  });

  test('決済期限の後に確定した勝利は期間が空でnullになる', () => {
    const lateWonAt = new Date(DEADLINE_AT.getTime() + 1);

    expect(ultrasExemptionPeriodOf(lateWonAt, DEADLINE_AT)).toBeNull();
    expect(
      ultrasExemptionPeriodOf(
        lateWonAt,
        DEADLINE_AT,
        new Date('2026-09-15T00:00:00.000Z'),
      ),
    ).toBeNull();
  });

  test('現在より後に確定した勝利は期間が空でnullになる', () => {
    const now = new Date(WON_AT.getTime() - 1);

    expect(ultrasExemptionPeriodOf(WON_AT, DEADLINE_AT, now)).toBeNull();
  });

  test('期間は書き換えられない', () => {
    expect(Object.isFrozen(ultrasExemptionPeriodOf(WON_AT, DEADLINE_AT))).toBe(
      true,
    );
  });
});
