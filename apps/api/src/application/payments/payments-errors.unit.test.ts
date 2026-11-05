import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { toErrorResponse } from '../../../lib/core/errors/error-envelope.ts';
import type { PurchaseOffer } from '../../../lib/core/payments/purchase-kind-contract.ts';
import { assertAcceptable } from '../../../lib/core/payments/purchase-rules.ts';
import {
  checkoutSessionIdRejectedError,
  PAYMENTS_ERRORS,
  paymentHistoryPageSizeRejectedError,
  paymentsError,
  purchaseOfferUnavailableError,
} from './payments-errors.ts';

const UNAVAILABLE_MESSAGE =
  '現在、決済をご利用いただけません。閲覧やその他の操作はご利用いただけます。';

describe('PAYMENTS_ERRORS', () => {
  test.each([
    ['checkout_closed', 'unprocessable', 422, '決済の受付は終了しました。'],
    [
      'purchase_kind_unavailable',
      'unprocessable',
      422,
      'この決済は現在ご利用いただけません。',
    ],
    ['payments_unavailable', 'unavailable', 503, UNAVAILABLE_MESSAGE],
    [
      'checkout_not_found',
      'not_found',
      404,
      'お探しの決済は見つかりませんでした。',
    ],
    [
      'checkout_not_open',
      'conflict',
      409,
      'この決済は既に完了しているか、受付が終了しています。',
    ],
  ] as const)(
    '%sは%sの種類(%d)と設計の文言を持つ',
    (code, kind, status, message) => {
      const error = paymentsError(code);

      expect(error).toBeInstanceOf(AppError);
      expect({
        kind: error.kind,
        code: error.code,
        message: error.message,
      }).toEqual({ kind, code, message });
      expect(toErrorResponse(error).status).toBe(status);
    },
  );

  test('定義は設計の表の5つのコードだけで、実行時に書き換えられない', () => {
    expect(Object.keys(PAYMENTS_ERRORS).toSorted()).toEqual([
      'checkout_closed',
      'checkout_not_found',
      'checkout_not_open',
      'payments_unavailable',
      'purchase_kind_unavailable',
    ]);
    expect(Object.isFrozen(PAYMENTS_ERRORS)).toBe(true);
  });

  test('受付期限の後の拒否は、共通の規則が投げる例外と同じ種類・コード・文言である', () => {
    const offer = {
      acceptUntil: new Date('2027-04-01T14:00:00.000Z'),
    } as PurchaseOffer;

    let thrown: unknown;
    try {
      assertAcceptable(new Date('2027-04-01T14:00:00.000Z'), offer);
    } catch (error: unknown) {
      thrown = error;
    }

    const expected = paymentsError('checkout_closed');
    expect(thrown).toBeInstanceOf(AppError);
    expect({
      kind: (thrown as AppError).kind,
      code: (thrown as AppError).code,
      message: (thrown as AppError).message,
    }).toEqual({
      kind: expected.kind,
      code: expected.code,
      message: expected.message,
    });
  });
});

describe('purchaseOfferUnavailableError', () => {
  test('購入種別を受け持つ機能が返したコードと文言の422にする', () => {
    const error = purchaseOfferUnavailableError({
      kind: 'unavailable',
      code: 'entry_already_paid',
      message: 'この参加費は既に支払い済みです。',
    });

    expect(error).toBeInstanceOf(AppError);
    expect({
      kind: error.kind,
      code: error.code,
      message: error.message,
    }).toEqual({
      kind: 'unprocessable',
      code: 'entry_already_paid',
      message: 'この参加費は既に支払い済みです。',
    });
  });
});

describe('checkoutSessionIdRejectedError', () => {
  test('決済セッションのIDの欄の詳細を持つ入力の検証のエラーにする', () => {
    const error = checkoutSessionIdRejectedError('invalid');

    expect(error).toBeInstanceOf(AppError);
    expect(toErrorResponse(error).status).toBe(400);
    expect({
      kind: error.kind,
      code: error.code,
      message: error.message,
      details: error.details,
    }).toEqual({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
      details: [
        {
          field: 'sessionId',
          code: 'invalid',
          message: '決済の確認に必要な情報が正しくありません。',
        },
      ],
    });
  });
});

describe('paymentHistoryPageSizeRejectedError', () => {
  test('件数の欄の詳細を持つ入力の検証のエラーにする', () => {
    const error = paymentHistoryPageSizeRejectedError('out-of-range');

    expect(error).toBeInstanceOf(AppError);
    expect(toErrorResponse(error).status).toBe(400);
    expect({
      kind: error.kind,
      code: error.code,
      message: error.message,
      details: error.details,
    }).toEqual({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
      details: [
        {
          field: 'first',
          code: 'out-of-range',
          message: '表示する件数は1〜50件の整数で指定してください。',
        },
      ],
    });
  });
});
