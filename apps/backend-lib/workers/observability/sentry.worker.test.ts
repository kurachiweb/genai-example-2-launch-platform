import { type CloudflareOptions, startSpan } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';

import { AppError, STATUS_BY_KIND } from '../../core/errors/app-error.ts';
import { REDACTED } from '../../core/logging/redaction.ts';
import { scrubEvent, scrubSpan } from '../../core/observability/scrub-event.ts';
import {
  buildSentryOptions,
  createSentryMiddleware,
  readSentryRuntimeOptions,
  type SentryEnv,
  type SentryOptionsFactory,
  type SentryRuntimeOptions,
  withSentryForScheduledAndQueue,
} from './sentry.ts';

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly items: SentItem[];
  readonly calls: { count: number };
}

interface TestBindings extends SentryEnv {
  readonly APP_NAME: string;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const API_KEY = `lsk_${'AbCdEfGhIj'.repeat(4)}K_-`;
const CLIENT_IP = '203.0.113.7';
const TEST_ENV: TestBindings = {
  APP_NAME: 'api',
  SENTRY_ENVIRONMENT: 'test',
  SENTRY_TRACES_SAMPLE_RATE: '0',
};

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
  const calls = { count: 0 };
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.count += 1;
    items.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  return { fetch: recordingFetch as typeof fetch, items, calls };
}

function createFailingFetch(): RecordingFetch {
  const calls = { count: 0 };
  const failingFetch = () => {
    calls.count += 1;
    return Promise.reject(new TypeError('送信先に接続できません'));
  };
  return { fetch: failingFetch as unknown as typeof fetch, items: [], calls };
}

function runtimeOptions(
  overrides: Partial<SentryRuntimeOptions> = {},
): SentryRuntimeOptions {
  return {
    dsn: TEST_DSN,
    environment: 'test',
    tracesSampleRate: 0,
    ...overrides,
  };
}

// 呼び出しごとに設定を変えて確かめるため、isolateでのクライアントの使い回しを切る
function optionsFactory(
  runtime: SentryRuntimeOptions,
  recording: RecordingFetch,
): SentryOptionsFactory<TestBindings> {
  return (): CloudflareOptions => ({
    ...buildSentryOptions(runtime),
    cacheClient: false,
    transportOptions: { fetch: recording.fetch },
  });
}

function createTestApp(
  options: SentryOptionsFactory<TestBindings>,
): Hono<{ Bindings: TestBindings }> {
  const app = new Hono<{ Bindings: TestBindings }>();
  app.use(createSentryMiddleware(app, options));
  app.get('/ok', (c) => c.json({ status: 'ok' }));
  app.get('/unexpected', () => {
    throw new Error('想定外の失敗です');
  });
  app.get('/leaky', () => {
    throw new Error(`外部APIの呼び出しに失敗しました: ${API_KEY}`);
  });
  app.get('/keys/:key', (c) =>
    startSpan(
      { name: `外部APIの呼び出し ${c.req.param('key')}`, op: 'http.client' },
      () => c.json({ status: 'ok' }),
    ),
  );
  app.get('/expected', () => {
    throw new AppError({
      kind: 'not_found',
      code: 'post_not_found',
      message: 'お探しの投稿は見つかりませんでした。',
    });
  });
  app.onError((error, c) =>
    error instanceof AppError
      ? c.json({ code: error.code }, STATUS_BY_KIND[error.kind])
      : c.json({ code: 'internal_error' }, 500),
  );
  return app;
}

async function invoke(
  app: Hono<{ Bindings: TestBindings }>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.example${path}`, init),
    TEST_ENV,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function itemsOfType(recording: RecordingFetch, type: string): SentItem[] {
  return recording.items.filter((item) => item.type === type);
}

interface SentSpan {
  readonly name: string;
  readonly attributes: Record<string, { readonly value: unknown }>;
}

// 逐次送信のスパンは、項目spanの本体のitemsにまとめて入る
function sentSpans(recording: RecordingFetch): SentSpan[] {
  return itemsOfType(recording, 'span').flatMap(
    ({ payload }) => (payload.items ?? []) as SentSpan[],
  );
}

function exceptionValues(item: SentItem): string[] {
  const exception = item.payload.exception as
    { values?: { value?: string }[] } | undefined;
  return (exception?.values ?? []).map(({ value }) => value ?? '');
}

describe('readSentryRuntimeOptions', () => {
  test('送信先・環境・トレースの割合を環境の変数から読む', () => {
    expect(
      readSentryRuntimeOptions({
        SENTRY_DSN: TEST_DSN,
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_TRACES_SAMPLE_RATE: '0.1',
      }),
    ).toStrictEqual({
      dsn: TEST_DSN,
      environment: 'staging',
      tracesSampleRate: 0.1,
    });
  });

  test.each([undefined, ''])('送信先が%jなら送信先なしとする', (dsn) => {
    expect(
      readSentryRuntimeOptions({
        SENTRY_DSN: dsn,
        SENTRY_ENVIRONMENT: 'local',
        SENTRY_TRACES_SAMPLE_RATE: '0',
      }).dsn,
    ).toBeUndefined();
  });

  test.each([undefined, '', 'abc', '-0.1', '1.5', 'Infinity'])(
    'トレースの割合が%jなら0にする',
    (rate) => {
      expect(
        readSentryRuntimeOptions({
          SENTRY_ENVIRONMENT: 'local',
          SENTRY_TRACES_SAMPLE_RATE: rate,
        }).tracesSampleRate,
      ).toBe(0);
    },
  );

  test('環境の検証より前に呼ばれ環境の名前が欠けていても、unknownとして続ける', () => {
    expect(readSentryRuntimeOptions({}).environment).toBe('unknown');
  });
});

describe('buildSentryOptions', () => {
  test('送信先が無ければ無効にする', () => {
    expect(
      buildSentryOptions(runtimeOptions({ dsn: undefined })),
    ).toMatchObject({ enabled: false });
  });

  test('送信先があれば有効にし、環境とトレースの割合を設定する', () => {
    expect(
      buildSentryOptions(
        runtimeOptions({ environment: 'prod', tracesSampleRate: 0.1 }),
      ),
    ).toMatchObject({
      dsn: TEST_DSN,
      enabled: true,
      environment: 'prod',
      tracesSampleRate: 0.1,
    });
  });

  test('送信前の処理にイベントとスパンの両方の除去処理をつなぎ、スパンを逐次送信のまま送る', () => {
    const options = buildSentryOptions(runtimeOptions());

    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeSendSpan).toBe(scrubSpan);
    expect(options.traceLifecycle).toBeUndefined();
    expect(Object.keys(options)).not.toContain('beforeSendTransaction');
  });

  test('利用者の情報・Cookie・ヘッダー・クエリ文字列・本文などを集めない', () => {
    expect(buildSentryOptions(runtimeOptions()).dataCollection).toStrictEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});

describe('createSentryMiddleware', () => {
  test('想定外の例外を1回だけ送り、応答は例外の変換のとおりになる', async () => {
    const recording = createRecordingFetch();
    const app = createTestApp(optionsFactory(runtimeOptions(), recording));

    const response = await invoke(app, '/unexpected');

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ code: 'internal_error' });
    const events = itemsOfType(recording, 'event');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.environment).toBe('test');
    expect(exceptionValues(events[0] as SentItem)).toStrictEqual([
      '想定外の失敗です',
    ]);
  });

  test('共通エラー型で表した想定内の失敗は送らない', async () => {
    const recording = createRecordingFetch();
    const app = createTestApp(optionsFactory(runtimeOptions(), recording));

    const response = await invoke(app, '/expected');

    expect(response.status).toBe(404);
    expect(itemsOfType(recording, 'event')).toHaveLength(0);
  });

  test('送信先が無ければ送信せず、処理単位を失敗させない', async () => {
    const recording = createRecordingFetch();
    const app = createTestApp(
      optionsFactory(runtimeOptions({ dsn: undefined }), recording),
    );

    const failed = await invoke(app, '/unexpected');
    const succeeded = await invoke(app, '/ok');

    expect(failed.status).toBe(500);
    expect(succeeded.status).toBe(200);
    expect(recording.calls.count).toBe(0);
  });

  test('送信に失敗しても応答を変えない', async () => {
    const failing = createFailingFetch();
    const app = createTestApp(
      optionsFactory(runtimeOptions({ tracesSampleRate: 1 }), failing),
    );

    const failed = await invoke(app, '/unexpected');
    const succeeded = await invoke(app, '/ok');

    expect(failing.calls.count).toBeGreaterThan(0);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toStrictEqual({ code: 'internal_error' });
    expect(succeeded.status).toBe(200);
    expect(await succeeded.json()).toStrictEqual({ status: 'ok' });
  });

  test('メッセージに公開APIのキーを含む想定外の例外を伏せ字にして送る', async () => {
    const recording = createRecordingFetch();
    const app = createTestApp(optionsFactory(runtimeOptions(), recording));

    await invoke(app, '/leaky');

    const events = itemsOfType(recording, 'event');
    expect(events).toHaveLength(1);
    expect(exceptionValues(events[0] as SentItem)).toStrictEqual([
      `外部APIの呼び出しに失敗しました: ${REDACTED}`,
    ]);
    expect(JSON.stringify(events[0]?.payload)).not.toContain(API_KEY);
  });

  test('利用者のIPアドレスとIPアドレス・Cookie・認証を表すヘッダーをイベントとスパンに含めない', async () => {
    const recording = createRecordingFetch();
    const app = createTestApp(
      optionsFactory(runtimeOptions({ tracesSampleRate: 1 }), recording),
    );

    await invoke(app, '/unexpected?session=abc', {
      headers: {
        'CF-Connecting-IP': CLIENT_IP,
        'X-Forwarded-For': CLIENT_IP,
        Cookie: 'session=abc',
        Authorization: 'Bearer abc',
      },
    });

    const events = itemsOfType(recording, 'event');
    const spanItems = itemsOfType(recording, 'span');
    expect(events).toHaveLength(1);
    expect(sentSpans(recording).length).toBeGreaterThan(0);
    expect(itemsOfType(recording, 'transaction')).toHaveLength(0);
    for (const { payload } of [...events, ...spanItems]) {
      const serialized = JSON.stringify(payload).toLowerCase();
      expect(serialized).not.toContain(CLIENT_IP);
      expect(serialized).not.toContain('cf-connecting-ip');
      expect(serialized).not.toContain('cf_connecting_ip');
      expect(serialized).not.toContain('x-forwarded-for');
      expect(serialized).not.toContain('x_forwarded_for');
      expect(serialized).not.toContain('session=abc');
      expect(serialized).not.toContain('bearer abc');
      expect(
        (payload.user as { ip_address?: unknown } | undefined)?.ip_address,
      ).toBeUndefined();
    }
    for (const { attributes } of sentSpans(recording)) {
      expect(attributes['user.ip_address']).toBeUndefined();
      expect(attributes['client.address']).toBeUndefined();
    }
  });

  test('URLのパスとスパンの名前に入れた公開APIのキーを、届いたスパンで伏せ字にする', async () => {
    const recording = createRecordingFetch();
    const app = createTestApp(
      optionsFactory(runtimeOptions({ tracesSampleRate: 1 }), recording),
    );

    const response = await invoke(app, `/keys/${API_KEY}?key=${API_KEY}`);

    expect(response.status).toBe(200);
    const spans = sentSpans(recording);
    expect(spans.map(({ name }) => name)).toContain(
      `外部APIの呼び出し ${REDACTED}`,
    );
    const segment = spans.find(({ name }) => name === 'GET /keys/:key');
    expect(segment?.attributes['url.path']?.value).toBe(`/keys/${REDACTED}`);
    expect(String(segment?.attributes['url.full']?.value)).toContain(
      `/keys/${REDACTED}`,
    );
    expect(JSON.stringify(itemsOfType(recording, 'span'))).not.toContain(
      API_KEY,
    );
  });
});

describe('withSentryForScheduledAndQueue', () => {
  test('fetchを計装し直さず、Honoの経路の想定外の例外は1回だけ送る', async () => {
    const recording = createRecordingFetch();
    const options = optionsFactory(runtimeOptions(), recording);
    const app = createTestApp(options);
    const handler = withSentryForScheduledAndQueue(options, {
      fetch: app.fetch,
      scheduled: () => Promise.resolve(),
    });

    expect(handler.fetch).toBe(app.fetch);
    const ctx = createExecutionContext();
    const response = await handler.fetch?.(
      new Request('https://api.example/unexpected'),
      TEST_ENV,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response?.status).toBe(500);
    expect(itemsOfType(recording, 'event')).toHaveLength(1);
  });

  test('定期実行のハンドラーの想定外の例外を1回だけ送る', async () => {
    const recording = createRecordingFetch();
    const handler = withSentryForScheduledAndQueue<TestBindings>(
      optionsFactory(runtimeOptions(), recording),
      {
        scheduled: () => Promise.reject(new Error('定期実行が失敗しました')),
      },
    );
    const ctx = createExecutionContext();

    await expect(
      handler.scheduled?.(
        createScheduledController({ cron: '21 12 * * *' }),
        TEST_ENV,
        ctx,
      ),
    ).rejects.toThrow('定期実行が失敗しました');
    await waitOnExecutionContext(ctx);

    const events = itemsOfType(recording, 'event');
    expect(events).toHaveLength(1);
    expect(exceptionValues(events[0] as SentItem)).toStrictEqual([
      '定期実行が失敗しました',
    ]);
  });

  test('非同期メッセージのハンドラーの想定外の例外を送り、共通エラー型は送らない', async () => {
    const recording = createRecordingFetch();
    const handler = withSentryForScheduledAndQueue<TestBindings>(
      optionsFactory(runtimeOptions(), recording),
      {
        queue: (batch) =>
          Promise.reject(
            batch.messages.length === 1
              ? new Error('メッセージの処理が失敗しました')
              : new AppError({
                  kind: 'conflict',
                  code: 'already_processed',
                  message: '処理済みです。',
                }),
          ),
      },
    );
    const message = {
      id: 'message-1',
      timestamp: new Date(0),
      attempts: 1,
      body: {},
    };

    for (const messages of [[message], [message, { ...message, id: 'm-2' }]]) {
      const ctx = createExecutionContext();
      await expect(
        handler.queue?.(
          createMessageBatch('genai-example-2-jobs-dev', messages),
          TEST_ENV,
          ctx,
        ),
      ).rejects.toThrow();
      await waitOnExecutionContext(ctx);
    }

    const events = itemsOfType(recording, 'event');
    expect(events).toHaveLength(1);
    expect(exceptionValues(events[0] as SentItem)).toStrictEqual([
      'メッセージの処理が失敗しました',
    ]);
  });

  test('送信先が無ければ定期実行で送信しない', async () => {
    const recording = createRecordingFetch();
    const handler = withSentryForScheduledAndQueue<TestBindings>(
      optionsFactory(runtimeOptions({ dsn: undefined }), recording),
      { scheduled: () => Promise.reject(new Error('失敗')) },
    );
    const ctx = createExecutionContext();

    await expect(
      handler.scheduled?.(createScheduledController(), TEST_ENV, ctx),
    ).rejects.toThrow('失敗');
    await waitOnExecutionContext(ctx);

    expect(recording.calls.count).toBe(0);
  });
});
