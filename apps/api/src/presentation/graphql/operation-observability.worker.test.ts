import { resetSync } from '@logtape/logtape';
import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import {
  createSchema,
  createYoga,
  type YogaInitialContext,
} from 'graphql-yoga';
import { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';

import { ensureLoggingConfigured } from '../../../lib/workers/logging/configure-logging.ts';
import {
  buildSentryOptions,
  createSentryMiddleware,
  type SentryEnv,
  type SentryOptionsFactory,
} from '../../../lib/workers/observability/sentry.ts';
import {
  type CallerKind,
  GATEWAY_HEADERS,
} from '../gateway/gateway-headers.ts';
import { createErrorPolicy } from './error-policy.ts';
import {
  createOperationObservabilityPlugin,
  createOperationObservation,
  logOperation,
  type OperationObservabilityContext,
  type OperationObservation,
} from './operation-observability.ts';

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly items: SentItem[];
}

interface SentSpan {
  readonly name: string;
  readonly trace_id: string;
  readonly parent_span_id?: string;
  readonly is_segment: boolean;
  readonly attributes: Record<string, { readonly value: unknown } | undefined>;
}

interface InvokeOptions {
  readonly caller?: CallerKind;
  readonly variables?: Record<string, unknown>;
  readonly operationName?: string;
  readonly headers?: Record<string, string>;
  readonly recording?: RecordingFetch;
}

interface InvokeResult {
  readonly response: Response;
  readonly observation: OperationObservation;
}

const OPERATION_CATEGORY = 'api.graphql.operation';

const EXECUTE_OP = 'graphql.execute';

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const TEST_ENV: SentryEnv = { SENTRY_ENVIRONMENT: 'test' };

const VARIABLE_VALUE = 'variable-value-must-not-be-logged';
const SESSION_TOKEN = 'A'.repeat(43);
const BOT_TOKEN = 'bot-token-must-not-be-logged';

const INCOMING_TRACE_ID = '0123456789abcdef0123456789abcdef';
const INCOMING_PARENT_SPAN_ID = 'fedcba9876543210';

const SCHEMA = createSchema<OperationObservabilityContext & YogaInitialContext>(
  {
    typeDefs: /* GraphQL */ `
      type Query {
        value(input: String): Int
        broken: Int
      }

      type Mutation {
        touch: Int
      }
    `,
    resolvers: {
      Query: {
        value: () => 1,
        broken: () => {
          throw new TypeError('想定外の失敗です');
        },
      },
      Mutation: { touch: () => 1 },
    },
  },
);

function configureRecordingLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  const methods: Record<ConsoleMethod, typeof record> = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: methods as unknown as Console,
  });
  return logs;
}

function operationLogs(logs: readonly LoggedObject[]): LoggedObject[] {
  return logs.filter((log) => log.category === OPERATION_CATEGORY);
}

function decodeBody(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new TypeError('想定外の送信本文の形式です');
}

// エンベロープは改行区切りのJSONで、先頭のヘッダーの後に項目のヘッダーと本体が交互に並ぶ
function parseEnvelope(text: string): SentItem[] {
  const [, ...lines] = text.split('\n').filter((line) => line !== '');
  const items: SentItem[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? '') as { type: string };
    const payload = JSON.parse(lines[index + 1] ?? '') as Record<
      string,
      unknown
    >;
    items.push({ type: header.type, payload });
  }
  return items;
}

function createRecordingFetch(): RecordingFetch {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  return { fetch: recordingFetch as typeof fetch, items };
}

// 送信前の除去処理を含む実際の初期化のオプションに、送信先の差し替えだけを加える
function sentryOptions(
  recording: RecordingFetch | undefined,
): SentryOptionsFactory<SentryEnv> {
  return (): CloudflareOptions => ({
    ...buildSentryOptions({
      dsn: recording === undefined ? undefined : TEST_DSN,
      environment: 'test',
      tracesSampleRate: 1,
    }),
    cacheClient: false,
    ...(recording && { transportOptions: { fetch: recording.fetch } }),
  });
}

function createTestYoga() {
  const policy = createErrorPolicy({ reportUnexpected: () => undefined });
  return createYoga<OperationObservabilityContext>({
    schema: SCHEMA,
    plugins: [policy.plugin, createOperationObservabilityPlugin()],
    maskedErrors: { maskError: policy.maskError },
    logging: false,
  });
}

async function invoke(
  query: string,
  options: InvokeOptions = {},
): Promise<InvokeResult> {
  const caller = options.caller ?? 'client';
  const observation = createOperationObservation();
  const yoga = createTestYoga();
  const app = new Hono<{ Bindings: SentryEnv }>();
  app.use(createSentryMiddleware(app, sentryOptions(options.recording)));
  app.post('/graphql', async (c) => {
    const startedAt = Date.now();
    const response = await yoga.fetch(c.req.raw, {
      scope: { access: { caller }, observation },
    });
    logOperation({
      caller,
      observation,
      durationMs: Date.now() - startedAt,
      status: response.status,
    });
    return response;
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request('https://api.example/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify({
        query,
        ...(options.operationName !== undefined && {
          operationName: options.operationName,
        }),
        ...(options.variables !== undefined && {
          variables: options.variables,
        }),
      }),
    }),
    TEST_ENV,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { response, observation };
}

// 逐次送信のスパンは、項目spanの本体のitemsにまとめて入る
function sentSpans(recording: RecordingFetch): SentSpan[] {
  return recording.items
    .filter((item) => item.type === 'span')
    .flatMap(({ payload }) => (payload.items ?? []) as SentSpan[]);
}

function rootSpanOf(spans: readonly SentSpan[]): SentSpan | undefined {
  return spans.find((span) => span.is_segment);
}

function executeSpansOf(spans: readonly SentSpan[]): SentSpan[] {
  return spans.filter(
    (span) => span.attributes['sentry.op']?.value === EXECUTE_OP,
  );
}

function operationAttributes(
  span: SentSpan | undefined,
): Record<string, unknown> {
  const attributes = span?.attributes ?? {};
  return {
    name: attributes['graphql.operation.name']?.value,
    type: attributes['graphql.operation.type']?.value,
    caller: attributes['graphql.caller']?.value,
  };
}

function observed(observation: OperationObservation): Record<string, unknown> {
  return {
    operationName: observation.operationName,
    operationType: observation.operationType,
    errorCodes: [...observation.errorCodes],
  };
}

afterAll(() => {
  resetSync();
});

describe('createOperationObservation', () => {
  test('操作名と種類が未確定で、エラーコードが空の記録を作る', () => {
    expect(observed(createOperationObservation())).toStrictEqual({
      operationName: undefined,
      operationType: undefined,
      errorCodes: [],
    });
  });
});

describe('createOperationObservabilityPlugin', () => {
  test.each([
    {
      query: 'query ReadValue { value }',
      operationName: 'ReadValue',
      operationType: 'query',
    },
    {
      query: 'mutation Touch { touch }',
      operationName: 'Touch',
      operationType: 'mutation',
    },
    { query: '{ value }', operationName: undefined, operationType: 'query' },
  ])(
    '実行した操作$queryの操作名と種類を記録する',
    async ({ query, operationName, operationType }) => {
      const { response, observation } = await invoke(query);

      expect(response.status).toBe(200);
      expect(observed(observation)).toStrictEqual({
        operationName,
        operationType,
        errorCodes: [],
      });
    },
  );

  test('複数の操作を含む文書では、operationNameで選んだ操作を記録する', async () => {
    const { observation } = await invoke(
      'query ReadValue { value } mutation Touch { touch }',
      { operationName: 'Touch' },
    );

    expect(observed(observation)).toStrictEqual({
      operationName: 'Touch',
      operationType: 'mutation',
      errorCodes: [],
    });
  });

  test('実行前に拒否した操作でも、解析できれば操作名と種類を、伏せた後のエラーコードとともに記録する', async () => {
    const { response, observation } = await invoke('query Missing { missing }');

    expect(response.status).toBe(400);
    expect(observed(observation)).toStrictEqual({
      operationName: 'Missing',
      operationType: 'query',
      errorCodes: ['graphql_validation_failed'],
    });
  });

  test('解析できない操作では、操作名と種類を記録せずエラーコードだけを記録する', async () => {
    const { response, observation } = await invoke('query Broken {');

    expect(response.status).toBe(400);
    expect(observed(observation)).toStrictEqual({
      operationName: undefined,
      operationType: undefined,
      errorCodes: ['graphql_parse_failed'],
    });
  });

  test('想定外の例外は伏せた後のコードで記録し、同じコードは1つにまとめる', async () => {
    const { observation } = await invoke(
      'query Fails { first: broken second: broken }',
    );

    expect(observed(observation)).toStrictEqual({
      operationName: 'Fails',
      operationType: 'query',
      errorCodes: ['internal_error'],
    });
  });
});

describe('logOperation', () => {
  test('成功した操作の操作名・種類・呼び出し元・結果・エラーコード・状態コード・処理時間を、infoで1件出す', () => {
    const logs = configureRecordingLogs();

    logOperation({
      caller: 'admin',
      observation: {
        operationName: 'ReadValue',
        operationType: 'query',
        errorCodes: [],
      },
      durationMs: 12,
      status: 200,
    });

    expect(operationLogs(logs)).toStrictEqual([
      expect.objectContaining({
        level: 'info',
        operationName: 'ReadValue',
        operationType: 'query',
        caller: 'admin',
        outcome: 'ok',
        errorCodes: [],
        status: 200,
        durationMs: 12,
      }),
    ]);
  });

  test('エラーコードがあれば、結果をerrorとしてwarningで出す', () => {
    const logs = configureRecordingLogs();

    logOperation({
      caller: 'client',
      observation: {
        operationName: 'Missing',
        operationType: 'query',
        errorCodes: ['graphql_validation_failed'],
      },
      durationMs: 3,
      status: 400,
    });

    expect(operationLogs(logs)).toStrictEqual([
      expect.objectContaining({
        level: 'warning',
        outcome: 'error',
        errorCodes: ['graphql_validation_failed'],
        status: 400,
      }),
    ]);
  });

  test('エラーコードが無くても状態コードが400以上なら、結果をerrorとしてwarningで出す', () => {
    const logs = configureRecordingLogs();

    logOperation({
      caller: 'client',
      observation: createOperationObservation(),
      durationMs: 1,
      status: 415,
    });

    expect(operationLogs(logs)).toStrictEqual([
      expect.objectContaining({
        level: 'warning',
        outcome: 'error',
        errorCodes: [],
        status: 415,
      }),
    ]);
  });

  test('操作名と種類が分からなければnullとして出す', () => {
    const logs = configureRecordingLogs();

    logOperation({
      caller: 'client',
      observation: {
        operationName: undefined,
        operationType: undefined,
        errorCodes: ['graphql_parse_failed'],
      },
      durationMs: 1,
      status: 400,
    });

    expect(operationLogs(logs)).toStrictEqual([
      expect.objectContaining({ operationName: null, operationType: null }),
    ]);
  });

  test('GraphQLの要求の処理を終えると操作ログを1件出し、変数・セッション識別子・bot判定のトークンをどのログにも含めない', async () => {
    const logs = configureRecordingLogs();

    const { response } = await invoke(
      'query ReadValue($input: String) { value(input: $input) }',
      {
        caller: 'admin',
        variables: { input: VARIABLE_VALUE },
        headers: {
          [GATEWAY_HEADERS.sessionToken]: SESSION_TOKEN,
          [GATEWAY_HEADERS.botToken]: BOT_TOKEN,
        },
      },
    );

    expect(response.status).toBe(200);
    const [operationLog, ...rest] = operationLogs(logs);
    expect(rest).toHaveLength(0);
    expect(operationLog).toMatchObject({
      level: 'info',
      operationName: 'ReadValue',
      operationType: 'query',
      caller: 'admin',
      outcome: 'ok',
      errorCodes: [],
      status: 200,
    });
    expect(operationLog?.durationMs).toEqual(expect.any(Number));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(VARIABLE_VALUE);
    expect(serialized).not.toContain(SESSION_TOKEN);
    expect(serialized).not.toContain(BOT_TOKEN);
  });
});

describe('トレース', () => {
  test('実行した操作では、ルートのスパンの名前を経路の名前のまま3つの属性を付け、操作名入りの実行の子のスパンを作る', async () => {
    const recording = createRecordingFetch();

    await invoke('query ReadValue { value }', { caller: 'admin', recording });

    const spans = sentSpans(recording);
    const root = rootSpanOf(spans);
    expect(root?.name).toBe('POST /graphql');
    expect(operationAttributes(root)).toStrictEqual({
      name: 'ReadValue',
      type: 'query',
      caller: 'admin',
    });
    const executeSpans = executeSpansOf(spans);
    expect(executeSpans.map(({ name }) => name)).toStrictEqual([
      'graphql query ReadValue',
    ]);
    expect(executeSpans[0]?.trace_id).toBe(root?.trace_id);
    expect(operationAttributes(executeSpans[0])).toStrictEqual({
      name: 'ReadValue',
      type: 'query',
      caller: 'admin',
    });
  });

  test('操作名の無い操作では、実行の子のスパンの名前を種類だけにし、操作名の属性を付けない', async () => {
    const recording = createRecordingFetch();

    await invoke('mutation { touch }', { recording });

    const spans = sentSpans(recording);
    expect(operationAttributes(rootSpanOf(spans))).toStrictEqual({
      name: undefined,
      type: 'mutation',
      caller: 'client',
    });
    const executeSpans = executeSpansOf(spans);
    expect(executeSpans.map(({ name }) => name)).toStrictEqual([
      'graphql mutation',
    ]);
    expect(operationAttributes(executeSpans[0])).toStrictEqual({
      name: undefined,
      type: 'mutation',
      caller: 'client',
    });
  });

  test('実行前に拒否した操作では、実行の子のスパンを作らず、ルートのスパンに解析できた操作名と種類と呼び出し元を付ける', async () => {
    const recording = createRecordingFetch();

    await invoke('query Missing { missing }', { recording });

    const spans = sentSpans(recording);
    expect(rootSpanOf(spans)?.name).toBe('POST /graphql');
    expect(operationAttributes(rootSpanOf(spans))).toStrictEqual({
      name: 'Missing',
      type: 'query',
      caller: 'client',
    });
    expect(executeSpansOf(spans)).toHaveLength(0);
  });

  test('解析できない操作では、ルートのスパンに呼び出し元だけを付ける', async () => {
    const recording = createRecordingFetch();

    await invoke('query Broken {', { caller: 'admin', recording });

    const spans = sentSpans(recording);
    expect(operationAttributes(rootSpanOf(spans))).toStrictEqual({
      name: undefined,
      type: undefined,
      caller: 'admin',
    });
    expect(executeSpansOf(spans)).toHaveLength(0);
  });

  test('中継の要求のsentry-traceとbaggageを受け取ると、ルートのスパンがそのトレースIDを引き継ぎ、親のスパンIDを受け取った値にする', async () => {
    const recording = createRecordingFetch();

    await invoke('query ReadValue { value }', {
      recording,
      headers: {
        'sentry-trace': `${INCOMING_TRACE_ID}-${INCOMING_PARENT_SPAN_ID}-1`,
        baggage: [
          `sentry-trace_id=${INCOMING_TRACE_ID}`,
          'sentry-environment=test',
          'sentry-public_key=publickey',
          'sentry-sample_rate=1',
          'sentry-sampled=true',
        ].join(','),
      },
    });

    const root = rootSpanOf(sentSpans(recording));
    expect(root?.name).toBe('POST /graphql');
    expect(root?.trace_id).toBe(INCOMING_TRACE_ID);
    expect(root?.parent_span_id).toBe(INCOMING_PARENT_SPAN_ID);
  });

  test('送ったスパンに、変数・セッション識別子・bot判定のトークンを含めない', async () => {
    const recording = createRecordingFetch();

    await invoke('query ReadValue($input: String) { value(input: $input) }', {
      recording,
      variables: { input: VARIABLE_VALUE },
      headers: {
        [GATEWAY_HEADERS.sessionToken]: SESSION_TOKEN,
        [GATEWAY_HEADERS.botToken]: BOT_TOKEN,
      },
    });

    expect(executeSpansOf(sentSpans(recording))).toHaveLength(1);
    const serialized = JSON.stringify(recording.items);
    expect(serialized).not.toContain(VARIABLE_VALUE);
    expect(serialized).not.toContain(SESSION_TOKEN);
    expect(serialized).not.toContain(BOT_TOKEN);
  });
});
