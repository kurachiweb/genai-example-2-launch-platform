import { describe, expect, test } from 'bun:test';

import { CHECKOUT_SESSION_ID_MAX } from '../../../common-lib/payments/payment-input-rules.ts';
import { toCheckoutReturnSearch } from './checkout-return-rules.ts';

const SESSION_ID = ['cs', 'test', 'return0001'].join('_');

describe('toCheckoutReturnSearch', () => {
  test('決済セッションのIDを受け取り、他の検索パラメータを持たない', () => {
    expect(
      toCheckoutReturnSearch({ session_id: SESSION_ID, utm_source: 'mail' }),
    ).toStrictEqual({ session_id: SESSION_ID });
  });

  test('決済セッションのIDが無ければ、値の無い項目にする', () => {
    expect(toCheckoutReturnSearch({})).toStrictEqual({
      session_id: undefined,
    });
  });

  test.each([
    ['空の文字列', ''],
    ['文字列でない値', 12],
    ['決済セッションでないID', 'pi_test_1'],
    ['使えない文字を含む値', 'cs_test-1'],
    ['上限を超える長さ', `cs_${'a'.repeat(CHECKOUT_SESSION_ID_MAX - 2)}`],
  ])(
    '%sは、URLの元の値を残さないよう値の無い項目で上書きする',
    (_label, value) => {
      expect(toCheckoutReturnSearch({ session_id: value })).toStrictEqual({
        session_id: undefined,
      });
    },
  );

  test('上限ちょうどの長さの決済セッションのIDは受け取る', () => {
    const sessionId = `cs_${'a'.repeat(CHECKOUT_SESSION_ID_MAX - 3)}`;

    expect(toCheckoutReturnSearch({ session_id: sessionId })).toStrictEqual({
      session_id: sessionId,
    });
  });
});
