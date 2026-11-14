import { describe, expect, test } from 'bun:test';

import {
  CHECKOUT_SESSION_ID_MAX,
  CHECKOUT_SESSION_ID_MESSAGES,
  checkCheckoutSessionId,
  checkPaymentHistoryPageSize,
  PAYMENT_HISTORY_CURSOR_MAX,
  PAYMENT_HISTORY_PAGE_SIZE_DEFAULT,
  PAYMENT_HISTORY_PAGE_SIZE_MAX,
  PAYMENT_HISTORY_PAGE_SIZE_MESSAGES,
} from './payment-input-rules.ts';

describe('checkCheckoutSessionId', () => {
  test.each([
    ['テストモードのID', 'cs_test_a1B2c3D4e5F6g7H8i9J0'],
    ['ライブモードのID', 'cs_live_a1B2c3D4e5F6g7H8i9J0'],
    ['255文字ちょうどのID', `cs_${'a'.repeat(CHECKOUT_SESSION_ID_MAX - 3)}`],
  ])('%sを受け付ける', (_label, value) => {
    expect(checkCheckoutSessionId(value)).toBeUndefined();
  });

  test.each([
    ['空の値', ''],
    ['接頭辞だけの値', 'cs_'],
    ['別のオブジェクトのID', 'pi_test_a1B2c3D4'],
    ['接頭辞が大文字の値', 'CS_test_a1B2c3D4'],
    ['256文字のID', `cs_${'a'.repeat(CHECKOUT_SESSION_ID_MAX - 2)}`],
    ['記号を含む値', 'cs_test_a1B2/../c3'],
    ['空白を含む値', 'cs_test a1B2'],
    ['末尾に改行を含む値', 'cs_test_a1B2\n'],
  ])('%sを不正として拒否する', (_label, value) => {
    expect(checkCheckoutSessionId(value)).toBe('invalid');
  });

  test('上限は255文字である', () => {
    expect(CHECKOUT_SESSION_ID_MAX).toBe(255);
  });

  test('不正の文言を持つ', () => {
    expect(CHECKOUT_SESSION_ID_MESSAGES).toEqual({
      invalid: '決済の確認に必要な情報が正しくありません。',
    });
    expect(Object.isFrozen(CHECKOUT_SESSION_ID_MESSAGES)).toBe(true);
  });
});

describe('checkPaymentHistoryPageSize', () => {
  test('既定は20件、上限は50件である', () => {
    expect(PAYMENT_HISTORY_PAGE_SIZE_DEFAULT).toBe(20);
    expect(PAYMENT_HISTORY_PAGE_SIZE_MAX).toBe(50);
  });

  test.each([1, 20, 50])('%d件を受け付ける', (value) => {
    expect(checkPaymentHistoryPageSize(value)).toBeUndefined();
  });

  test.each([0, -1, 51, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '%d件を範囲外として拒否する',
    (value) => {
      expect(checkPaymentHistoryPageSize(value)).toBe('out-of-range');
    },
  );

  test('範囲外の文言に上限の件数を入れる', () => {
    expect(PAYMENT_HISTORY_PAGE_SIZE_MESSAGES).toEqual({
      'out-of-range': '表示する件数は1〜50件の整数で指定してください。',
    });
    expect(Object.isFrozen(PAYMENT_HISTORY_PAGE_SIZE_MESSAGES)).toBe(true);
  });
});

describe('PAYMENT_HISTORY_CURSOR_MAX', () => {
  test('続きの位置の指定の長さの上限は256文字である', () => {
    expect(PAYMENT_HISTORY_CURSOR_MAX).toBe(256);
  });
});
