import { resetSync } from '@logtape/logtape';
import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  DeadLetterNotice,
  QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import {
  defineMessageContract,
  type MessageHandler,
  type MessageHandlerRegistration,
} from '../../core/messaging/message-contract.ts';
import {
  type RawMessageHandler,
  type RawMessageMeta,
  type RawQueueRegistration,
  RawQueueRegistrationError,
} from '../../core/messaging/raw-queue.ts';
import { QUEUE_MAX_RETRIES } from '../../core/messaging/retry-policy.ts';
import type { InvocationScope } from '../di/invocation-container.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../observability/sentry.ts';
import {
  createQueueDispatcher,
  type QueueConsumerEnv,
} from './queue-consumer.ts';

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly object: Record<string, unknown>;
}

function createRecordingConsole(): {
  readonly console: Console;
  readonly calls: ConsoleCall[];
} {
  const calls: ConsoleCall[] = [];
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]) => {
      calls.push({ method, object: args[0] as Record<string, unknown> });
    };
  const recorder = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  return { console: recorder as unknown as Console, calls };
}

interface RecordingQueue<Body> {
  readonly queue: Queue<Body>;
  readonly sent: { readonly body: Body; readonly options?: QueueSendOptions }[];
}

function createRecordingQueue<Body>(failure?: Error): RecordingQueue<Body> {
  const sent: RecordingQueue<Body>['sent'] = [];
  const queue: Queue<Body> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body, options) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      sent.push(options === undefined ? { body } : { body, options });
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
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
function parseSentryEnvelope(text: string): SentItem[] {
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

declare global {
  // @cloudflare/vitest-pool-workers 0.22.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly delaySeconds?: number;
}

const ACKED: MessageOutcome = { acked: true, retried: false };
const UNTOUCHED: MessageOutcome = { acked: false, retried: false };
const RETRIED_WITH_QUEUE_DELAY: MessageOutcome = {
  acked: false,
  retried: true,
};

function retriedAfter(delaySeconds: number): MessageOutcome {
  return { acked: false, retried: true, delaySeconds };
}

interface TestMessage {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
}

let messageSequence = 0;

function createTestMessage(body: unknown, attempts = 1): TestMessage {
  messageSequence += 1;
  return { id: `raw-message-${String(messageSequence)}`, body, attempts };
}

const JOBS_QUEUE_NAME = 'genai-example-2-jobs-dev';
const JOBS_DLQ_NAME = 'genai-example-2-jobs-dlq-dev';
const RAW_QUEUE_NAME = 'genai-example-2-delivery-events-dev';
const RAW_QUEUE_TYPE = 'raw:delivery-events';
const MESSAGE_TIMESTAMP = new Date('2026-10-25T03:04:05.678Z');
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const ENVELOPE_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';
const SENT_AT = '2026-10-25T03:00:00.000Z';
const BODY_MARKER = 'body-marker-that-must-not-leak';

const greetingContract = defineMessageContract(
  'test.send-greeting',
  z.object({ recipient: z.string().min(1) }),
);

function greetingEnvelope(recipient: string): QueueEnvelope {
  return {
    v: 1,
    type: greetingContract.type,
    id: ENVELOPE_ID,
    sentAt: SENT_AT,
    body: { recipient },
  };
}

const TEST_TYPES = Object.freeze({
  GreetingHandler: Symbol.for('test.GreetingHandler'),
  DeliveryEventsHandler: Symbol.for('test.DeliveryEventsHandler'),
});

type RawTestEnv = QueueConsumerEnv & {
  readonly DELIVERY_EVENTS_QUEUE_NAME: string;
};

interface RawHandledCall {
  readonly body: unknown;
  readonly meta: RawMessageMeta;
  readonly scope: InvocationScope<PlatformEnv>;
}

type RawBehavior = (body: unknown, meta: RawMessageMeta) => Promise<void>;

interface DispatchResult {
  readonly outcomes: readonly MessageOutcome[];
  readonly error: unknown;
  readonly sentryItems: readonly SentItem[];
}

interface RawTestHarness {
  readonly handled: RawHandledCall[];
  readonly greetings: unknown[];
  readonly deadLetters: RecordingQueue<DeadLetterNotice>;
  readonly dispatch: (
    messages: readonly TestMessage[],
    queueName?: string,
  ) => Promise<DispatchResult>;
}

// 0.22.0のretry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる
async function runBatch(
  messages: readonly TestMessage[],
  queueName: string,
  run: (batch: MessageBatch, ctx: ExecutionContext) => Promise<void>,
): Promise<{
  readonly outcomes: readonly MessageOutcome[];
  readonly error: unknown;
}> {
  const batch = createMessageBatch(
    queueName,
    messages.map(({ id, body, attempts }) => ({
      id,
      timestamp: MESSAGE_TIMESTAMP,
      attempts,
      body,
    })),
  );
  const retrySpies = batch.messages.map((message) =>
    vi.spyOn(message, 'retry'),
  );
  const ctx = createExecutionContext();
  let error: unknown;
  try {
    await run(batch, ctx);
  } catch (caught) {
    error = caught;
  }
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  const outcomes = batch.messages.map(({ id }, index) => {
    const retried = retryMessages.some(({ msgId }) => msgId === id);
    const delaySeconds =
      retrySpies[index]?.mock.calls.at(-1)?.[0]?.delaySeconds;
    return {
      acked: explicitAcks.includes(id),
      retried,
      ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
    };
  });
  return { outcomes, error };
}

function createBindings(
  behavior: RawBehavior,
  handled: RawHandledCall[],
  greetings: unknown[],
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<RawMessageHandler>(TEST_TYPES.DeliveryEventsHandler).toDynamicValue(
      (context) => {
        const scope = context.get<InvocationScope<PlatformEnv>>(
          PLATFORM_TYPES.InvocationScope,
        );
        return {
          handle: (body, meta) => {
            handled.push({ body, meta, scope });
            return behavior(body, meta);
          },
        };
      },
    );
    bind<MessageHandler<{ readonly recipient: string }>>(
      TEST_TYPES.GreetingHandler,
    ).toConstantValue({
      handle: (body) => {
        greetings.push(body);
        return Promise.resolve({ kind: 'done' });
      },
    });
  });
}

function createHarness(
  behavior: RawBehavior,
  options: {
    readonly retry?: RawQueueRegistration<RawTestEnv>['retry'];
    readonly deadLetterFailure?: Error;
    readonly queueName?: RawQueueRegistration<RawTestEnv>['queueName'];
  } = {},
): RawTestHarness {
  const handled: RawHandledCall[] = [];
  const greetings: unknown[] = [];
  const deadLetters = createRecordingQueue<DeadLetterNotice>(
    options.deadLetterFailure,
  );
  const testEnv: RawTestEnv = {
    ...env,
    JOBS_QUEUE: createRecordingQueue<QueueEnvelope>().queue,
    JOBS_DLQ: deadLetters.queue,
    JOBS_QUEUE_NAME,
    JOBS_DLQ_NAME,
    DELIVERY_EVENTS_QUEUE_NAME: RAW_QUEUE_NAME,
  };
  const greetingRegistration: MessageHandlerRegistration<{
    readonly recipient: string;
  }> = { contract: greetingContract, handler: TEST_TYPES.GreetingHandler };
  const dispatcher = createQueueDispatcher<RawTestEnv>(
    [greetingRegistration],
    [{ bindings: createBindings(behavior, handled, greetings) }],
    {
      rawQueues: [
        {
          name: 'delivery-events',
          queueName: options.queueName ?? ((e) => e.DELIVERY_EVENTS_QUEUE_NAME),
          handler: TEST_TYPES.DeliveryEventsHandler,
          ...(options.retry === undefined ? {} : { retry: options.retry }),
        },
      ],
    },
  );
  return {
    handled,
    greetings,
    deadLetters,
    dispatch: async (messages, queueName = RAW_QUEUE_NAME) => {
      const sentryItems: SentItem[] = [];
      const recordingFetch = (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        sentryItems.push(...parseSentryEnvelope(decodeBody(init?.body)));
        return Promise.resolve(new Response('{}', { status: 200 }));
      };
      const handler = withSentryForScheduledAndQueue<RawTestEnv>(
        (): CloudflareOptions => ({
          ...buildSentryOptions({
            dsn: TEST_DSN,
            environment: 'test',
            tracesSampleRate: 0,
          }),
          cacheClient: false,
          transportOptions: { fetch: recordingFetch as typeof fetch },
        }),
        {
          queue: (batch, e, ctx) => dispatcher.dispatch(batch, e, ctx),
        },
      );
      const { outcomes, error } = await runBatch(
        messages,
        queueName,
        (batch, ctx) =>
          handler.queue?.(batch, testEnv, ctx) ?? Promise.resolve(),
      );
      return { outcomes, error, sentryItems };
    },
  };
}

function sentEvents(result: DispatchResult): Record<string, unknown>[] {
  return result.sentryItems
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

const done: RawBehavior = () => Promise.resolve();
const failing: RawBehavior = () =>
  Promise.reject(new TypeError(`処理に失敗しました: ${BODY_MARKER}`));

let recording = createRecordingConsole();

beforeEach(() => {
  recording = createRecordingConsole();
  ensureLoggingConfigured({
    appName: 'event',
    level: 'info',
    console: recording.console,
  });
});

afterAll(() => {
  resetSync();
});

function consumerLogs(): Record<string, unknown>[] {
  return recording.calls
    .map(({ object }) => object)
    .filter(
      (object) =>
        object.category === 'event.queue.consumer' && 'result' in object,
    );
}

describe('createQueueDispatcher(封筒を持たない追加のQueue)', () => {
  test('登録したQueueのメッセージを1件ずつ新しいコンテナのハンドラーへ本文と付帯情報のまま渡し、正常終了でackする', async () => {
    const harness = createHarness(done);
    const first = createTestMessage({ eventType: 'bounce', note: 'a' }, 2);
    const second = createTestMessage('封筒の無い文字列の本文');

    const { outcomes, error } = await harness.dispatch([first, second]);

    expect(error).toBeUndefined();
    expect(outcomes).toEqual([ACKED, ACKED]);
    expect(
      harness.handled.map(({ body, meta, scope }) => ({
        body,
        meta,
        info: scope.info,
      })),
    ).toEqual([
      {
        body: { eventType: 'bounce', note: 'a' },
        meta: { id: first.id, attempts: 2, timestamp: MESSAGE_TIMESTAMP },
        info: { kind: 'queue', correlationId: first.id, clientIp: undefined },
      },
      {
        body: '封筒の無い文字列の本文',
        meta: { id: second.id, attempts: 1, timestamp: MESSAGE_TIMESTAMP },
        info: { kind: 'queue', correlationId: second.id, clientIp: undefined },
      },
    ]);
    expect(harness.handled[0]?.scope).not.toBe(harness.handled[1]?.scope);
    expect(harness.deadLetters.sent).toEqual([]);
  });

  test('QueuesのメッセージIDを相関IDにして、結果・種別raw:<名前>・試行回数・所要時間をinfoで記録する', async () => {
    const harness = createHarness(done);
    const message = createTestMessage({ eventType: 'bounce' }, 3);

    await harness.dispatch([message]);

    const logs = consumerLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      correlationId: message.id,
      result: 'done',
      messageType: RAW_QUEUE_TYPE,
      attempts: 3,
    });
    expect(logs[0]?.durationMs).toBeTypeOf('number');
    expect(logs[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('処理が例外になったら試行回数に応じて間隔を伸ばして再試行させ、デッドレターとエラートラッキングへは送らない', async () => {
    const harness = createHarness(failing);
    const first = createTestMessage({ secret: BODY_MARKER }, 1);
    const second = createTestMessage({ secret: BODY_MARKER }, 3);

    const result = await harness.dispatch([first, second]);

    expect(result.outcomes).toEqual([retriedAfter(30), retriedAfter(120)]);
    expect(harness.deadLetters.sent).toEqual([]);
    expect(sentEvents(result)).toEqual([]);
    expect(consumerLogs().map(({ result: logged }) => logged)).toEqual([
      'retried',
      'retried',
    ]);
    const warnings = recording.calls.filter(({ method }) => method === 'warn');
    expect(
      warnings.map(({ object }) => [
        object.correlationId,
        (object.error as { name?: unknown } | undefined)?.name,
      ]),
    ).toEqual([
      [first.id, 'TypeError'],
      [second.id, 'TypeError'],
    ]);
  });

  test('試行回数が上限に達したら種別raw:<名前>の本文を含まない通知をデッドレターへ送ってackする', async () => {
    const harness = createHarness(failing);
    const message = createTestMessage({ secret: BODY_MARKER }, 5);

    const { outcomes } = await harness.dispatch([message]);

    expect(outcomes).toEqual([ACKED]);
    expect(harness.deadLetters.sent).toHaveLength(1);
    const [{ body: notice, options } = { body: undefined }] =
      harness.deadLetters.sent;
    expect(options).toBeUndefined();
    expect(notice).toEqual({
      v: 1,
      kind: 'dead-letter-notice',
      messageId: message.id,
      type: RAW_QUEUE_TYPE,
      attempts: 5,
      reason: 'handler-failed',
      errorName: 'TypeError',
      failedAt: expect.any(String) as unknown,
    });
    expect(notice?.failedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(JSON.stringify(notice)).not.toContain(BODY_MARKER);
    expect(JSON.stringify(consumerLogs())).not.toContain(BODY_MARKER);
    expect(consumerLogs()[0]).toMatchObject({
      correlationId: message.id,
      result: 'dead-lettered',
      reason: 'handler-failed',
      messageType: RAW_QUEUE_TYPE,
    });
  });

  test('登録の再試行の上書きを既定の再試行の方針に併合して判定する', async () => {
    const harness = createHarness(failing, {
      retry: { maxAttempts: 2, baseDelaySeconds: 10 },
    });
    const first = createTestMessage({}, 1);
    const second = createTestMessage({}, 2);

    const { outcomes } = await harness.dispatch([first, second]);

    expect(outcomes).toEqual([retriedAfter(10), ACKED]);
    expect(harness.deadLetters.sent.map(({ body }) => body.messageId)).toEqual([
      second.id,
    ]);
  });

  test('通知の送信に失敗したら元のメッセージをretryし、ackしない', async () => {
    const harness = createHarness(failing, {
      deadLetterFailure: new Error('デッドレターへ送れません'),
    });

    const { outcomes } = await harness.dispatch([createTestMessage({}, 5)]);

    expect(outcomes).toEqual([RETRIED_WITH_QUEUE_DELAY]);
    expect(consumerLogs().map(({ result }) => result)).toEqual(['retried']);
  });

  test('1件の失敗は同じバッチの他のメッセージの処理と結果に影響しない', async () => {
    const harness = createHarness((body) =>
      body === 'fail' ? Promise.reject(new Error('失敗')) : Promise.resolve(),
    );
    const messages = [
      createTestMessage('fail'),
      createTestMessage('ok'),
      createTestMessage('fail', 5),
    ];

    const { outcomes } = await harness.dispatch(messages);

    expect(outcomes).toEqual([retriedAfter(30), ACKED, ACKED]);
    expect(harness.handled.map(({ meta }) => meta.id)).toEqual(
      messages.map(({ id }) => id),
    );
    expect(harness.deadLetters.sent.map(({ body }) => body.messageId)).toEqual([
      messages[2]?.id,
    ]);
  });

  test('1件の処理中の想定外の例外はエラートラッキングへ送り、そのメッセージだけを再試行させて後続を処理する', async () => {
    const harness = createHarness(failing);
    const broken = createTestMessage({}, 0);
    const following = createTestMessage({}, 5);

    const result = await harness.dispatch([broken, following]);

    expect(result.error).toBeUndefined();
    expect(result.outcomes).toEqual([RETRIED_WITH_QUEUE_DELAY, ACKED]);
    const events = sentEvents(result);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      exception: { values: [{ type: 'RangeError' }] },
      tags: { correlation_id: broken.id },
    });
  });

  test('追加のQueueを登録しても本体Queueのメッセージは従来どおり封筒の契約のハンドラーで処理する', async () => {
    const harness = createHarness(done);

    const { outcomes } = await harness.dispatch(
      [createTestMessage(greetingEnvelope('alice'))],
      JOBS_QUEUE_NAME,
    );

    expect(outcomes).toEqual([ACKED]);
    expect(harness.greetings).toEqual([{ recipient: 'alice' }]);
    expect(harness.handled).toEqual([]);
  });

  test('追加のQueueを登録してもデッドレターのメッセージは従来どおり通知してackする', async () => {
    const harness = createHarness(done);

    const { outcomes } = await harness.dispatch(
      [createTestMessage({ secret: BODY_MARKER })],
      JOBS_DLQ_NAME,
    );

    expect(outcomes).toEqual([ACKED]);
    expect(harness.handled).toEqual([]);
    expect(
      recording.calls.filter(
        ({ object }) => object.category === 'event.queue.dead-letter',
      ),
    ).toHaveLength(1);
  });

  test('登録したどのQueueとも一致しないバッチは従来どおりエラーログを出して例外にする', async () => {
    const harness = createHarness(done);

    const result = await harness.dispatch(
      [createTestMessage({})],
      'genai-example-2-other-dev',
    );

    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain(
      'genai-example-2-other-dev',
    );
    expect(result.outcomes).toEqual([UNTOUCHED]);
    expect(harness.handled).toEqual([]);
    expect(
      recording.calls.filter(({ method }) => method === 'error'),
    ).toHaveLength(1);
  });

  test.each([
    ['本体', (e: RawTestEnv) => e.JOBS_QUEUE_NAME, JOBS_QUEUE_NAME],
    ['デッドレター', (e: RawTestEnv) => e.JOBS_DLQ_NAME, JOBS_DLQ_NAME],
  ] as const)(
    '%sと同じQueue名の登録は最初のdispatchで例外にし、メッセージを処理しない',
    async (_label, queueName, resolved) => {
      const harness = createHarness(done, { queueName });

      const result = await harness.dispatch(
        [createTestMessage(greetingEnvelope('alice'))],
        resolved,
      );

      expect(result.error).toBeInstanceOf(RawQueueRegistrationError);
      expect((result.error as Error).message).toContain(resolved);
      expect(result.outcomes).toEqual([UNTOUCHED]);
      expect(harness.handled).toEqual([]);
      expect(harness.greetings).toEqual([]);
      expect(harness.deadLetters.sent).toEqual([]);
    },
  );

  test('再試行の上書きの試行回数の上限がQueuesの再試行回数の上限を超えると組み立て時に例外にする', () => {
    expect(() =>
      createQueueDispatcher<RawTestEnv>([], [], {
        rawQueues: [
          {
            name: 'delivery-events',
            queueName: (e) => e.DELIVERY_EVENTS_QUEUE_NAME,
            handler: TEST_TYPES.DeliveryEventsHandler,
            retry: { maxAttempts: QUEUE_MAX_RETRIES + 1 },
          },
        ],
      }),
    ).toThrow(RangeError);
  });
});
