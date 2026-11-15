import { describe, expect, test } from 'bun:test';

import {
  createNetworkError,
  errorMessageOf,
  GraphQLClientError,
  type GraphQLResult,
  isExpectedFailure,
  parseGraphQLResponse,
  requireData,
} from './graphql-result.ts';

interface ProductQuery {
  readonly product: { readonly id: string } | null;
}

const parse = (input: {
  readonly status: number;
  readonly headers?: HeadersInit;
  readonly body: unknown;
}): GraphQLResult<ProductQuery> =>
  parseGraphQLResponse<ProductQuery>({
    status: input.status,
    headers: new Headers(input.headers),
    body: input.body,
  });

const errorOf = (result: GraphQLResult<ProductQuery>): GraphQLClientError => {
  if (result.ok) {
    throw new Error('失敗の結果を期待したが成功だった');
  }
  return result.error;
};

describe('parseGraphQLResponse', () => {
  describe('成功の応答', () => {
    test('dataがありerrorsが無ければ成功としてdataを返す', () => {
      const result = parse({
        status: 200,
        body: { data: { product: { id: 'product-1' } } },
      });

      expect(result).toEqual({
        ok: true,
        data: { product: { id: 'product-1' } },
      });
    });

    test('JSONの文字列の本文も解釈する', () => {
      const result = parse({
        status: 200,
        body: JSON.stringify({ data: { product: null } }),
      });

      expect(result).toEqual({ ok: true, data: { product: null } });
    });
  });

  describe('GraphQLの結果のエラー', () => {
    test('最初のエラーのコード・メッセージ・項目ごとの詳細を型付きで返す', () => {
      const result = parse({
        status: 200,
        body: {
          data: null,
          errors: [
            {
              message: '入力内容を確認してください。',
              extensions: {
                code: 'validation_error',
                details: [
                  {
                    field: 'title',
                    code: 'too_long',
                    message: '100文字以内で入力してください。',
                  },
                ],
              },
            },
            {
              message: '2つ目のエラー',
              extensions: { code: 'unauthenticated' },
            },
          ],
        },
      });

      const error = errorOf(result);
      expect(error).toBeInstanceOf(GraphQLClientError);
      expect(error.code).toBe('validation_error');
      expect(error.message).toBe('入力内容を確認してください。');
      expect(error.status).toBe(200);
      expect(error.details).toEqual([
        {
          field: 'title',
          code: 'too_long',
          message: '100文字以内で入力してください。',
        },
      ]);
      expect(error.retryAfterSeconds).toBeUndefined();
      expect(error.expected).toBe(true);
    });

    test('dataとerrorsの両方があれば失敗として扱う', () => {
      const result = parse({
        status: 200,
        body: {
          data: { product: null },
          errors: [
            {
              message: 'ログインしてください。',
              extensions: { code: 'unauthenticated' },
            },
          ],
        },
      });

      const error = errorOf(result);
      expect(error.code).toBe('unauthenticated');
      expect(error.details).toBeUndefined();
      expect(error.expected).toBe(true);
    });

    test('形に合わない項目ごとの詳細は渡さない', () => {
      const result = parse({
        status: 200,
        body: {
          errors: [
            {
              message: '入力内容を確認してください。',
              extensions: {
                code: 'validation_error',
                details: [{ field: 'title' }],
              },
            },
          ],
        },
      });

      expect(errorOf(result).details).toBeUndefined();
    });

    test('429とRetry-Afterの秒数を返し、想定内の失敗とする', () => {
      const result = parse({
        status: 429,
        headers: { 'retry-after': '30' },
        body: {
          errors: [
            {
              message:
                '操作が集中しています。しばらく待ってから再度お試しください。',
              extensions: { code: 'rate_limit_exceeded' },
            },
          ],
        },
      });

      const error = errorOf(result);
      expect(error.code).toBe('rate_limit_exceeded');
      expect(error.status).toBe(429);
      expect(error.retryAfterSeconds).toBe(30);
      expect(error.expected).toBe(true);
    });

    test('503とRetry-Afterの秒数を返し、想定内の失敗とする', () => {
      const result = parse({
        status: 503,
        headers: { 'retry-after': '0' },
        body: {
          data: null,
          errors: [
            {
              message: '現在ご利用いただけません。',
              extensions: { code: 'bot_verification_unavailable' },
            },
          ],
        },
      });

      const error = errorOf(result);
      expect(error.code).toBe('bot_verification_unavailable');
      expect(error.status).toBe(503);
      expect(error.retryAfterSeconds).toBe(0);
      expect(error.expected).toBe(true);
    });

    test('秒数でないRetry-Afterは無視する', () => {
      const invalidValues = ['Wed, 21 Oct 2026 07:28:00 GMT', '-1', '1.5', ''];

      for (const value of invalidValues) {
        const result = parse({
          status: 429,
          headers: { 'retry-after': value },
          body: {
            errors: [
              {
                message: '操作が集中しています。',
                extensions: { code: 'rate_limit_exceeded' },
              },
            ],
          },
        });

        expect(errorOf(result).retryAfterSeconds).toBeUndefined();
      }
    });

    test('内部エラーは想定外の失敗とする', () => {
      const result = parse({
        status: 500,
        body: {
          data: null,
          errors: [
            {
              message: '予期しないエラーが発生しました。',
              extensions: { code: 'internal_error' },
            },
          ],
        },
      });

      const error = errorOf(result);
      expect(error.code).toBe('internal_error');
      expect(error.status).toBe(500);
      expect(error.expected).toBe(false);
    });

    test('実行前の拒否のコードはすべて想定外の失敗とする', () => {
      const rejectionCodes = [
        'persisted_operation_required',
        'persisted_operation_not_found',
        'query_depth_exceeded',
        'query_cost_exceeded',
        'query_aliases_exceeded',
        'query_tokens_exceeded',
        'query_directives_exceeded',
        'graphql_parse_failed',
        'graphql_validation_failed',
        'graphql_request_invalid',
      ];

      for (const code of rejectionCodes) {
        const result = parse({
          status: 400,
          body: {
            errors: [{ message: '拒否しました。', extensions: { code } }],
          },
        });

        const error = errorOf(result);
        expect(error.code).toBe(code);
        expect(error.status).toBe(400);
        expect(error.expected).toBe(false);
      }
    });

    test('コードを持たないエラーは解釈できない応答とする', () => {
      const result = parse({
        status: 200,
        body: { errors: [{ message: 'コードが無い' }] },
      });

      const error = errorOf(result);
      expect(error.code).toBe('invalid_response');
      expect(error.status).toBe(200);
      expect(error.expected).toBe(false);
    });
  });

  describe('共通のエラー形式の応答', () => {
    test('403のCSRFの拒否をコードとメッセージで返す', () => {
      const result = parse({
        status: 403,
        body: {
          error: {
            code: 'csrf_rejected',
            message:
              'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。',
          },
        },
      });

      const error = errorOf(result);
      expect(error.code).toBe('csrf_rejected');
      expect(error.message).toBe(
        'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。',
      );
      expect(error.status).toBe(403);
      expect(error.details).toBeUndefined();
      expect(error.retryAfterSeconds).toBeUndefined();
    });

    test('429のIP制限をRetry-Afterの秒数とともに返し、想定内の失敗とする', () => {
      const result = parse({
        status: 429,
        headers: { 'Retry-After': '60' },
        body: {
          error: {
            code: 'rate_limit_exceeded',
            message:
              '操作が集中しています。しばらく待ってから再度お試しください。',
          },
        },
      });

      const error = errorOf(result);
      expect(error.code).toBe('rate_limit_exceeded');
      expect(error.status).toBe(429);
      expect(error.retryAfterSeconds).toBe(60);
      expect(error.expected).toBe(true);
    });

    test('503の中継の失敗をRetry-Afterの秒数とともに返し、想定外の失敗とする', () => {
      for (const code of ['upstream_timeout', 'upstream_unavailable']) {
        const result = parse({
          status: 503,
          headers: { 'Retry-After': '5' },
          body: {
            error: {
              code,
              message:
                '現在ご利用いただけません。時間をおいて再度お試しください。',
            },
          },
        });

        const error = errorOf(result);
        expect(error.code).toBe(code);
        expect(error.status).toBe(503);
        expect(error.retryAfterSeconds).toBe(5);
        expect(error.expected).toBe(false);
      }
    });

    test('項目ごとの詳細を返す', () => {
      const result = parse({
        status: 400,
        body: {
          error: {
            code: 'validation_error',
            message: '入力内容を確認してください。',
            details: [
              {
                field: 'title',
                code: 'too_long',
                message: '100文字以内で入力してください。',
              },
            ],
          },
        },
      });

      expect(errorOf(result).details).toEqual([
        {
          field: 'title',
          code: 'too_long',
          message: '100文字以内で入力してください。',
        },
      ]);
    });

    test('500の内部エラーは想定外の失敗とする', () => {
      const result = parse({
        status: 500,
        body: {
          error: {
            code: 'internal_error',
            message: '予期しないエラーが発生しました。',
          },
        },
      });

      expect(errorOf(result).expected).toBe(false);
    });
  });

  describe('解釈できない応答', () => {
    test('JSONでない本文は想定外の失敗とする', () => {
      const result = parse({
        status: 502,
        body: '<html><body>Bad Gateway</body></html>',
      });

      const error = errorOf(result);
      expect(error.code).toBe('invalid_response');
      expect(error.status).toBe(502);
      expect(error.message).toBe(
        '現在ご利用いただけません。時間をおいて再度お試しください。',
      );
      expect(error.details).toBeUndefined();
      expect(error.retryAfterSeconds).toBeUndefined();
      expect(error.expected).toBe(false);
    });

    test('本文が無い・GraphQLの結果でも共通のエラー形式でもない応答を想定外の失敗とする', () => {
      const bodies: readonly unknown[] = [
        undefined,
        null,
        '',
        42,
        [],
        {},
        { data: null },
        { data: 'product' },
        { errors: [] },
        { errors: 'error' },
        { error: { code: 'internal_error' } },
        { error: 'internal_error' },
      ];

      for (const body of bodies) {
        const error = errorOf(parse({ status: 415, body }));

        expect(error.code).toBe('invalid_response');
        expect(error.status).toBe(415);
        expect(error.expected).toBe(false);
      }
    });
  });
});

describe('GraphQLClientError', () => {
  test('Errorを継承し、名前を持つ', () => {
    const error = new GraphQLClientError({
      code: 'unauthenticated',
      message: 'ログインしてください。',
      status: 200,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GraphQLClientError');
    expect(error.details).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  test('コードから想定内の失敗かを決める', () => {
    const expectedOf = (code: string): boolean =>
      new GraphQLClientError({ code, message: '失敗', status: 200 }).expected;

    expect(expectedOf('bot_verification_failed')).toBe(true);
    expect(expectedOf('upstream_unavailable')).toBe(false);
    expect(expectedOf('upstream_timeout')).toBe(false);
    expect(expectedOf('network_error')).toBe(false);
    expect(expectedOf('invalid_response')).toBe(false);
    expect(expectedOf('internal_error')).toBe(false);
    expect(expectedOf('graphql_request_invalid')).toBe(false);
  });
});

describe('createNetworkError', () => {
  test('状態コード0の想定外の失敗を、原因を保持して作る', () => {
    const cause = new TypeError('Failed to fetch');

    const error = createNetworkError(cause);

    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.message).toBe(
      '通信に失敗しました。時間をおいて再度お試しください。',
    );
    expect(error.expected).toBe(false);
    expect(error.cause).toBe(cause);
  });
});

describe('requireData', () => {
  test('成功ならdataを返す', () => {
    const result = parse({
      status: 200,
      body: { data: { product: { id: 'product-1' } } },
    });

    expect(requireData(result)).toEqual({ product: { id: 'product-1' } });
  });

  test('失敗ならそのエラーを投げる', () => {
    const result = parse({
      status: 200,
      body: {
        errors: [
          {
            message: 'ログインしてください。',
            extensions: { code: 'unauthenticated' },
          },
        ],
      },
    });

    expect(() => requireData(result)).toThrow(errorOf(result));
  });
});

describe('isExpectedFailure', () => {
  test('想定内のコードを持つGraphQLClientErrorだけを想定内と判定する', () => {
    const errorOfCode = (code: string): GraphQLClientError =>
      new GraphQLClientError({ code, message: '失敗しました', status: 400 });

    expect(isExpectedFailure(errorOfCode('validation_failed'))).toBe(true);
    expect(isExpectedFailure(errorOfCode('internal_error'))).toBe(false);
    expect(isExpectedFailure(new Error('validation_failed'))).toBe(false);
  });
});

describe('errorMessageOf', () => {
  const CONTACT_GUIDANCE = '解決しない場合はお問い合わせください。';
  const WITH_CONTACT =
    'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
  const WITHOUT_CONTACT =
    'ページを表示できませんでした。時間をおいて再度お試しください。';

  test.each([true, false])(
    'GraphQLClientErrorには、問い合わせの導線の有無(%p)によらずそのメッセージを返す',
    (contactAvailable) => {
      const error = new GraphQLClientError({
        code: 'internal_error',
        message: '問題が発生しました。時間をおいて再度お試しください。',
        status: 500,
      });

      expect(errorMessageOf(error, contactAvailable)).toBe(error.message);
    },
  );

  test.each([
    ['Error', new Error('Cannot read properties of undefined')],
    ['Errorでない値', 'redacted'],
    ['undefined', undefined],
  ])(
    'GraphQLClientErrorでない例外(%s)には、例外の文言を出さず問い合わせの導線がある側の想定外のエラーの文言を返す',
    (_name, error) => {
      expect(errorMessageOf(error, true)).toBe(WITH_CONTACT);
    },
  );

  test.each([
    ['Error', new Error('Cannot read properties of undefined')],
    ['Errorでない値', 'redacted'],
    ['undefined', undefined],
  ])(
    'GraphQLClientErrorでない例外(%s)には、問い合わせの導線が無い側では問い合わせを促さない文言を返す',
    (_name, error) => {
      const message = errorMessageOf(error, false);

      expect(message).toBe(WITHOUT_CONTACT);
      expect(message).not.toContain(CONTACT_GUIDANCE);
    },
  );

  test('通信の失敗と解釈できない応答の文言は、問い合わせを促す文を含まない', () => {
    const networkError = createNetworkError(new TypeError('Failed to fetch'));
    const invalid = errorOf(parse({ status: 502, body: '<html></html>' }));

    expect(invalid.code).toBe('invalid_response');
    for (const error of [networkError, invalid]) {
      expect(error.message).not.toContain(CONTACT_GUIDANCE);
      expect(errorMessageOf(error, false)).toBe(error.message);
    }
  });
});
