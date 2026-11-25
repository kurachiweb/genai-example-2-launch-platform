import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { LogObject } from '../../core/logging/log-record.ts';
import { type RefundPlan, refundOutcomeOf } from './refund-settlement.ts';
import {
  recordSponsorshipEvents,
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from './testing/observability-recording.ts';
import {
  acceptRemainingOnly,
  accepted,
  AMOUNT_TOTAL,
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
let logs: LogObject[] = [];

beforeEach(() => {
  resetSponsorshipObservability();
  logs = recordSponsorshipLogs('api');
  events = recordSponsorshipEvents();
});

afterEach(() => {
  resetSponsorshipObservability();
});

describe('D1RefundSettlement.planTermination', () => {
  test('未掲載日数分と強制終了日の前日までの表示停止日数分を、それぞれの依頼キーで順に依頼する', async () => {
    const { settlement, statements, displayStops } = settlementHarness({
      intervals: [{ startedAt: at('2026-12-04T10:00:00'), endedAt: null }],
    });

    const plans = await settlement.planTermination(
      recordOf(),
      date('2026-12-06'),
    );

    expect(displayStops.inputs).toEqual([
      {
        productId: PRODUCT_ID,
        userId: USER_ID,
        from: at('2026-12-01T00:00:00'),
        to: at('2026-12-06T00:00:00'),
      },
    ]);
    expect(statements.calls).toEqual([
      {
        purchaseId: PURCHASE_ID,
        amount: 5_000,
        reason: 'sponsorship_terminated',
        requestKey: TERMINATION_KEY,
      },
      {
        purchaseId: PURCHASE_ID,
        amount: 2_000,
        reason: 'sponsorship_display_stopped',
        requestKey: DISPLAY_STOP_KEY,
      },
    ]);
    expect(plans).toEqual({
      termination: {
        kind: 'termination',
        days: 5,
        amount: 5_000,
        status: 'requested',
        refundRequestId: 'refund-sponsorship_terminated',
        statements: [statementOf('refund-sponsorship_terminated')],
        incident: null,
      },
      displayStop: {
        kind: 'display_stop',
        days: 2,
        amount: 2_000,
        status: 'requested',
        refundRequestId: 'refund-sponsorship_display_stopped',
        statements: [statementOf('refund-sponsorship_display_stopped')],
        incident: null,
      },
    });
  });

  test('未掲載日数と表示停止日数は同じ日を含まず、合計が支払った金額を超えない', async () => {
    const { settlement } = settlementHarness({
      intervals: [{ startedAt: at('2026-12-01T00:00:00'), endedAt: null }],
    });

    const plans = await settlement.planTermination(
      recordOf(),
      date('2026-12-04'),
    );

    expect(plans.termination).toMatchObject({ days: 7, amount: 7_000 });
    expect(plans.displayStop).toMatchObject({ days: 3, amount: 3_000 });
  });

  test('掲載開始前の強制終了は全日数を未掲載日数とし、表示停止の区間を読まずに返金不要にする', async () => {
    const { settlement, statements, displayStops } = settlementHarness({
      intervals: [THREE_DAY_STOP],
    });

    const plans = await settlement.planTermination(
      recordOf(),
      date('2026-11-28'),
    );

    expect(displayStops.inputs).toEqual([]);
    expect(statements.calls.map(({ reason }) => reason)).toEqual([
      'sponsorship_terminated',
    ]);
    expect(plans.termination).toMatchObject({
      days: 10,
      amount: AMOUNT_TOTAL,
      status: 'requested',
    });
    expect(plans.displayStop).toMatchObject({
      days: 0,
      amount: 0,
      status: 'not_needed',
    });
  });

  test('強制終了の返金が残りの全額で受け付けられれば、表示停止は依頼せず返金済みにし、表示停止の分の警告を1回だけ知らせる', async () => {
    const { settlement, statements, refunds } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: acceptRemainingOnly,
    });

    const plans = await settlement.planTermination(
      recordOf(),
      date('2026-12-08'),
    );
    await settlement.dispatch([plans.termination, plans.displayStop]);

    expect(statements.calls.map(({ reason }) => reason)).toEqual([
      'sponsorship_terminated',
      'sponsorship_terminated',
    ]);
    expect(plans.termination).toMatchObject({
      days: 3,
      amount: null,
      status: 'requested',
      refundRequestId: 'refund-remaining',
    });
    expect(plans.displayStop).toEqual({
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
    expect(refunds.dispatched).toEqual(['refund-remaining']);
    expect(events).toHaveLength(1);
    expect(tagsOf(events[0])).toMatchObject({
      sponsorship_incident: 'refund-already-settled',
      refund_kind: 'display_stop',
    });
  });

  test('強制終了の返金が返金済みになれば、表示停止は依頼せず返金済みにし、種類ごとに警告を1回ずつ知らせる', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: () => rejected('amount_exceeds_refundable'),
    });

    const plans = await settlement.planTermination(
      recordOf(),
      date('2026-12-08'),
    );
    await settlement.dispatch([plans.termination, plans.displayStop]);

    expect(statements.calls.map(({ reason }) => reason)).toEqual([
      'sponsorship_terminated',
      'sponsorship_terminated',
    ]);
    expect(plans.termination.status).toBe('already_refunded');
    expect(plans.displayStop).toMatchObject({
      status: 'already_refunded',
      statements: [],
    });
    expect(events.map((event) => tagsOf(event)?.refund_kind)).toEqual([
      'termination',
      'display_stop',
    ]);
  });

  test('強制終了の返金が残りの全額でも、表示停止の返金額が0なら返金不要にして知らせない', async () => {
    const { settlement } = settlementHarness({
      respond: acceptRemainingOnly,
    });

    const plans = await settlement.planTermination(
      recordOf(),
      date('2026-12-08'),
    );
    await settlement.dispatch([plans.termination, plans.displayStop]);

    expect(plans.displayStop).toMatchObject({
      days: 0,
      amount: 0,
      status: 'not_needed',
      incident: null,
    });
    expect(events).toEqual([]);
  });

  test('強制終了の返金が拒否なら、表示停止の返金はそのまま依頼する', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [THREE_DAY_STOP],
      respond: (input) =>
        input.reason === 'sponsorship_terminated'
          ? rejected('invalid_amount')
          : accepted('refund-stop'),
    });

    const plans = await settlement.planTermination(
      recordOf(),
      date('2026-12-08'),
    );

    expect(statements.calls).toHaveLength(2);
    expect(plans.termination.status).toBe('rejected');
    expect(plans.displayStop).toMatchObject({
      status: 'requested',
      refundRequestId: 'refund-stop',
    });
  });

  test('プロダクトの論理削除がある広告の表示停止は依頼せず返金不要にする', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [THREE_DAY_STOP],
    });

    const plans = await settlement.planTermination(
      recordOf({ productDeletedAt: at('2026-12-07T10:00:00') }),
      date('2026-12-08'),
    );

    expect(statements.calls.map(({ reason }) => reason)).toEqual([
      'sponsorship_terminated',
    ]);
    expect(plans.displayStop).toMatchObject({
      status: 'not_needed',
      statements: [],
    });
  });
});

describe('D1RefundSettlement.estimateTermination', () => {
  test('確定と同じ日数と金額を、決済の機能を呼ばずに返す', async () => {
    const { settlement, statements } = settlementHarness({
      intervals: [{ startedAt: at('2026-12-04T10:00:00'), endedAt: null }],
    });

    const estimate = await settlement.estimateTermination(
      recordOf(),
      date('2026-12-06'),
    );

    expect(estimate).toEqual({
      unexposedDays: 5,
      refundEstimate: 5_000,
      stoppedDays: 2,
      stopRefundAmount: 2_000,
    });
    expect(statements.calls).toEqual([]);
  });
});

describe('D1RefundSettlement.dispatch', () => {
  test('依頼済みの返金だけを送り、送信の失敗は警告のログにして残りを送る', async () => {
    const { settlement, refunds } = settlementHarness({
      failingDispatch: new Set(['refund-a']),
    });
    const plans: RefundPlan[] = [
      {
        kind: 'termination',
        days: 3,
        amount: 3_000,
        status: 'requested',
        refundRequestId: 'refund-a',
        statements: [],
        incident: null,
      },
      {
        kind: 'display_stop',
        days: 0,
        amount: 0,
        status: 'not_needed',
        refundRequestId: null,
        statements: [],
        incident: null,
      },
      {
        kind: 'display_stop',
        days: 2,
        amount: 2_000,
        status: 'requested',
        refundRequestId: 'refund-b',
        statements: [],
        incident: null,
      },
    ];

    await settlement.dispatch(plans);

    expect(refunds.dispatched).toEqual(['refund-a', 'refund-b']);
    expect(
      logs.map(({ level, category, refundRequestId, refundKind }) => ({
        level,
        category,
        refundRequestId,
        refundKind,
      })),
    ).toEqual([
      {
        level: 'warning',
        category: 'api.sponsorship.refund',
        refundRequestId: 'refund-a',
        refundKind: 'termination',
      },
    ]);
  });
});

describe('refundOutcomeOf', () => {
  test('計画から文と知らせを除いた結果を返す', () => {
    expect(
      refundOutcomeOf({
        kind: 'display_stop',
        days: 3,
        amount: 3_000,
        status: 'already_refunded',
        refundRequestId: null,
        statements: [statementOf('x')],
        incident: {
          incident: 'refund-already-settled',
          sponsorshipId: SPONSORSHIP_ID,
          code: 'amount_exceeds_refundable',
        },
      }),
    ).toEqual({
      kind: 'display_stop',
      days: 3,
      amount: 3_000,
      status: 'already_refunded',
      refundRequestId: null,
    });
  });
});
