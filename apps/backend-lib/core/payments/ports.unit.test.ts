import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  type ReflectionOutcome,
  type RefundRequestResult,
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  StripeNotFoundError,
  StripeRejectedError,
  StripeSignatureError,
  StripeUnavailableError,
} from './ports.ts';

describe('STRIPE_SIGNATURE_TOLERANCE_SECONDS', () => {
  test('Webhookの署名の時刻の許容は300秒である', () => {
    expect(STRIPE_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });
});

describe('Stripeの例外の分類', () => {
  test.each([
    ['StripeUnavailableError', new StripeUnavailableError('一時的な失敗')],
    ['StripeNotFoundError', new StripeNotFoundError('対象が無い')],
    ['StripeSignatureError', new StripeSignatureError('署名の不正')],
  ] as const)('%sはErrorで、名前と文言を持つ', (name, error) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.message).not.toBe('');
  });

  test('分類どうしはinstanceofで区別できる', () => {
    const unavailable: unknown = new StripeUnavailableError('一時的な失敗');

    expect(unavailable).toBeInstanceOf(StripeUnavailableError);
    expect(unavailable).not.toBeInstanceOf(StripeNotFoundError);
    expect(unavailable).not.toBeInstanceOf(StripeRejectedError);
    expect(unavailable).not.toBeInstanceOf(StripeSignatureError);
  });

  test('恒久的な拒否はStripeのエラーコードと元の例外を持つ', () => {
    const cause = new Error('card_declined');
    const error = new StripeRejectedError(
      { message: '決済が拒否されました', stripeErrorCode: 'card_declined' },
      { cause },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StripeRejectedError');
    expect(error.message).toBe('決済が拒否されました');
    expect(error.stripeErrorCode).toBe('card_declined');
    expect(error.cause).toBe(cause);
  });

  test('一時的な失敗は元の例外を持てる', () => {
    const cause = new Error('connection reset');

    expect(new StripeUnavailableError('一時的な失敗', { cause }).cause).toBe(
      cause,
    );
  });
});

describe('RefundRequestResult', () => {
  test('拒否の結果は返金の依頼のIDを持てない', () => {
    const result: RefundRequestResult = {
      kind: 'rejected',
      code: 'invalid_request_key',
      // @ts-expect-error 拒否の結果に依頼のIDは無い
      refundRequestId: '01JC0REFUND000000000000001',
    };

    expect(result.kind).toBe('rejected');
  });
});

describe('ReflectionOutcome', () => {
  test('反映の結果は5種である', () => {
    expectTypeOf<ReflectionOutcome['kind']>().toEqualTypeOf<
      'applied' | 'already_applied' | 'stale' | 'unresolved' | 'ignored'
    >();
  });
});
