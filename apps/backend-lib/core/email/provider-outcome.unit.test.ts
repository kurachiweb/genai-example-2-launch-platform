import { describe, expect, test } from 'bun:test';

import {
  classifyCloudflareSendError,
  UNKNOWN_SEND_ERROR_CODE,
} from './provider-outcome.ts';

describe('classifyCloudflareSendError', () => {
  test('送信レートの上限のコードをrate-limitedにする', () => {
    expect(classifyCloudflareSendError('E_RATE_LIMIT_EXCEEDED')).toEqual({
      kind: 'rate-limited',
    });
  });

  test('日次上限のコードをdaily-limitにする', () => {
    expect(classifyCloudflareSendError('E_DAILY_LIMIT_EXCEEDED')).toEqual({
      kind: 'daily-limit',
    });
  });

  test.each(['E_INTERNAL_SERVER_ERROR', 'E_DELIVERY_FAILED'])(
    '一時的な障害のコード%pをコード付きのtemporaryにする',
    (code) => {
      expect(classifyCloudflareSendError(code)).toEqual({
        kind: 'temporary',
        code,
      });
    },
  );

  test.each(['E_SOMETHING_NEW', ''])(
    '未知のコード%pは再試行して上限で検知するためtemporaryにする',
    (code) => {
      expect(classifyCloudflareSendError(code)).toEqual({
        kind: 'temporary',
        code,
      });
    },
  );

  test('コード無しは不明のコードを付けたtemporaryにする', () => {
    expect(classifyCloudflareSendError(undefined)).toEqual({
      kind: 'temporary',
      code: UNKNOWN_SEND_ERROR_CODE,
    });
  });

  test('宛先の抑止のコードをrecipient-suppressedにする', () => {
    expect(classifyCloudflareSendError('E_RECIPIENT_SUPPRESSED')).toEqual({
      kind: 'recipient-suppressed',
    });
  });

  test.each([
    'E_VALIDATION_ERROR',
    'E_FIELD_MISSING',
    'E_TOO_MANY_RECIPIENTS',
    'E_TOO_MANY_ATTACHMENTS',
    'E_CONTENT_TOO_LARGE',
    'E_HEADER_NOT_ALLOWED',
    'E_HEADER_USE_API_FIELD',
    'E_HEADER_VALUE_INVALID',
    'E_HEADER_VALUE_TOO_LONG',
    'E_HEADER_NAME_INVALID',
    'E_HEADERS_TOO_LARGE',
    'E_HEADERS_TOO_MANY',
    'E_SENDER_NOT_VERIFIED',
    'E_SENDER_DOMAIN_NOT_AVAILABLE',
    'E_ACCOUNT_SUSPENDED',
  ])('再試行しても結果が変わらないコード%pをpermanentにする', (code) => {
    expect(classifyCloudflareSendError(code)).toEqual({
      kind: 'permanent',
      code,
    });
  });

  test('バインディングの宛先の許可外は設定の誤りとしてpermanentにし、環境の宛先制限と区別する', () => {
    const outcome = classifyCloudflareSendError('E_RECIPIENT_NOT_ALLOWED');

    expect(outcome).toEqual({
      kind: 'permanent',
      code: 'E_RECIPIENT_NOT_ALLOWED',
    });
    expect(outcome.kind).not.toBe('recipient-not-allowed');
  });

  test('E_TOO_MANY_で始まる新しいコードもpermanentにする', () => {
    expect(classifyCloudflareSendError('E_TOO_MANY_REPLY_TO')).toEqual({
      kind: 'permanent',
      code: 'E_TOO_MANY_REPLY_TO',
    });
  });
});
