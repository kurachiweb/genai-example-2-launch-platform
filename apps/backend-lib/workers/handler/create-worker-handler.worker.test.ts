import { getConfig, resetSync } from '@logtape/logtape';
import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import {
  hashPurpose,
  type KeyedHasher,
} from '../../core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import {
  type InvocationScopeInfo,
  PLATFORM_TYPES,
} from '../../core/di/identifiers.ts';
import { EnvValidationError } from '../../core/env/env-schema.ts';
import type {
  DeadLetterNotice,
  QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import {
  createCronRegistry,
  type ScheduledJobHandler,
} from '../../core/scheduling/cron-registry.ts';
import {
  type BusinessTimeOfDay,
  toUtcCronExpression,
} from '../../core/time/business-time.ts';
import type { InvocationScope } from '../di/invocation-container.ts';
import { platformEnvShape } from '../env/platform-env.ts';
import { createWorkerApp } from '../http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import {
  createQueueDispatcher,
  type QueueDispatcher,
} from '../messaging/queue-consumer.ts';
import { buildSentryOptions } from '../observability/sentry.ts';
import {
  createScheduledDispatcher,
  type ScheduledDispatcher,
} from '../scheduling/scheduled-dispatcher.ts';
import {
  createWorkerHandler,
  type WorkerHandlerOptions,
} from './create-worker-handler.ts';

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

interface JobRun {
  readonly info: InvocationScopeInfo;
  readonly correlationIdInContext: unknown;
}

interface Harness {
  readonly handler: ExportedHandler<TestEnv>;
  readonly logs: LoggedObject[];
  readonly sentryItems: SentItem[];
  readonly moduleLoads: { count: number };
  readonly jobRuns: JobRun[];
  readonly testEnv: TestEnv;
}

interface HarnessOptions {
  readonly appName?: 'api' | 'event';
  readonly envSchema?: z.ZodType;
  readonly failingJob?: boolean;
  readonly scheduled?: ScheduledDispatcher<TestEnv> | false;
  readonly queue?: QueueDispatcher<TestEnv> | false;
}

const JOBS_QUEUE_NAME = 'genai-example-2-jobs-dev';
const JOBS_DLQ_NAME = 'genai-example-2-jobs-dlq-dev';
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const AT_4_21: BusinessTimeOfDay = { hour: 4, minute: 21 };
const CRON_4_21 = toUtcCronExpression(AT_4_21);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOB_IDENTIFIER = Symbol.for('test.worker-handler.Job');
const HASH_PURPOSE = hashPurpose('test.worker-handler');
const UNKNOWN_QUEUE_NAME = 'genai-example-2-unknown-dev';

function createRecordingQueue<Body>(): Queue<Body> {
  return {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: () =>
      Promise.resolve({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
}

const testEnv = {
  ...env,
  JOBS_QUEUE: createRecordingQueue<QueueEnvelope>(),
  JOBS_DLQ: createRecordingQueue<DeadLetterNotice>(),
  JOBS_QUEUE_NAME,
  JOBS_DLQ_NAME,
};

type TestEnv = typeof testEnv;
type TestApp = Hono<PlatformHonoEnv<TestEnv>>;

function createRecordingConsole(logs: LoggedObject[]): Console {
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  return {
    debug: record,
    info: record,
    warn: record,
    error: record,
  } as unknown as Console;
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

function createTestModule(
  jobRuns: JobRun[],
  failingJob: boolean,
): AppModule<TestApp> & { readonly loads: { count: number } } {
  const loads = { count: 0 };
  return {
    name: 'worker-handler-test',
    loads,
    bindings: new ContainerModule(({ bind }) => {
      loads.count += 1;
      bind<ScheduledJobHandler>(JOB_IDENTIFIER).toDynamicValue((context) => ({
        run: () => {
          jobRuns.push({
            info: context.get<InvocationScope<TestEnv>>(
              PLATFORM_TYPES.InvocationScope,
            ).info,
            correlationIdInContext:
              getConfig()?.contextLocalStorage?.getStore()?.['correlationId'],
          });
          return failingJob
            ? Promise.reject(new Error('定期実行のジョブが失敗しました'))
            : Promise.resolve();
        },
      }));
    }),
    routes: (app) => {
      app.get('/v1/hash', async (c) => {
        const hasher = c
          .get('container')
          .get<KeyedHasher>(PLATFORM_TYPES.KeyedHasher);
        return c.json({ hash: await hasher.hash(HASH_PURPOSE, 'value') });
      });
      app.get('/v1/unexpected', () => {
        throw new Error('想定外の失敗です');
      });
    },
  };
}

function createHarness(options: HarnessOptions = {}): Harness {
  const logs: LoggedObject[] = [];
  const sentryItems: SentItem[] = [];
  const jobRuns: JobRun[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    sentryItems.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  // 呼び出しごとに送信先を差し替えて確かめるため、isolateでのクライアントの使い回しを切る
  const sentry = (): CloudflareOptions => ({
    ...buildSentryOptions({
      dsn: TEST_DSN,
      environment: 'test',
      tracesSampleRate: 0,
    }),
    cacheClient: false,
    transportOptions: { fetch: recordingFetch as typeof fetch },
  });
  const appName = options.appName ?? 'api';
  const envSchema = options.envSchema ?? z.object(platformEnvShape);
  const testModule = createTestModule(jobRuns, options.failingJob ?? false);
  const modules = [testModule];
  const app = createWorkerApp<TestEnv>({
    appName,
    envSchema,
    modules,
    rateLimitExclusions: [],
    sentry,
  });
  const scheduled =
    options.scheduled === false
      ? undefined
      : (options.scheduled ??
        createScheduledDispatcher<TestEnv>(
          createCronRegistry([
            {
              name: 'test-job',
              at: AT_4_21,
              order: 1,
              handler: JOB_IDENTIFIER,
            },
          ]),
          modules,
        ));
  const queue =
    options.queue === false
      ? undefined
      : (options.queue ?? createQueueDispatcher<TestEnv>([], modules));
  const handlerOptions: WorkerHandlerOptions<TestEnv> = {
    appName,
    app,
    envSchema,
    sentry,
    console: createRecordingConsole(logs),
    ...(scheduled === undefined ? {} : { scheduled }),
    ...(queue === undefined ? {} : { queue }),
  };
  return {
    handler: createWorkerHandler(handlerOptions),
    logs,
    sentryItems,
    moduleLoads: testModule.loads,
    jobRuns,
    testEnv,
  };
}

async function invokeFetch(harness: Harness, path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await harness.handler.fetch?.(
    new Request(`https://api.launch.example${path}`),
    harness.testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  if (response === undefined) {
    throw new Error('fetchハンドラーがありません');
  }
  return response;
}

async function invokeScheduled(
  harness: Harness,
  cron: string = CRON_4_21,
): Promise<unknown> {
  const ctx = createExecutionContext();
  let error: unknown;
  try {
    await harness.handler.scheduled?.(
      createScheduledController({
        cron,
        scheduledTime: new Date('2026-10-24T12:21:00.000Z'),
      }),
      harness.testEnv,
      ctx,
    );
  } catch (caught) {
    error = caught;
  }
  await waitOnExecutionContext(ctx);
  return error;
}

async function invokeQueue(
  harness: Harness,
  queueName: string,
  bindings: TestEnv = harness.testEnv,
): Promise<unknown> {
  const ctx = createExecutionContext();
  let error: unknown;
  try {
    await harness.handler.queue?.(
      createMessageBatch(queueName, [
        {
          id: 'queue-message-1',
          timestamp: new Date('2026-10-25T03:04:05.678Z'),
          attempts: 1,
          body: {},
        },
      ]),
      bindings,
      ctx,
    );
  } catch (caught) {
    error = caught;
  }
  await waitOnExecutionContext(ctx);
  return error;
}

function sentEvents(harness: Harness): Record<string, unknown>[] {
  return harness.sentryItems
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

// 例外の捕捉の仕組みの種類から、どのハンドラーの計装が送ったかを確かめる
function mechanismTypeOf(event: Record<string, unknown> | undefined): unknown {
  const exception = event?.exception as
    { values?: { mechanism?: { type?: unknown } }[] } | undefined;
  return exception?.values?.[0]?.mechanism?.type;
}

function logsOf(harness: Harness, category: string): LoggedObject[] {
  return harness.logs.filter((logged) => logged.category === category);
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('createWorkerHandler(グローバルスコープ)', () => {
  test('組み立てただけではログ設定・コンテナ生成・暗号鍵の生成を行わず、最初の呼び出しで行う', async () => {
    resetSync();
    const importKey = vi.spyOn(crypto.subtle, 'importKey');

    const harness = createHarness();

    expect(getConfig()).toBeNull();
    expect(harness.moduleLoads.count).toBe(0);
    expect(importKey).not.toHaveBeenCalled();

    const response = await invokeFetch(harness, '/v1/hash');

    expect(response.status).toBe(200);
    expect(getConfig()).not.toBeNull();
    expect(harness.moduleLoads.count).toBe(1);
    // 処理単位のコンテナより前に動くIP制限が自分のハッシュ化の部品を持つため、IP制限とコンテナが1回ずつ鍵を読み込む
    expect(importKey).toHaveBeenCalledTimes(2);
  });

  test('定期実行と非同期メッセージを渡さなければ、それらのハンドラーを持たない', () => {
    const { handler } = createHarness({ scheduled: false, queue: false });

    expect(handler.fetch).toBeTypeOf('function');
    expect(handler).not.toHaveProperty('scheduled');
    expect(handler).not.toHaveProperty('queue');
  });
});

describe('createWorkerHandler(fetch)', () => {
  test('呼び出しのたびにログ設定を確かめ、外部で設定が消されても次の呼び出しで出力先へ戻す', async () => {
    const harness = createHarness();

    await invokeFetch(harness, '/health');
    resetSync();
    await invokeFetch(harness, '/health');

    expect(logsOf(harness, 'api.http.access')).toHaveLength(2);
  });

  test('Honoの経路の想定外の例外は計装し直さずに1回だけ送る', async () => {
    const harness = createHarness();

    const response = await invokeFetch(harness, '/v1/unexpected');

    expect(response.status).toBe(500);
    expect(sentEvents(harness)).toHaveLength(1);
  });
});

describe('createWorkerHandler(定期実行)', () => {
  test('相関IDを採番してログの文脈の中で振り分け、ジョブの処理単位とログに同じ相関IDを付ける', async () => {
    const harness = createHarness();

    await invokeScheduled(harness);
    await invokeScheduled(harness);

    const summaries = logsOf(harness, 'api.scheduled.dispatcher');
    expect(summaries).toHaveLength(2);
    const [first, second] = harness.jobRuns;
    expect(first?.info.kind).toBe('scheduled');
    expect(first?.info.correlationId).toMatch(UUID_PATTERN);
    expect(first?.correlationIdInContext).toBe(first?.info.correlationId);
    expect(summaries[0]?.correlationId).toBe(first?.info.correlationId);
    expect(summaries[1]?.correlationId).toBe(second?.info.correlationId);
    expect(second?.info.correlationId).not.toBe(first?.info.correlationId);
  });

  test('ジョブの想定外の失敗を、相関IDのタグとともにエラートラッキングへ送る', async () => {
    const harness = createHarness({ failingJob: true });

    await invokeScheduled(harness);

    const events = sentEvents(harness);
    expect(events).toHaveLength(1);
    expect(events[0]?.tags).toMatchObject({
      job: 'test-job',
      correlation_id: harness.jobRuns[0]?.info.correlationId,
    });
  });

  test('環境の検証に失敗したら、ジョブを実行せずにキー名だけを記録して失敗し、エラートラッキングへ送る', async () => {
    const harness = createHarness({
      envSchema: z.object({
        ...platformEnvShape,
        EXTRA_SECRET: z.string().min(1),
        HASH_PEPPER: z.string().regex(/^\d+$/),
      }),
    });

    const error = await invokeScheduled(harness);

    expect(error).toBeInstanceOf(EnvValidationError);
    expect(harness.jobRuns).toHaveLength(0);
    const [logged, ...rest] = logsOf(harness, 'api.scheduled.env');
    expect(rest).toHaveLength(0);
    expect(logged).toMatchObject({
      level: 'error',
      missingEnvNames: ['EXTRA_SECRET'],
      invalidEnvNames: ['HASH_PEPPER'],
    });
    expect(logged?.correlationId).toMatch(UUID_PATTERN);
    expect(JSON.stringify(harness.logs)).not.toContain(env.HASH_PEPPER);
    const events = sentEvents(harness);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      environment: 'test',
      tags: { correlation_id: logged?.correlationId },
    });
    expect(mechanismTypeOf(events[0])).toBe('auto.faas.cloudflare.scheduled');
  });
});

describe('createWorkerHandler(非同期メッセージ)', () => {
  test('相関IDを採番してログの文脈の中で振り分け、想定外の例外を相関IDのタグとともにエラートラッキングへ送る', async () => {
    const harness = createHarness({ appName: 'event' });

    const error = await invokeQueue(harness, UNKNOWN_QUEUE_NAME);

    expect(error).toBeInstanceOf(Error);
    const [logged] = logsOf(harness, 'event.queue.consumer');
    expect(logged?.correlationId).toMatch(UUID_PATTERN);
    const events = sentEvents(harness);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      environment: 'test',
      tags: { correlation_id: logged?.correlationId },
    });
    expect(mechanismTypeOf(events[0])).toBe('auto.faas.cloudflare.queue');
  });

  test('環境の検証に失敗したら、バッチを振り分けずにキー名だけを記録してバッチ全体を失敗させる', async () => {
    const dispatch = vi.fn<QueueDispatcher<TestEnv>['dispatch']>(() =>
      Promise.resolve(),
    );
    const harness = createHarness({
      appName: 'event',
      envSchema: z.object({
        ...platformEnvShape,
        THRESHOLD: z.string().regex(/^\d+$/),
      }),
      queue: { dispatch },
    });

    const error = await invokeQueue(harness, JOBS_QUEUE_NAME);

    expect(error).toBeInstanceOf(EnvValidationError);
    expect(dispatch).not.toHaveBeenCalled();
    expect(logsOf(harness, 'event.queue.env')).toMatchObject([
      { level: 'error', missingEnvNames: ['THRESHOLD'], invalidEnvNames: [] },
    ]);
  });

  test('環境の検証が通れば、呼び出しごとに別の相関IDの文脈の中でバッチを振り分ける', async () => {
    const dispatched: { threshold: unknown; correlationId: unknown }[] = [];
    const harness = createHarness({
      appName: 'event',
      envSchema: z.object({
        ...platformEnvShape,
        THRESHOLD: z.string().regex(/^\d+$/),
      }),
      queue: {
        dispatch: (_batch, bindings) => {
          dispatched.push({
            threshold: Reflect.get(bindings, 'THRESHOLD'),
            correlationId:
              getConfig()?.contextLocalStorage?.getStore()?.['correlationId'],
          });
          return Promise.resolve();
        },
      },
    });
    const bindings = { ...harness.testEnv, THRESHOLD: '10' };

    const errors = [
      await invokeQueue(harness, JOBS_QUEUE_NAME, bindings),
      await invokeQueue(harness, JOBS_QUEUE_NAME, bindings),
    ];

    expect(errors).toStrictEqual([undefined, undefined]);
    expect(dispatched.map(({ threshold }) => threshold)).toStrictEqual([
      '10',
      '10',
    ]);
    const [first, second] = dispatched;
    expect(first?.correlationId).toMatch(UUID_PATTERN);
    expect(second?.correlationId).toMatch(UUID_PATTERN);
    expect(second?.correlationId).not.toBe(first?.correlationId);
  });
});
