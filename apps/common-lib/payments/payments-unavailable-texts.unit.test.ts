import { describe, expect, test } from 'bun:test';

import {
  PAYMENTS_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_REASON,
} from './payments-unavailable-texts.ts';

describe('PAYMENTS_UNAVAILABLE_REASON', () => {
  test('文言規則の縮退運転の理由の文にする', () => {
    expect(PAYMENTS_UNAVAILABLE_REASON).toBe(
      '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。',
    );
  });
});

describe('PAYMENTS_UNAVAILABLE_MESSAGE', () => {
  test('単独で読まれるAPIのエラーの文言は、決済を利用できない旨に理由の文を続ける', () => {
    expect(PAYMENTS_UNAVAILABLE_MESSAGE).toBe(
      '現在、決済をご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。',
    );
  });

  test('理由の文で終わり、画面の理由の文と食い違わない', () => {
    expect(
      PAYMENTS_UNAVAILABLE_MESSAGE.endsWith(PAYMENTS_UNAVAILABLE_REASON),
    ).toBe(true);
  });
});
