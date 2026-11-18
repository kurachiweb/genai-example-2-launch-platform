import { describe, expect, test } from 'bun:test';

import type { RefundRequestInput } from '../../../core/payments/ports.ts';
import {
  acceptRemainingOnly,
  accepted,
  at,
  date,
  PURCHASE_ID,
  recordOf,
  rejected,
  settlementHarness,
  statementOf,
  tagsOf,
  THREE_DAY_STOP,
} from './refund-settlement-harness.ts';

const INPUT: RefundRequestInput = {
  purchaseId: PURCHASE_ID,
  amount: null,
  reason: 'sponsorship_terminated',
  requestKey: `sponsorship:${PURCHASE_ID}:sponsorship_terminated`,
};

const LIST_INPUT = {
  productId: 'product',
  userId: 'user',
  from: at('2026-12-01T00:00:00'),
  to: at('2026-12-11T00:00:00'),
};

describe('settlementHarness', () => {
  test('既定では依頼をrefund-<理由>の識別子で受け付け、受け取った入力を記録する', async () => {
    const { statements } = settlementHarness();

    const prepared = await statements.prepare(INPUT);

    expect(prepared).toEqual(accepted('refund-sponsorship_terminated'));
    expect(statements.calls).toEqual([INPUT]);
  });

  test('応答の関数が例外を返すと、準備の失敗にする', async () => {
    const failure = new Error('準備できない');
    const { statements } = settlementHarness({ respond: () => failure });

    const rejection = await statements
      .prepare(INPUT)
      .catch((error: unknown) => error);

    expect(rejection).toBe(failure);
  });

  test('送信に失敗させる依頼だけを拒否し、送信した依頼を順に記録する', async () => {
    const { refunds } = settlementHarness({
      failingDispatch: new Set(['refund-b']),
    });

    await refunds.dispatch('refund-a');
    const rejection = await refunds
      .dispatch('refund-b')
      .catch((error: unknown) => error);

    expect(rejection).toMatchObject({ message: '送信できない' });
    expect(refunds.dispatched).toEqual(['refund-a', 'refund-b']);
  });

  test('表示停止の区間の読み取りは与えた区間を返し、入力を記録する', async () => {
    const { displayStops } = settlementHarness({
      intervals: [THREE_DAY_STOP],
    });

    const intervals = await displayStops.listOverlapping(LIST_INPUT);

    expect(intervals).toEqual([THREE_DAY_STOP]);
    expect(displayStops.inputs).toEqual([LIST_INPUT]);
  });

  test('精算で使わない口は呼ぶと例外になる', () => {
    const { statements, refunds, displayStops } = settlementHarness();

    expect(() => statements.prepareForReflection()).toThrow(
      'テストでは使わない',
    );
    expect(() => refunds.request()).toThrow('テストでは使わない');
    expect(() => refunds.redispatch()).toThrow('テストでは使わない');
    expect(() => displayStops.deleteSubject()).toThrow('テストでは使わない');
    expect(() => displayStops.deleteEndedBefore()).toThrow(
      'テストでは使わない',
    );
  });
});

describe('応答の補助', () => {
  test('重複の受け付けは文を持たない', () => {
    expect(accepted('refund-a', true)).toEqual({
      kind: 'accepted',
      refundRequestId: 'refund-a',
      duplicate: true,
      statements: [],
    });
    expect(accepted('refund-a')).toMatchObject({
      duplicate: false,
      statements: [statementOf('refund-a')],
    });
  });

  test('acceptRemainingOnlyは残りの全額の依頼だけを受け付ける', () => {
    expect(acceptRemainingOnly(INPUT)).toEqual(accepted('refund-remaining'));
    expect(acceptRemainingOnly({ ...INPUT, amount: 1_000 })).toEqual(
      rejected('amount_exceeds_refundable'),
    );
  });
});

describe('値の補助', () => {
  test('atは基準時刻(UTC-08:00)の日時を時点にする', () => {
    expect(at('2026-12-04T10:00:00').toISOString()).toBe(
      '2026-12-04T18:00:00.000Z',
    );
  });

  test('recordOfは既定の申込に上書きを重ねる', () => {
    expect(recordOf({ tier: 'legend' })).toMatchObject({
      tier: 'legend',
      startsOn: date('2026-12-01'),
      endsOn: date('2026-12-10'),
      days: 10,
    });
  });

  test('tagsOfはイベントの無いときに未定義を返す', () => {
    expect(tagsOf(undefined)).toBeUndefined();
    expect(tagsOf({ tags: { refund_kind: 'termination' } })).toEqual({
      refund_kind: 'termination',
    });
  });
});
