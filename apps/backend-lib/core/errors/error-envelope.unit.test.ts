import { describe, expect, test } from 'bun:test';

import {
  AppError,
  type AppErrorKind,
  type AppErrorStatus,
} from './app-error.ts';
import {
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
  toErrorResponse,
} from './error-envelope.ts';

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

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    expectDeeplyFrozen(child);
  }
}

describe('toErrorResponse', () => {
  test.each(EXPECTED_STATUS_BY_KIND)(
    '%sを状態コード%dの共通のエラー形式にする',
    (kind, status) => {
      const error = new AppError({
        kind,
        code: 'some_error',
        message: '失敗しました。',
      });

      const response = toErrorResponse(error);

      expect(response.status).toBe(status);
      expect(response.body).toStrictEqual({
        error: { code: 'some_error', message: '失敗しました。' },
      });
    },
  );

  test('項目ごとの詳細を共通のエラー形式のdetailsに入れる', () => {
    const error = new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
      details: [
        {
          field: 'nickname',
          message: 'ニックネームは25文字以内で入力してください。',
          code: 'too_long',
        },
      ],
    });

    const response = toErrorResponse(error);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({
      error: {
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: [
          {
            field: 'nickname',
            message: 'ニックネームは25文字以内で入力してください。',
            code: 'too_long',
          },
        ],
      },
    });
  });

  test('再試行までの秒数が無ければCache-Control: no-storeだけを付ける', () => {
    const error = new AppError({
      kind: 'forbidden',
      code: 'bot_verification_failed',
      message: '認証に失敗しました。ページを再読み込みして再度お試しください。',
    });

    const response = toErrorResponse(error);

    expect(response.headers).toStrictEqual({ 'Cache-Control': 'no-store' });
  });

  test('429の再試行までの秒数をRetry-Afterに入れ、Cache-Control: no-storeも付ける', () => {
    const error = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 10,
    });

    const response = toErrorResponse(error);

    expect(response.status).toBe(429);
    expect(response.headers).toStrictEqual({
      'Cache-Control': 'no-store',
      'Retry-After': '10',
    });
  });

  test('503の再試行までの秒数をRetry-Afterに入れる', () => {
    const error = new AppError({
      kind: 'unavailable',
      code: 'bot_verification_unavailable',
      message: '時間をおいて再度お試しください。',
      retryAfterSeconds: 5,
    });

    const response = toErrorResponse(error);

    expect(response.status).toBe(503);
    expect(response.headers['Retry-After']).toBe('5');
  });

  test('再試行までの秒数が0でもRetry-Afterを付ける', () => {
    const error = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 0,
    });

    const response = toErrorResponse(error);

    expect(response.headers['Retry-After']).toBe('0');
  });

  test('本文に例外の名前・種類・スタックトレース・原因・再試行の秒数を含めない', () => {
    const error = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 10,
    });
    Object.defineProperty(error, 'cause', {
      value: new Error('SELECT * FROM users'),
    });

    const response = toErrorResponse(error);
    const serialized = JSON.stringify(response.body);

    expect(Object.keys(response.body.error).toSorted()).toEqual([
      'code',
      'message',
    ]);
    expect(serialized).not.toContain('AppError');
    expect(serialized).not.toContain('rate_limited');
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('at ');
  });

  test('返す値は詳細を含めて書き換えられない', () => {
    const error = new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
      details: [{ field: 'handle', message: '必須です。', code: 'required' }],
    });

    const response = toErrorResponse(error);

    expectDeeplyFrozen(response);
  });
});

describe('INTERNAL_ERROR_RESPONSE', () => {
  test('状態コード500・internal_error・Cache-Control: no-storeの定型である', () => {
    expect(INTERNAL_ERROR_RESPONSE.status).toBe(500);
    expect(INTERNAL_ERROR_RESPONSE.body.error.code).toBe('internal_error');
    expect(INTERNAL_ERROR_RESPONSE.headers).toStrictEqual({
      'Cache-Control': 'no-store',
    });
  });

  test('本文はエラーコードと定型の文だけで、スタックトレースなどの内部の詳細を含まない', () => {
    const { error } = INTERNAL_ERROR_RESPONSE.body;

    expect(Object.keys(INTERNAL_ERROR_RESPONSE.body)).toEqual(['error']);
    expect(Object.keys(error).toSorted()).toEqual(['code', 'message']);
    expect(error.message).toMatch(/。$/u);
    expect(JSON.stringify(INTERNAL_ERROR_RESPONSE.body)).not.toMatch(
      /stack|at |Error|SQL|SELECT|env/u,
    );
  });

  test('書き換えられない', () => {
    expectDeeplyFrozen(INTERNAL_ERROR_RESPONSE);
  });
});

describe('NOT_FOUND_RESPONSE', () => {
  test('状態コード404・not_found・Cache-Control: no-storeの定型である', () => {
    expect(NOT_FOUND_RESPONSE.status).toBe(404);
    expect(NOT_FOUND_RESPONSE.headers).toStrictEqual({
      'Cache-Control': 'no-store',
    });
    expect(Object.keys(NOT_FOUND_RESPONSE.body.error).toSorted()).toEqual([
      'code',
      'message',
    ]);
    expect(NOT_FOUND_RESPONSE.body.error.code).toBe('not_found');
    expect(NOT_FOUND_RESPONSE.body.error.message).toMatch(/。$/u);
  });

  test('書き換えられない', () => {
    expectDeeplyFrozen(NOT_FOUND_RESPONSE);
  });
});
