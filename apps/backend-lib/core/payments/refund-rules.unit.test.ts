import { describe, expect, test } from 'bun:test';

import {
  isAcceptableRequestKey,
  isRefundReason,
  isReflectionRequestKey,
  reflectionRequestKeyOf,
  refundRecordStatusOf,
  refundRequestReflectionOf,
  toStripeRefundReason,
  validateRefundAmount,
} from './refund-rules.ts';

describe('validateRefundAmount', () => {
  test('金額を省略すると残りの全額にする', () => {
    expect(
      validateRefundAmount({
        requested: null,
        paid: 4900,
        alreadyRequested: 0,
      }),
    ).toEqual({ kind: 'ok', amount: 4900 });
  });

  test('金額を省略すると返金の依頼済みの額を除いた残りにする', () => {
    expect(
      validateRefundAmount({
        requested: null,
        paid: 4900,
        alreadyRequested: 1900,
      }),
    ).toEqual({ kind: 'ok', amount: 3000 });
  });

  test('金額を省略しても残りが無ければamount_exceeds_refundableで拒否する', () => {
    expect(
      validateRefundAmount({
        requested: null,
        paid: 4900,
        alreadyRequested: 4900,
      }),
    ).toEqual({ kind: 'invalid', code: 'amount_exceeds_refundable' });
  });

  test('残りより少ない一部の金額を受け付ける', () => {
    expect(
      validateRefundAmount({
        requested: 1000,
        paid: 4900,
        alreadyRequested: 1900,
      }),
    ).toEqual({ kind: 'ok', amount: 1000 });
  });

  test('残りと同じ金額を受け付ける', () => {
    expect(
      validateRefundAmount({
        requested: 3000,
        paid: 4900,
        alreadyRequested: 1900,
      }),
    ).toEqual({ kind: 'ok', amount: 3000 });
  });

  test('残りを超える金額はamount_exceeds_refundableで拒否する', () => {
    expect(
      validateRefundAmount({
        requested: 3001,
        paid: 4900,
        alreadyRequested: 1900,
      }),
    ).toEqual({ kind: 'invalid', code: 'amount_exceeds_refundable' });
  });

  test.each([0, -1, -4900])('%iはinvalid_amountで拒否する', (requested) => {
    expect(
      validateRefundAmount({ requested, paid: 4900, alreadyRequested: 0 }),
    ).toEqual({ kind: 'invalid', code: 'invalid_amount' });
  });

  test.each([0.5, 100.25, Number.NaN, Number.POSITIVE_INFINITY])(
    '整数でない%pはinvalid_amountで拒否する',
    (requested) => {
      expect(
        validateRefundAmount({ requested, paid: 4900, alreadyRequested: 0 }),
      ).toEqual({ kind: 'invalid', code: 'invalid_amount' });
    },
  );

  test('最小通貨単位の上限を超える金額はinvalid_amountで拒否する', () => {
    expect(
      validateRefundAmount({
        requested: 10_000_001,
        paid: 4900,
        alreadyRequested: 0,
      }),
    ).toEqual({ kind: 'invalid', code: 'invalid_amount' });
  });
});

describe('toStripeRefundReason', () => {
  test('二重決済の理由はStripeのduplicateにする', () => {
    expect(toStripeRefundReason('duplicate')).toBe('duplicate');
  });

  test.each(['late', 'ineligible', 'participation_lost', 'suspension'])(
    '%sはStripeのrequested_by_customerにする',
    (reason) => {
      expect(toStripeRefundReason(reason)).toBe('requested_by_customer');
    },
  );
});

describe('依頼キー', () => {
  test('反映の依頼キーはreflection:に購入IDを続けたもので、reflection:で始まるかを判定できる', () => {
    const key = reflectionRequestKeyOf('01JC0PURCHASE0000000000001');

    expect(key).toBe('reflection:01JC0PURCHASE0000000000001');
    expect(isReflectionRequestKey(key)).toBe(true);
    expect(isReflectionRequestKey('tournament-week:reflection:1')).toBe(false);
  });

  test.each([
    ['1文字', 'k', true],
    ['128文字', 'k'.repeat(128), true],
    ['空', '', false],
    ['129文字', 'k'.repeat(129), false],
    ['reflection:で始まる', 'reflection:01JC0PURCHASE0000000000001', false],
  ])('依頼元の依頼キーが%sなら%pを返す', (_, key, expected) => {
    expect(isAcceptableRequestKey(key)).toBe(expected);
  });
});

describe('isRefundReason', () => {
  test.each([
    ['小文字・数字・_', 'entitlement_lost_2', true],
    ['64文字', 'a'.repeat(64), true],
    ['空', '', false],
    ['65文字', 'a'.repeat(65), false],
    ['大文字', 'Late', false],
    ['ハイフン', 'entitlement-lost', false],
  ])('理由が%sなら%pを返す', (_, reason, expected) => {
    expect(isRefundReason(reason)).toBe(expected);
  });
});

describe('refundRecordStatusOf', () => {
  test.each([
    ['pending', 'pending'],
    ['requires_action', 'pending'],
    ['succeeded', 'succeeded'],
    ['failed', 'failed'],
    ['canceled', 'failed'],
  ] as const)('Stripeの返金の%sは決済履歴の%sにする', (status, expected) => {
    expect(refundRecordStatusOf(status)).toBe(expected);
  });
});

describe('refundRequestReflectionOf', () => {
  test.each([
    ['pending', 'submitted', ['requested', 'submitted']],
    ['requires_action', 'submitted', ['requested', 'submitted']],
    ['succeeded', 'succeeded', ['requested', 'submitted', 'succeeded']],
    ['failed', 'failed', ['requested', 'submitted', 'succeeded', 'failed']],
    ['canceled', 'canceled', ['requested', 'submitted', 'canceled']],
  ] as const)(
    'Stripeの返金の%sは依頼の%sにし、前進の元を限る',
    (status, expected, from) => {
      expect(refundRequestReflectionOf(status)).toEqual({
        status: expected,
        from,
      });
    },
  );

  test('完了した依頼を処理中へ戻さない', () => {
    const { from } = refundRequestReflectionOf('pending');

    expect(from).not.toContain('succeeded');
    expect(from).not.toContain('failed');
    expect(from).not.toContain('canceled');
  });
});
