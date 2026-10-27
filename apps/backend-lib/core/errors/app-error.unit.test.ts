import { describe, expect, test } from 'bun:test';

import {
  AppError,
  type AppErrorKind,
  type AppErrorStatus,
  type FieldErrorDetail,
  STATUS_BY_KIND,
} from './app-error.ts';

const EXPECTED_STATUS_BY_KIND: readonly (readonly [
  AppErrorKind,
  AppErrorStatus,
])[] = [
  ['bad_request', 400],
  ['unauthenticated', 401],
  ['forbidden', 403],
  ['not_found', 404],
  ['conflict', 409],
  ['payload_too_large', 413],
  ['unsupported_media_type', 415],
  ['unprocessable', 422],
  ['rate_limited', 429],
  ['unavailable', 503],
];

describe('STATUS_BY_KIND', () => {
  test.each(EXPECTED_STATUS_BY_KIND)(
    '%sを状態コード%dに対応付ける',
    (kind, status) => {
      expect(STATUS_BY_KIND[kind]).toBe(status);
    },
  );

  test('10種の失敗だけを持ち、実行時に書き換えられない', () => {
    expect(Object.keys(STATUS_BY_KIND).toSorted()).toEqual(
      EXPECTED_STATUS_BY_KIND.map(([kind]) => kind).toSorted(),
    );
    expect(Object.isFrozen(STATUS_BY_KIND)).toBe(true);
  });
});

describe('AppError', () => {
  test('Errorを継承し、種類・エラーコード・利用者向けの文を持つ', () => {
    const error = new AppError({
      kind: 'not_found',
      code: 'product_not_found',
      message: 'プロダクトが見つかりませんでした。',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.kind).toBe('not_found');
    expect(error.code).toBe('product_not_found');
    expect(error.message).toBe('プロダクトが見つかりませんでした。');
    expect(error.details).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  test('項目ごとの詳細を受け取った時点の内容で保持し、書き換えられない', () => {
    const details: FieldErrorDetail[] = [
      {
        field: 'handle',
        message: 'このハンドルは既に使われています。',
        code: 'duplicate',
      },
    ];

    const error = new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
      details,
    });
    details.push({ field: 'nickname', message: '追加', code: 'too_long' });

    expect(error.details).toEqual([
      {
        field: 'handle',
        message: 'このハンドルは既に使われています。',
        code: 'duplicate',
      },
    ]);
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen(error.details?.[0])).toBe(true);
  });

  test.each<AppErrorKind>(['rate_limited', 'unavailable'])(
    '%sは再試行までの秒数を持てる',
    (kind) => {
      const error = new AppError({
        kind,
        code: 'retry_later',
        message: 'しばらく待ってから再度お試しください。',
        retryAfterSeconds: 10,
      });

      expect(error.retryAfterSeconds).toBe(10);
    },
  );

  test('再試行までの秒数に0を指定できる', () => {
    const error = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 0,
    });

    expect(error.retryAfterSeconds).toBe(0);
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '再試行までの秒数が0以上の整数でない値(%p)なら拒否する',
    (retryAfterSeconds) => {
      expect(
        () =>
          new AppError({
            kind: 'rate_limited',
            code: 'rate_limit_exceeded',
            message: '操作が集中しています。',
            retryAfterSeconds,
          }),
      ).toThrow(RangeError);
    },
  );

  test.each<AppErrorKind>([
    'bad_request',
    'unauthenticated',
    'forbidden',
    'not_found',
    'conflict',
    'payload_too_large',
    'unsupported_media_type',
    'unprocessable',
  ])('%sに再試行までの秒数を指定すると拒否する', (kind) => {
    expect(
      () =>
        new AppError({
          kind,
          code: 'some_error',
          message: '失敗しました。',
          retryAfterSeconds: 5,
        }),
    ).toThrow(RangeError);
  });

  test.each([
    '',
    'NotFound',
    'not-found',
    'not found',
    '_leading',
    'trailing_',
  ])('snake_caseでないエラーコード(%p)を拒否する', (code) => {
    expect(
      () =>
        new AppError({ kind: 'not_found', code, message: '失敗しました。' }),
    ).toThrow(RangeError);
  });

  test('数字を含むsnake_caseのエラーコードを受け付ける', () => {
    const error = new AppError({
      kind: 'unprocessable',
      code: 'step2_incomplete',
      message: '手順を完了してください。',
    });

    expect(error.code).toBe('step2_incomplete');
  });
});
