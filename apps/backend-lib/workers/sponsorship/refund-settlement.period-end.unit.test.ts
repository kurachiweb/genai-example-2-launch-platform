import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { sponsorshipRefundRequestKey } from './refund-settlement.ts';
import {
  recordSponsorshipEvents,
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from './testing/observability-recording.ts';
import {
  acceptRemainingOnly,
  accepted,
  at,
  date,
  DISPLAY_STOP_KEY,
  PRODUCT_ID,
  PURCHASE_ID,
  recordOf,
  rejected,
  settlementHarness,
  SPONSORSHIP_ID,
  statementOf,
  tagsOf,
  TERMINATION_KEY,
  THREE_DAY_STOP,
  USER_ID,
} from './testing/refund-settlement-harness.ts';

let events: Event[] = [];

beforeEach(() => {
  resetSponsorshipObservability();
  recordSponsorshipLogs('api');
  events = recordSponsorshipEvents();
});

afterEach(() => {
  resetSponsorshipObservability();
});

describe('sponsorshipRefundRequestKey', () => {
  test('依頼キーはsponsorship:<購入ID>:<理由>の形にする', () => {
    expect(
      sponsorshipRefundRequestKey(PURCHASE_ID, 'sponsorship_terminated'),
    ).toBe(TERMINATION_KEY);
    expect(
      sponsorshipRefundRequestKey(PURCHASE_ID, 'sponsorship_display_stopped'),
    ).toBe(DISPLAY_STOP_KEY);
  });
});

describe('D1RefundSettlement.planPeriodEnd', () => {
  test('掲載期間の表示停止日数分の金額を、表示停止の依頼キーと理由で依頼する', async () => {
    const { settlement, statements, displayStops } = settlementHarness({
      intervals: [THREE_DAY_STOP],
    });

    const plan = await settlement.planPeriodEnd(recordOf());

    expect(displayStops.inputs).toEqual([
      {
        productId: PRODUCT_ID,
        userId: USER_ID,
        from: at('2026-12-01T00:00:00'),
        to: at('2026-12-11T00:00:00'),
      },
    ]);
    expect(statements.calls).toEqual([
      {
        purchaseId: PURCHASE_ID,
        amount: 3_000,
        reason: 'sponsorship_display_stopped',
        requestKey: DISPLAY_STOP_KEY,
      },
    ]);
    expect(plan).toEqual({
      kind: 'display_stop',
      days: 3,
      amount: 3_000,
      status: 'requested',
      refundRequestId: 'refund-sponsorship_display_stopped',
      statements: [statementOf('refund-sponsorship_display_stopped')],
      incident: null,
    });
  });

  test('区間の時点を基準時刻の日付に直し、0:00ちょうどの終わりの日は含めず、重なった日を1日と数える', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [
        // 掲載開始日の0:00ちょうどに終わった区間は掲載期間の日を含まない
        {
          startedAt: at('2026-11-28T12:00:00'),
          endedAt: at('2026-12-01T00:00:00'),
        },
        // 12-02の23:59から12-04の0:00ちょうどまでは12-02・12-03の2日
        {
          startedAt: at('2026-12-02T23:59:00'),
          endedAt: at('2026-12-04T00:00:00'),
        },
        // 投稿者の停止が同じ日に重なっても1日
        {
          startedAt: at('2026-12-03T12:00:00'),
          endedAt: at('2026-12-03T13:00:00'),
        },
        // 継続中の区間は掲載終了日まで(12-09・12-10の2日)
        { startedAt: at('2026-12-09T08:00:00'), endedAt: null },
      ],
    });

    const plan = await settlement.planPeriodEnd(recordOf());

    expect(plan.days).toBe(4);
    expect(statements.calls.map(({ amount }) => amount)).toEqual([4_000]);
  });

  test('終わりが始まり以前の区間は数えない', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [
        {
          startedAt: at('2026-12-03T00:00:00'),
          endedAt: at('2026-12-03T00:00:00'),
        },
        {
          startedAt: at('2026-12-05T10:00:00'),
          endedAt: at('2026-12-05T09:00:00'),
        },
      ],
    });

    const plan = await settlement.planPeriodEnd(recordOf());

    expect(plan).toMatchObject({ days: 0, amount: 0, status: 'not_needed' });
    expect(statements.calls).toEqual([]);
  });

  test('金額はセント未満を切り捨てる', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [
        {
          startedAt: at('2026-12-02T10:00:00'),
          endedAt: at('2026-12-02T11:00:00'),
        },
      ],
    });

    const plan = await settlement.planPeriodEnd(
      recordOf({ amountTotal: 9_999, endsOn: date('2026-12-07'), days: 7 }),
    );

    expect(plan.amount).toBe(1_428);
    expect(statements.calls.map(({ amount }) => amount)).toEqual([1_428]);
  });

  test('返金額が0なら依頼せず返金不要にし、知らせない', async () => {
    const { settlement, statements, refunds } = settlementHarness();

    const plan = await settlement.planPeriodEnd(recordOf());
    await settlement.dispatch([plan]);

    expect(plan).toEqual({
      kind: 'display_stop',
      days: 0,
      amount: 0,
      status: 'not_needed',
      refundRequestId: null,
      statements: [],
      incident: null,
    });
    expect(statements.calls).toEqual([]);
    expect(refunds.dispatched).toEqual([]);
    expect(events).toEqual([]);
  });

  test('プロダクトの論理削除がある広告は依頼せず返金不要にする', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [THREE_DAY_STOP],
    });

    const plan = await settlement.planPeriodEnd(
      recordOf({ productDeletedAt: at('2026-12-08T10:00:00') }),
    );

    expect(plan).toMatchObject({
      days: 3,
      amount: 3_000,
      status: 'not_needed',
      refundRequestId: null,
      statements: [],
      incident: null,
    });
    expect(statements.calls).toEqual([]);
  });

  test('購入の無い申込は依頼せず返金不要にする', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [THREE_DAY_STOP],
    });

    const plan = await settlement.planPeriodEnd(recordOf({ purchaseId: null }));

    expect(plan).toMatchObject({ status: 'not_needed', statements: [] });
    expect(statements.calls).toEqual([]);
  });

  test('同じ依頼キーの2回目は決済の機能が返す既存の依頼を依頼済みとし、新しい文を作らない', async () => {
    const { settlement } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: () => accepted('refund-existing', true),
    });

    const plan = await settlement.planPeriodEnd(recordOf());

    expect(plan).toMatchObject({
      status: 'requested',
      refundRequestId: 'refund-existing',
      statements: [],
    });
  });

  test('残りを超える拒否は残りの全額で1回だけ依頼し直し、受け付けられれば金額を記録しない依頼済みにする', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: acceptRemainingOnly,
    });

    const plan = await settlement.planPeriodEnd(recordOf());
    await settlement.dispatch([plan]);

    expect(statements.calls).toEqual([
      {
        purchaseId: PURCHASE_ID,
        amount: 3_000,
        reason: 'sponsorship_display_stopped',
        requestKey: DISPLAY_STOP_KEY,
      },
      {
        purchaseId: PURCHASE_ID,
        amount: null,
        reason: 'sponsorship_display_stopped',
        requestKey: DISPLAY_STOP_KEY,
      },
    ]);
    expect(plan).toEqual({
      kind: 'display_stop',
      days: 3,
      amount: null,
      status: 'requested',
      refundRequestId: 'refund-remaining',
      statements: [statementOf('refund-remaining')],
      incident: null,
    });
    expect(events).toEqual([]);
  });

  test('依頼し直しも残りを超えて拒否されれば返金済みにし、確定の後の送信で警告を1回だけ知らせる', async () => {
    const { settlement, statements, refunds } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: () => rejected('amount_exceeds_refundable'),
    });

    const plan = await settlement.planPeriodEnd(recordOf());

    expect(statements.calls.map(({ amount }) => amount)).toEqual([3_000, null]);
    expect(plan).toEqual({
      kind: 'display_stop',
      days: 3,
      amount: 3_000,
      status: 'already_refunded',
      refundRequestId: null,
      statements: [],
      incident: {
        incident: 'refund-already-settled',
        sponsorshipId: SPONSORSHIP_ID,
        code: 'amount_exceeds_refundable',
      },
    });
    expect(events).toEqual([]);

    await settlement.dispatch([plan]);

    expect(refunds.dispatched).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('warning');
    expect(events[0]?.fingerprint).toEqual([
      'sponsorship',
      'refund-already-settled',
    ]);
    expect(tagsOf(events[0])).toEqual({
      sponsorship_incident: 'refund-already-settled',
      sponsorship_id: SPONSORSHIP_ID,
      refund_kind: 'display_stop',
      refund_code: 'amount_exceeds_refundable',
    });
  });

  test.each(['not_paid', 'purchase_not_found'] as const)(
    '%sの拒否は依頼し直さず返金不要にし、知らせない',
    async (code) => {
      const { settlement, statements } = settlementHarness({
        intervals: [THREE_DAY_STOP],
        respond: () => rejected(code),
      });

      const plan = await settlement.planPeriodEnd(recordOf());
      await settlement.dispatch([plan]);

      expect(statements.calls).toHaveLength(1);
      expect(plan).toMatchObject({
        days: 3,
        amount: 3_000,
        status: 'not_needed',
        refundRequestId: null,
        statements: [],
        incident: null,
      });
      expect(events).toEqual([]);
    },
  );

  test.each(['invalid_amount', 'invalid_request_key'] as const)(
    '%sの拒否は拒否にし、確定の後の送信でエラーを知らせる',
    async (code) => {
      const { settlement, statements } = settlementHarness({
        intervals: [THREE_DAY_STOP],
        respond: () => rejected(code),
      });

      const plan = await settlement.planPeriodEnd(recordOf());
      await settlement.dispatch([plan]);

      expect(statements.calls).toHaveLength(1);
      expect(plan).toMatchObject({ status: 'rejected', statements: [] });
      expect(events).toHaveLength(1);
      expect(events[0]?.level).toBe('error');
      expect(events[0]?.fingerprint).toEqual([
        'sponsorship',
        'refund-rejected',
      ]);
      expect(tagsOf(events[0])).toMatchObject({
        refund_kind: 'display_stop',
        refund_code: code,
      });
    },
  );

  test('理由の形式違反の例外は拒否にし、invalid_reasonとしてエラーを知らせる', async () => {
    const { settlement } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: () => new RangeError('返金の理由の形式が誤っている'),
    });

    const plan = await settlement.planPeriodEnd(recordOf());
    await settlement.dispatch([plan]);

    expect(plan).toMatchObject({
      status: 'rejected',
      incident: {
        incident: 'refund-rejected',
        sponsorshipId: SPONSORSHIP_ID,
        code: 'invalid_reason',
      },
    });
    expect(tagsOf(events[0])).toMatchObject({ refund_code: 'invalid_reason' });
  });

  test('依頼し直しで理由の形式違反の例外になっても拒否にする', async () => {
    const { settlement } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: (input) =>
        input.amount === null
          ? new RangeError('返金の理由の形式が誤っている')
          : rejected('amount_exceeds_refundable'),
    });

    const plan = await settlement.planPeriodEnd(recordOf());

    expect(plan).toMatchObject({
      status: 'rejected',
      incident: { incident: 'refund-rejected', code: 'invalid_reason' },
    });
  });

  test('拒否でも理由の形式違反でもない例外はそのまま投げる', async () => {
    const failure = new Error('データベースに接続できない');
    const { settlement } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: () => failure,
    });

    const thrown = await settlement.planPeriodEnd(recordOf()).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBe(failure);
  });
});
