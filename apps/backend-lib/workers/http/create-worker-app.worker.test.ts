import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';
import { z } from 'zod';

import { createKeyedHasher } from '../../core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import {
  type InvocationScopeInfo,
  PLATFORM_TYPES,
} from '../../core/di/identifiers.ts';
import { AppError } from '../../core/errors/app-error.ts';
import {
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
} from '../../core/errors/error-envelope.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import { hashRateLimitKey } from '../../core/rate-limit/rate-limit-key.ts';
import type { InvocationScope } from '../di/invocation-container.ts';
import { platformEnvShape } from '../env/platform-env.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../observability/sentry.ts';
import { excludePath } from '../rate-limit/exclusions.ts';
import { createWorkerApp, type WorkerAppOptions } from './create-worker-app.ts';
import type { PlatformHonoEnv } from './hono-env.ts';

type TestEnv = typeof env;
type TestApp = Hono<PlatformHonoEnv<TestEnv>>;

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly correlationId?: string;
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

interface ScopeResponse {
  readonly info: InvocationScopeInfo;
  readonly correlationId: string;
  readonly greeting: string;
}

interface InvokeOptions {
  readonly method?: string;
  readonly ip?: string;
  readonly bindings?: TestEnv;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const API_KEY = `lsk_${'AbCdEfGhIj'.repeat(4)}K_-`;
const CLIENT_IP = '198.51.100.23';
const BASE_URL = 'https://api.launch.example';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GREETING = Symbol.for('test.http.Greeting');

const routeLogger = getAppLogger(['api', 'presentation', 'http-test']);

const testModule: AppModule<TestApp> = {
  name: 'http-test',
  bindings: new ContainerModule(({ bind }) => {
    bind<string>(GREETING).toConstantValue('こんにちは');
  }),
  routes: (app) => {
    app.get('/v1/scope', (c) => {
      const container = c.get('container');
      const scope = container.get<InvocationScope<TestEnv>>(
        PLATFORM_TYPES.InvocationScope,
      );
      routeLogger.info('処理中です');
      return c.json({
        info: scope.info,
        correlationId: c.get('correlationId'),
        greeting: container.get<string>(GREETING),
      });
    });
    app.get('/v1/conflict', () => {
      throw new AppError({
        kind: 'conflict',
        code: 'post_already_exists',
        message: '既に投稿されています。',
      });
    });
    app.get('/v1/unexpected', () => {
      throw new Error(`外部APIの呼び出しに失敗しました: ${API_KEY}`);
    });
  },
};

function createRecordingConsole(): {
  readonly console: Console;
  readonly logs: LoggedObject[];
} {
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
  return { console: methods as unknown as Console, logs };
}

function configureRecordingLogs(): LoggedObject[] {
  const recording = createRecordingConsole();
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: recording.console,
  });
  return recording.logs;
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

function createTestApp(overrides: Partial<WorkerAppOptions<TestEnv>> = {}): {
  readonly app: TestApp;
  readonly sentry: RecordingFetch;
} {
  const sentry = createRecordingFetch();
  const app = createWorkerApp<TestEnv>({
    appName: 'api',
    envSchema: z.object(platformEnvShape),
    modules: [testModule],
    rateLimitExclusions: [],
    // 呼び出しごとに送信先を差し替えて確かめるため、isolateでのクライアントの使い回しを切る
    sentry: (bindings) => ({
      ...buildSentryOptions({
        ...readSentryRuntimeOptions(bindings),
        dsn: TEST_DSN,
      }),
      cacheClient: false,
      transportOptions: { fetch: sentry.fetch },
    }),
    ...overrides,
  });
  return { app, sentry };
}

async function invoke(
  app: TestApp,
  path: string,
  options: InvokeOptions = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'CF-Connecting-IP': options.ip ?? CLIENT_IP },
    }),
    options.bindings ?? env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function envWith(overrides: Record<string, unknown>): TestEnv {
  return { ...env, ...overrides };
}

function envWithout(keys: readonly string[]): TestEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !keys.includes(key)),
  ) as unknown as TestEnv;
}

function createRecordingRateLimit(keys: string[], success: boolean): RateLimit {
  return {
    limit: ({ key }) => {
      keys.push(key);
      return Promise.resolve({ success });
    },
  };
}

async function ipRateLimitKeyOf(ip: string): Promise<string> {
  return hashRateLimitKey(createKeyedHasher(env.HASH_PEPPER), `ip:${ip}`);
}

function logsOf(logs: readonly LoggedObject[], category: string) {
  return logs.filter((log) => log.category === category);
}

function errorEvents(sentry: RecordingFetch): SentItem[] {
  return sentry.items.filter((item) => item.type === 'event');
}

afterAll(() => {
  resetSync();
});

describe('createWorkerApp', () => {
  test('ヘルスチェックはGET・HEADとも、必須の環境が欠けていても200・no-storeで状態だけを返す', async () => {
    configureRecordingLogs();
    const { app } = createTestApp();
    const bindings = envWithout(['DB', 'HASH_PEPPER']);

    const get = await invoke(app, '/health', { bindings });
    const head = await invoke(app, '/health', { method: 'HEAD', bindings });

    expect(get.status).toBe(200);
    expect(get.headers.get('Cache-Control')).toBe('no-store');
    expect(await get.json()).toStrictEqual({ status: 'ok' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Cache-Control')).toBe('no-store');
    expect(await head.text()).toBe('');
  });

  test('IP制限はヘルスチェックより前に、解決したクライアントIPのキーで数え、超過すると429で止める', async () => {
    configureRecordingLogs();
    const keys: string[] = [];
    const { app } = createTestApp();

    const response = await invoke(app, '/health', {
      bindings: envWith({
        IP_RATE_LIMITER: createRecordingRateLimit(keys, false),
      }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');
    expect(await response.json()).toMatchObject({
      error: { code: 'rate_limit_exceeded' },
    });
    expect(keys).toStrictEqual([await ipRateLimitKeyOf(CLIENT_IP)]);
  });

  test('差し替えたクライアントIPの解決と、登録した除外規則をIP制限に使う', async () => {
    configureRecordingLogs();
    const keys: string[] = [];
    const { app } = createTestApp({
      resolveClientIp: () => '192.0.2.44',
      rateLimitExclusions: [excludePath('/health')],
    });
    const bindings = envWith({
      IP_RATE_LIMITER: createRecordingRateLimit(keys, true),
    });

    const excluded = await invoke(app, '/health', { bindings });
    const counted = await invoke(app, '/v1/scope', { bindings });

    expect(excluded.status).toBe(200);
    expect(counted.status).toBe(200);
    expect((await counted.json<ScopeResponse>()).info.clientIp).toBe(
      '192.0.2.44',
    );
    expect(keys).toStrictEqual([await ipRateLimitKeyOf('192.0.2.44')]);
  });

  test('ペッパーが無い環境ではIP制限で数えず、ヘルスチェックは200、他の経路は環境の検証の500になる', async () => {
    configureRecordingLogs();
    const keys: string[] = [];
    const { app } = createTestApp();
    const bindings = envWith({
      HASH_PEPPER: undefined,
      IP_RATE_LIMITER: createRecordingRateLimit(keys, false),
    });

    const health = await invoke(app, '/health', { bindings });
    const route = await invoke(app, '/v1/scope', { bindings });

    expect(health.status).toBe(200);
    expect(route.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expect(await route.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
    expect(keys).toStrictEqual([]);
  });

  test('環境の検証に失敗すると、キー名だけを記録して500の定型で応答し、ルートを実行しない', async () => {
    const logs = configureRecordingLogs();
    const { app } = createTestApp();
    const invalidSampleRate = 'not-a-rate-value-1.5';

    const response = await invoke(app, '/v1/scope', {
      bindings: envWith({
        DB: undefined,
        HASH_PEPPER: undefined,
        SENTRY_TRACES_SAMPLE_RATE: invalidSampleRate,
      }),
    });

    expect(response.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
    expect(logsOf(logs, 'api.http.env')).toMatchObject([
      {
        level: 'error',
        missingEnvNames: ['DB', 'HASH_PEPPER'],
        invalidEnvNames: ['SENTRY_TRACES_SAMPLE_RATE'],
      },
    ]);
    expect(logsOf(logs, 'api.presentation.http-test')).toStrictEqual([]);
    expect(JSON.stringify(logs)).not.toContain(invalidSampleRate);
  });

  test('処理単位ごとのコンテナで、相関IDとクライアントIPを持つ範囲とモジュールの依存を解決する', async () => {
    configureRecordingLogs();
    const { app } = createTestApp();

    const first = await (await invoke(app, '/v1/scope')).json<ScopeResponse>();
    const second = await (await invoke(app, '/v1/scope')).json<ScopeResponse>();

    expect(first.info).toStrictEqual({
      kind: 'fetch',
      correlationId: first.correlationId,
      clientIp: CLIENT_IP,
    });
    expect(first.greeting).toBe('こんにちは');
    expect(first.correlationId).toMatch(UUID_PATTERN);
    expect(second.correlationId).toMatch(UUID_PATTERN);
    expect(second.correlationId).not.toBe(first.correlationId);
  });

  test('処理中のログとアクセスログに同じ相関IDが付き、アクセスログはクエリ文字列とIPを含まずに1件出る', async () => {
    const logs = configureRecordingLogs();
    const { app } = createTestApp();

    const response = await invoke(
      app,
      '/v1/scope?email=user%40launch.example&page=2',
    );
    const { correlationId } = await response.json<ScopeResponse>();

    const accessLogs = logsOf(logs, 'api.http.access');
    expect(logsOf(logs, 'api.presentation.http-test')).toMatchObject([
      { level: 'info', message: '処理中です', correlationId },
    ]);
    expect(accessLogs).toHaveLength(1);
    const [accessLog] = accessLogs as [LoggedObject];
    const { time, durationMs, ...rest } = accessLog;
    expect(rest).toStrictEqual({
      level: 'info',
      category: 'api.http.access',
      message: 'HTTPリクエストを処理しました',
      correlationId,
      method: 'GET',
      path: '/v1/scope',
      status: 200,
    });
    expect(typeof time).toBe('string');
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(logs)).not.toContain(CLIENT_IP);
    expect(JSON.stringify(logs)).not.toContain('launch.example');
  });

  test('未登録の経路は404の共通エラー形式になり、アクセスログに状態コードが残る', async () => {
    const logs = configureRecordingLogs();
    const { app } = createTestApp();

    const response = await invoke(app, '/v1/missing', { method: 'POST' });

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    expect(logsOf(logs, 'api.http.access')).toMatchObject([
      { method: 'POST', path: '/v1/missing', status: 404 },
    ]);
  });

  test('共通エラーは対応する状態コードと共通のエラー形式になり、エラートラッキングへ送らない', async () => {
    configureRecordingLogs();
    const { app, sentry } = createTestApp();

    const response = await invoke(app, '/v1/conflict');

    expect(response.status).toBe(409);
    expect(await response.json()).toStrictEqual({
      error: { code: 'post_already_exists', message: '既に投稿されています。' },
    });
    expect(errorEvents(sentry)).toStrictEqual([]);
  });

  test('想定外の例外は内部の詳細を含まない500になり、伏せ字済みのログと相関ID付きのエラートラッキングへ送る', async () => {
    const logs = configureRecordingLogs();
    const { app, sentry } = createTestApp();

    const response = await invoke(app, '/v1/unexpected');
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
    expect(body).not.toContain('外部API');
    const [accessLog] = logsOf(logs, 'api.http.access') as [LoggedObject];
    expect(accessLog.status).toBe(500);
    expect(logsOf(logs, 'api.http.error')).toMatchObject([
      {
        level: 'error',
        correlationId: accessLog.correlationId,
        error: {
          name: 'Error',
          message: '外部APIの呼び出しに失敗しました: [REDACTED]',
        },
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(API_KEY);
    const events = errorEvents(sentry);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.tags).toMatchObject({
      correlation_id: accessLog.correlationId,
    });
  });
});
