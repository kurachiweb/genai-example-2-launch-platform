import { GraphQLError } from 'graphql';
import { createSchema, createYoga, type Plugin } from 'graphql-yoga';
import { describe, expect, type Mock, test, vi } from 'vitest';

import {
  aliasQuery,
  costQuery,
  depthQuery,
  directiveQuery,
  tokenQuery,
} from '../../../test/support/query-limit-harness.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { INTERNAL_ERROR_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { dateTimeScalar } from './date-time-scalar.ts';
import type { GatewayErrorCode } from './error-codes.ts';
import { createErrorPolicy, type ErrorPolicyOptions } from './error-policy.ts';
import {
  createOperationAllowlist,
  createPersistedOperationsPlugin,
} from './operation-allowlist.ts';
import { createQueryLimitPlugins } from './query-limits.ts';

interface ResponseError {
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly extensions?: Record<string, unknown>;
}

interface PolicyResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: {
    readonly data?: Record<string, unknown> | null;
    readonly errors?: readonly ResponseError[];
  };
}

const SECRET = `lsk_${'ZyXwVuTsRq'.repeat(4)}P_-`;

const TYPE_DEFS = /* GraphQL */ `
  scalar DateTime

  type Query {
    limited: Int
    limitedWithoutRetry: Int
    unavailable: Int
    invalid: Int
    unauthenticated: Int
    broken: Int
    nonNull: Int!
    spoofedInternal: Int
    spoofedRejection: Int
    value: Int
    echo(n: Int!): Int
    at(time: DateTime!): Int
    node: Node
  }

  type Node {
    child: Node
    value: Int
  }
`;

const VALIDATION_DETAILS = [
  { field: 'title', message: 'タイトルを入力してください。', code: 'required' },
];

function fail(error: Error): () => never {
  return () => {
    throw error;
  };
}

const RESOLVERS = {
  DateTime: dateTimeScalar,
  Query: {
    limited: fail(
      new AppError({
        kind: 'rate_limited',
        code: 'rate_limit_exceeded',
        message: '操作が集中しています。',
        retryAfterSeconds: 30,
      }),
    ),
    limitedWithoutRetry: fail(
      new AppError({
        kind: 'rate_limited',
        code: 'rate_limit_exceeded',
        message: '操作が集中しています。',
      }),
    ),
    unavailable: fail(
      new AppError({
        kind: 'unavailable',
        code: 'bot_verification_unavailable',
        message: '確認を行えませんでした。',
        retryAfterSeconds: 5,
      }),
    ),
    invalid: fail(
      new AppError({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: VALIDATION_DETAILS,
      }),
    ),
    unauthenticated: fail(
      new AppError({
        kind: 'unauthenticated',
        code: 'unauthenticated',
        message: 'ログインが必要です。',
      }),
    ),
    broken: () => {
      throw new TypeError(`設定の読み込みに失敗しました: ${SECRET}`);
    },
    nonNull: () => null,
    spoofedInternal: fail(
      new GraphQLError(`内部の詳細: ${SECRET}`, {
        extensions: { code: 'internal_error' },
      }),
    ),
    spoofedRejection: fail(
      new GraphQLError(`内部の詳細: ${SECRET}`, {
        extensions: { code: 'persisted_operation_not_found' },
      }),
    ),
    value: () => 1,
    echo: (_parent: unknown, args: { readonly n: number }) => args.n,
    at: () => 1,
    node: () => ({}),
  },
  Node: { child: () => ({}), value: () => 1 },
};

const ALLOWLIST = createOperationAllowlist({
  version: 1,
  operations: { client: {}, admin: {} },
});

const ARBITRARY_HEADER = 'x-test-allow-arbitrary';
const ALLOW_ARBITRARY = '1';

interface PolicyHarness {
  readonly reportUnexpected: Mock<ErrorPolicyOptions['reportUnexpected']>;
  readonly send: (
    body: string,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<PolicyResponse>;
}

function createHarness(
  extra: { readonly context?: () => Record<string, unknown> } = {},
): PolicyHarness {
  const reportUnexpected = vi.fn<ErrorPolicyOptions['reportUnexpected']>();
  const policy = createErrorPolicy({ reportUnexpected });
  const plugins: Plugin[] = [
    ...createQueryLimitPlugins({
      exposeLimits: false,
      blockFieldSuggestion: true,
    }),
    createPersistedOperationsPlugin(ALLOWLIST, {
      allowArbitrary: (request) =>
        request.headers.get(ARBITRARY_HEADER) === ALLOW_ARBITRARY,
    }),
    policy.plugin,
  ];
  const yoga = createYoga({
    schema: createSchema({ typeDefs: TYPE_DEFS, resolvers: RESOLVERS }),
    batching: false,
    logging: false,
    extraParamNames: ['documentId'],
    maskedErrors: { maskError: policy.maskError },
    plugins,
    ...(extra.context && { context: extra.context }),
  });
  const send = async (
    body: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<PolicyResponse> => {
    const response = await yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [ARBITRARY_HEADER]: ALLOW_ARBITRARY,
        ...headers,
      },
      body,
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      body: JSON.parse(text) as PolicyResponse['body'],
    };
  };
  return { reportUnexpected, send };
}

function operation(
  query: string,
  variables?: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(
    variables === undefined ? { query } : { query, variables },
  );
}

function errorCodes(response: PolicyResponse): readonly unknown[] {
  return (response.body.errors ?? []).map((error) => error.extensions?.code);
}

describe('共通エラー型の失敗', () => {
  test('コード・メッセージ・項目ごとの詳細を返し、状態コードは200のままにする', async () => {
    const harness = createHarness();

    const response = await harness.send(operation('{ invalid }'));

    expect(response.status).toBe(200);
    expect(response.body.data).toStrictEqual({ invalid: null });
    expect(response.body.errors).toStrictEqual([
      {
        message: '入力内容を確認してください。',
        locations: [{ line: 1, column: 3 }],
        path: ['invalid'],
        extensions: { code: 'validation_error', details: VALIDATION_DETAILS },
      },
    ]);
  });

  test('詳細を持たない失敗はextensionsにコードだけを持つ', async () => {
    const harness = createHarness();

    const response = await harness.send(operation('{ unauthenticated }'));

    expect(response.status).toBe(200);
    expect(response.body.errors).toMatchObject([
      {
        message: 'ログインが必要です。',
        extensions: { code: 'unauthenticated' },
      },
    ]);
    expect(response.body.errors?.[0]?.extensions).toStrictEqual({
      code: 'unauthenticated',
    });
  });

  test.each([
    ['回数超過', 429, 'limited', 'rate_limit_exceeded', '30'],
    ['一時的な障害', 503, 'unavailable', 'bot_verification_unavailable', '5'],
  ])(
    '%sは状態コード%iとRetry-Afterを付ける',
    async (_label, status, field, code, retryAfter) => {
      const harness = createHarness();

      const response = await harness.send(operation(`{ ${field} }`));

      expect(response.status).toBe(status);
      expect(response.headers.get('Retry-After')).toBe(retryAfter);
      expect(response.body.errors?.[0]?.extensions).toStrictEqual({ code });
    },
  );

  test('再試行までの秒数を持たない回数超過は429だけを付ける', async () => {
    const harness = createHarness();

    const response = await harness.send(operation('{ limitedWithoutRetry }'));

    expect(response.status).toBe(429);
    expect(response.headers.has('Retry-After')).toBe(false);
  });

  test('回数超過と一時的な障害が混ざると大きい方の状態コードになる', async () => {
    const harness = createHarness();

    const response = await harness.send(operation('{ limited unavailable }'));

    expect(response.status).toBe(503);
    expect(errorCodes(response)).toStrictEqual([
      'rate_limit_exceeded',
      'bot_verification_unavailable',
    ]);
  });

  test('不正な日時の変数は日時の共通エラー型のコードを返す', async () => {
    const harness = createHarness();

    const response = await harness.send(
      operation('query ($time: DateTime!) { at(time: $time) }', {
        time: '2026-10-26',
      }),
    );

    expect(errorCodes(response)).toStrictEqual(['validation_error']);
    expect(response.body.errors?.[0]?.message).toBe(
      '日時はオフセット付きのRFC 3339形式の文字列で指定してください。',
    );
  });

  test('共通エラー型の失敗は送信しない', async () => {
    const harness = createHarness();

    await harness.send(
      operation('{ limited unavailable invalid unauthenticated value }'),
    );

    expect(harness.reportUnexpected).not.toHaveBeenCalled();
  });
});

describe('想定外の例外', () => {
  test('内部の詳細を伏せた定型の文言とinternal_errorで返し、ログ・送信を1回だけ呼ぶ', async () => {
    const harness = createHarness();

    const response = await harness.send(operation('{ broken value }'));

    expect(response.status).toBe(200);
    expect(response.body.data).toStrictEqual({ broken: null, value: 1 });
    expect(response.body.errors).toStrictEqual([
      {
        message: INTERNAL_ERROR_RESPONSE.body.error.message,
        locations: [{ line: 1, column: 3 }],
        path: ['broken'],
        extensions: { code: 'internal_error' },
      },
    ]);
    expect(response.text).not.toContain('設定の読み込み');
    expect(response.text).not.toContain(SECRET);
    expect(response.text).not.toContain('TypeError');
    expect(harness.reportUnexpected).toHaveBeenCalledOnce();
    const [reported] = harness.reportUnexpected.mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(TypeError);
    expect((reported as Error).message).toContain(SECRET);
  });

  test('pathを持つ実行時のGraphQLのエラーも想定外として伏せる', async () => {
    const harness = createHarness();

    const response = await harness.send(operation('{ nonNull }'));

    expect(response.body.data).toBeNull();
    expect(response.body.errors).toMatchObject([
      {
        message: INTERNAL_ERROR_RESPONSE.body.error.message,
        path: ['nonNull'],
        extensions: { code: 'internal_error' },
      },
    ]);
    expect(response.text).not.toContain('Cannot return null');
    expect(harness.reportUnexpected).toHaveBeenCalledOnce();
  });

  test.each([
    ['internal_error', 'spoofedInternal'],
    ['persisted_operation_not_found', 'spoofedRejection'],
  ])(
    'リゾルバが投げた%sのコードを持つGraphQLのエラーも内部の詳細を伏せて送信する',
    async (_code, field) => {
      const harness = createHarness();

      const response = await harness.send(operation(`{ ${field} }`));

      expect(response.status).toBe(200);
      expect(response.body.errors).toMatchObject([
        {
          message: INTERNAL_ERROR_RESPONSE.body.error.message,
          path: [field],
          extensions: { code: 'internal_error' },
        },
      ]);
      expect(response.text).not.toContain('内部の詳細');
      expect(response.text).not.toContain(SECRET);
      expect(harness.reportUnexpected).toHaveBeenCalledOnce();
    },
  );

  test('データを持たない応答では500になる', async () => {
    const harness = createHarness({
      context: () => {
        throw new TypeError(`文脈の組み立てに失敗しました: ${SECRET}`);
      },
    });

    const response = await harness.send(operation('{ value }'));

    expect(response.status).toBe(500);
    expect(response.body.data).toBeUndefined();
    expect(response.body.errors).toStrictEqual([
      {
        message: INTERNAL_ERROR_RESPONSE.body.error.message,
        extensions: { code: 'internal_error' },
      },
    ]);
    expect(response.text).not.toContain(SECRET);
    expect(harness.reportUnexpected).toHaveBeenCalledOnce();
  });

  test('pathを持たずinternal_errorのコードを持つGraphQLのエラーも内部の詳細を伏せて送信する', async () => {
    const harness = createHarness({
      context: () => {
        throw new GraphQLError(`内部の詳細: ${SECRET}`, {
          extensions: { code: 'internal_error' },
        });
      },
    });

    const response = await harness.send(operation('{ value }'));

    expect(response.status).toBe(500);
    expect(response.body.errors).toStrictEqual([
      {
        message: INTERNAL_ERROR_RESPONSE.body.error.message,
        extensions: { code: 'internal_error' },
      },
    ]);
    expect(response.text).not.toContain(SECRET);
    expect(harness.reportUnexpected).toHaveBeenCalledOnce();
  });

  test('伏せた後のエラーを再びマスキングしても変えず、送信しない', () => {
    const reportUnexpected = vi.fn<ErrorPolicyOptions['reportUnexpected']>();
    const { maskError } = createErrorPolicy({ reportUnexpected });
    const masked = maskError(new TypeError(SECRET), 'Unexpected error.');

    const remasked = maskError(masked, 'Unexpected error.');

    expect(remasked).toBe(masked);
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });
});

const DOCUMENT_REJECTION_CASES = [
  ['構文の誤り', 'graphql_parse_failed', '{ value'],
  ['スキーマとの不一致', 'graphql_validation_failed', '{ valeu }'],
  ['深さの上限', 'query_depth_exceeded', depthQuery(9)],
  ['コストの上限', 'query_cost_exceeded', costQuery(289)],
  ['エイリアスの上限', 'query_aliases_exceeded', aliasQuery(16)],
  ['ディレクティブの上限', 'query_directives_exceeded', directiveQuery(51)],
  ['字句の上限', 'query_tokens_exceeded', tokenQuery(1001)],
] as const satisfies readonly (readonly [string, GatewayErrorCode, string])[];

describe('実行前の拒否', () => {
  test.each(DOCUMENT_REJECTION_CASES)(
    '%sは%sと400で拒否する',
    async (_label, code, query) => {
      const harness = createHarness();

      const response = await harness.send(operation(query));

      expect(response.status).toBe(400);
      expect(response.body.data).toBeUndefined();
      expect(errorCodes(response)).toStrictEqual([code]);
      expect(harness.reportUnexpected).not.toHaveBeenCalled();
    },
  );

  test.each(DOCUMENT_REJECTION_CASES)(
    '同じ%sの2回目の要求も%sと400で拒否する',
    async (_label, code, query) => {
      const harness = createHarness();

      await harness.send(operation(query));
      const second = await harness.send(operation(query));

      expect(second.status).toBe(400);
      expect(errorCodes(second)).toStrictEqual([code]);
    },
  );

  test('application/jsonを受け付ける要求でも検証の失敗を400にする', async () => {
    const harness = createHarness();

    const response = await harness.send(operation('{ valeu }'), {
      accept: 'application/json',
    });

    expect(response.status).toBe(400);
    expect(errorCodes(response)).toStrictEqual(['graphql_validation_failed']);
  });

  test('許可リストの拒否はpersisted operationsのコードと400を保つ', async () => {
    const harness = createHarness();

    const required = await harness.send(operation('{ value }'), {
      [ARBITRARY_HEADER]: '0',
    });

    expect(required.status).toBe(400);
    expect(errorCodes(required)).toStrictEqual([
      'persisted_operation_required',
    ]);
    expect(harness.reportUnexpected).not.toHaveBeenCalled();
  });
});

describe('要求の不正', () => {
  test.each([
    [
      'バッチ',
      JSON.stringify([{ query: '{ value }' }, { query: '{ value }' }]),
    ],
    [
      '変数の型の不一致',
      operation('query ($n: Int!) { echo(n: $n) }', { n: 'abc' }),
    ],
    ['必須の変数の欠落', operation('query ($n: Int!) { echo(n: $n) }')],
    ['JSONでない本文', '{'],
    [
      'オブジェクトでない変数',
      JSON.stringify({ query: '{ value }', variables: 1 }),
    ],
  ])('%sはgraphql_request_invalidと400で拒否する', async (_label, body) => {
    const harness = createHarness();

    const response = await harness.send(body);

    expect(response.status).toBe(400);
    expect(response.body.data).toBeUndefined();
    expect(errorCodes(response)).toStrictEqual(['graphql_request_invalid']);
    expect(
      Object.keys(response.body.errors?.[0]?.extensions ?? {}),
    ).toStrictEqual(['code']);
    expect(harness.reportUnexpected).not.toHaveBeenCalled();
  });
});
