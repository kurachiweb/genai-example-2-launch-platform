import { describe, expect, expectTypeOf, test } from 'bun:test';

import type { RefundRequestResult } from '../payments/ports.ts';
import {
  type RefundRejectionCode,
  type RefundRejectionOutcome,
  refundRejectionOutcome,
} from './refund-rejection.ts';

describe('refundRejectionOutcome', () => {
  test('拒否の分類の入力は決済の機能の返金の依頼の拒否の値と同じである', () => {
    expectTypeOf<RefundRejectionCode>().toEqualTypeOf<
      Extract<RefundRequestResult, { readonly kind: 'rejected' }>['code']
    >();
  });

  test('支払いが無い拒否は返金を不要にし、運用者へ知らせない', () => {
    expect(refundRejectionOutcome('not_paid')).toEqual({
      refundStatus: 'not_needed',
      report: false,
    });
  });

  test('購入が無い拒否は返金を不要にし、運用者へ知らせない', () => {
    expect(refundRejectionOutcome('purchase_not_found')).toEqual({
      refundStatus: 'not_needed',
      report: false,
    });
  });

  test('返金できる残額が無い拒否は返金済みとして依頼を終え、運用者へ知らせる', () => {
    expect(refundRejectionOutcome('amount_exceeds_refundable')).toEqual({
      refundStatus: 'already_refunded',
      report: true,
    });
  });

  test('金額の形式の誤りは拒否として運用者へ知らせる', () => {
    expect(refundRejectionOutcome('invalid_amount')).toEqual({
      refundStatus: 'rejected',
      report: true,
    });
  });

  test('依頼キーの形式の誤りは拒否として運用者へ知らせる', () => {
    expect(refundRejectionOutcome('invalid_request_key')).toEqual({
      refundStatus: 'rejected',
      report: true,
    });
  });

  test('分類の結果の返金の状態は再処理の対象(pending)にも知らせの対象(requested)にもならない', () => {
    const codes: readonly RefundRejectionCode[] = [
      'not_paid',
      'purchase_not_found',
      'amount_exceeds_refundable',
      'invalid_amount',
      'invalid_request_key',
    ];
    const statuses: readonly string[] = codes.map(
      (code) => refundRejectionOutcome(code).refundStatus,
    );

    expect(statuses).not.toContain('pending');
    expect(statuses).not.toContain('requested');
    expectTypeOf<RefundRejectionOutcome['refundStatus']>().toEqualTypeOf<
      'not_needed' | 'already_refunded' | 'rejected'
    >();
  });

  test('分類の結果は書き換えられない', () => {
    expect(Object.isFrozen(refundRejectionOutcome('not_paid'))).toBe(true);
  });
});
