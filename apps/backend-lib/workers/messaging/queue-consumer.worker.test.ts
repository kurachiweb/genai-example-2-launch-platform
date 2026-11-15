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
  type MessageHandlingResult,
  type MessageMeta,
} from '../../core/messaging/message-contract.ts';
import { QUEUE_MAX_RETRIES } from '../../core/messaging/retry-policy.ts';
import type { InvocationScope } from '../di/invocation-container.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../observability/sentry.ts';
import { createQueueDispatcher } from './queue-consumer.ts';
import { MAX_DELAY_SECONDS } from './queue-publisher.ts';

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
  return { id: `queue-message-${String(messageSequence)}`, body, attempts };
}

const JOBS_QUEUE_NAME = 'genai-example-2-jobs-dev';
const JOBS_DLQ_NAME = 'genai-example-2-jobs-dlq-dev';
const MESSAGE_TIMESTAMP = new Date('2026-10-25T03:04:05.678Z');
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const MESSAGE_IDS = [
  '01HZX3Y7Q2M4N5P6R7S8T9V0W1',
  '01HZX3Y7Q2M4N5P6R7S8T9V0W2',
  '01HZX3Y7Q2M4N5P6R7S8T9V0W3',
  '01HZX3Y7Q2M4N5P6R7S8T9V0W4',
] as const;
const [FIRST_ID, SECOND_ID, THIRD_ID, FOURTH_ID] = MESSAGE_IDS;
const SENT_AT = '2026-10-25T03:00:00.000Z';
const BODY_MARKER = 'body-marker-that-must-not-leak';

function envelopeOf(
  type: string,
  body: unknown,
  id: string = FIRST_ID,
): QueueEnvelope {
  return { v: 1, type, id, sentAt: SENT_AT, body };
}

const greetingContract = defineMessageContract(
  'test.send-greeting',
  z.object({ recipient: z.string().min(1) }),
);

const TEST_TYPES = Object.freeze({
  GreetingHandler: Symbol.for('test.GreetingHandler'),
});

interface HandledCall {
  readonly body: unknown;
  readonly meta: MessageMeta;
  readonly scopeInfo: InvocationScope<PlatformEnv>['info'];
}

type Behavior = (
  body: { readonly recipient: string },
  meta: MessageMeta,
) => Promise<MessageHandlingResult>;

interface DispatchResult {
  readonly outcomes: readonly MessageOutcome[];
  readonly error: unknown;
  readonly sentryItems: readonly SentItem[];
}

interface TestHarness {
  readonly handled: HandledCall[];
  readonly jobsQueue: RecordingQueue<QueueEnvelope>;
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

function createHarness(
  behavior: Behavior,
  options: {
    readonly retry?: MessageHandlerRegistration<unknown>['retry'];
    readonly deadLetterFailure?: Error;
  } = {},
): TestHarness {
  const handled: HandledCall[] = [];
  const jobsQueue = createRecordingQueue<QueueEnvelope>();
  const deadLetters = createRecordingQueue<DeadLetterNotice>(
    options.deadLetterFailure,
  );
  const bindings = new ContainerModule(({ bind }) => {
    bind<MessageHandler<{ readonly recipient: string }>>(
      TEST_TYPES.GreetingHandler,
    ).toDynamicValue((context) => {
      const scope = context.get<InvocationScope<PlatformEnv>>(
        PLATFORM_TYPES.InvocationScope,
      );
      return {
        handle: (body, meta) => {
          handled.push({ body, meta, scopeInfo: scope.info });
          return behavior(body, meta);
        },
      };
    });
  });
  const registration: MessageHandlerRegistration<{
    readonly recipient: string;
  }> = {
    contract: greetingContract,
    handler: TEST_TYPES.GreetingHandler,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  };
  const testEnv = {
    ...env,
    JOBS_QUEUE: jobsQueue.queue,
    JOBS_DLQ: deadLetters.queue,
    JOBS_QUEUE_NAME,
    JOBS_DLQ_NAME,
  };
  const dispatcher = createQueueDispatcher<typeof testEnv>(
    [registration],
    [{ bindings }],
  );
  return {
    handled,
    jobsQueue,
    deadLetters,
    dispatch: async (messages, queueName = JOBS_QUEUE_NAME) => {
      const sentryItems: SentItem[] = [];
      const recordingFetch = (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        sentryItems.push(...parseSentryEnvelope(decodeBody(init?.body)));
        return Promise.resolve(new Response('{}', { status: 200 }));
      };
      const handler = withSentryForScheduledAndQueue<typeof testEnv>(
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

const done: Behavior = () => Promise.resolve({ kind: 'done' });
const failing: Behavior = () =>
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

function expectFailedAtIso(notice: DeadLetterNotice | undefined): void {
  expect(notice?.failedAt).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
}

describe('createQueueDispatcher(本体Queue)', () => {
  test('検証した本文と付帯情報を処理単位のコンテナのハンドラーへ渡し、完了したらackする', async () => {
    const harness = createHarness(done);
    const message = createTestMessage(
      envelopeOf(greetingContract.type, {
        recipient: 'alice',
        extra: BODY_MARKER,
      }),
      2,
    );

    const { outcomes } = await harness.dispatch([message]);

    expect(outcomes).toEqual([ACKED]);
    expect(harness.handled).toEqual([
      {
        body: { recipient: 'alice' },
        meta: {
          id: FIRST_ID,
          type: greetingContract.type,
          attempts: 2,
          sentAt: new Date(SENT_AT),
        },
        scopeInfo: {
          kind: 'queue',
          correlationId: FIRST_ID,
          clientIp: undefined,
        },
      },
    ]);
    expect(harness.deadLetters.sent).toEqual([]);
  });

  test('封筒のIDを相関IDにして、結果・種別・試行回数・所要時間をinfoで記録する', async () => {
    const harness = createHarness(done);

    await harness.dispatch([
      createTestMessage(envelopeOf(greetingContract.type, { recipient: 'a' })),
    ]);

    const logs = consumerLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      correlationId: FIRST_ID,
      result: 'done',
      messageType: greetingContract.type,
      attempts: 1,
    });
    expect(logs[0]?.durationMs).toBeTypeOf('number');
    expect(logs[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('遅延再送は同じIDの封筒を指定の秒数で本体Queueへ送り直してからackする', async () => {
    const harness = createHarness(() =>
      Promise.resolve({ kind: 'defer', delaySeconds: MAX_DELAY_SECONDS }),
    );
    const envelope = envelopeOf(greetingContract.type, { recipient: 'bob' });

    const { outcomes } = await harness.dispatch([
      createTestMessage(envelope, 3),
    ]);

    expect(outcomes).toEqual([ACKED]);
    expect(harness.jobsQueue.sent).toEqual([
      { body: envelope, options: { delaySeconds: MAX_DELAY_SECONDS } },
    ]);
    expect(consumerLogs()[0]).toMatchObject({
      correlationId: FIRST_ID,
      result: 'deferred',
    });
  });

  test('上限を超える遅延の指定は処理の失敗として再試行させ、送り直さない', async () => {
    const harness = createHarness(() =>
      Promise.resolve({ kind: 'defer', delaySeconds: MAX_DELAY_SECONDS + 1 }),
    );

    const { outcomes } = await harness.dispatch([
      createTestMessage(envelopeOf(greetingContract.type, { recipient: 'b' })),
    ]);

    expect(outcomes).toEqual([retriedAfter(30)]);
    expect(harness.jobsQueue.sent).toEqual([]);
  });

  test('処理が失敗したら試行回数に応じて間隔を伸ばして再試行させ、エラートラッキングへは送らない', async () => {
    const harness = createHarness(failing);

    const result = await harness.dispatch([
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'a' }, FIRST_ID),
        1,
      ),
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'a' }, SECOND_ID),
        3,
      ),
    ]);

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
      [FIRST_ID, 'TypeError'],
      [SECOND_ID, 'TypeError'],
    ]);
  });

  test('試行回数が上限に達したら本文を含まない通知をデッドレターへ送ってackする', async () => {
    const harness = createHarness(failing);

    const { outcomes } = await harness.dispatch([
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: BODY_MARKER }),
        5,
      ),
    ]);

    expect(outcomes).toEqual([ACKED]);
    expect(harness.deadLetters.sent).toHaveLength(1);
    const [{ body: notice, options } = { body: undefined }] =
      harness.deadLetters.sent;
    expect(options).toBeUndefined();
    expect(notice).toEqual({
      v: 1,
      kind: 'dead-letter-notice',
      messageId: FIRST_ID,
      type: greetingContract.type,
      attempts: 5,
      reason: 'handler-failed',
      errorName: 'TypeError',
      failedAt: expect.any(String) as unknown,
    });
    expectFailedAtIso(notice);
    expect(JSON.stringify(notice)).not.toContain(BODY_MARKER);
    expect(consumerLogs()[0]).toMatchObject({
      correlationId: FIRST_ID,
      result: 'dead-lettered',
      reason: 'handler-failed',
    });
  });

  test('登録の再試行の上書きを既定の再試行の方針に併合して判定する', async () => {
    const harness = createHarness(failing, {
      retry: { maxAttempts: 2, baseDelaySeconds: 10 },
    });

    const { outcomes } = await harness.dispatch([
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'a' }, FIRST_ID),
        1,
      ),
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'a' }, SECOND_ID),
        2,
      ),
    ]);

    expect(outcomes).toEqual([retriedAfter(10), ACKED]);
    expect(harness.deadLetters.sent.map(({ body }) => body.messageId)).toEqual([
      SECOND_ID,
    ]);
  });

  test('封筒が不正なメッセージは再試行せずに通知を送ってackする', async () => {
    const harness = createHarness(done);

    const { outcomes } = await harness.dispatch([
      createTestMessage({ secret: BODY_MARKER }),
    ]);

    expect(outcomes).toEqual([ACKED]);
    expect(harness.handled).toEqual([]);
    const notice = harness.deadLetters.sent[0]?.body;
    expect(notice).toMatchObject({
      v: 1,
      kind: 'dead-letter-notice',
      messageId: undefined,
      type: undefined,
      attempts: 1,
      reason: 'invalid-envelope',
      errorName: undefined,
    });
    expectFailedAtIso(notice);
    expect(JSON.stringify(notice)).not.toContain(BODY_MARKER);
    expect(consumerLogs()[0]).toMatchObject({
      result: 'dead-lettered',
      reason: 'invalid-envelope',
    });
  });

  test('登録されていない種別は再試行せずに通知を送ってackする', async () => {
    const harness = createHarness(done);

    const { outcomes } = await harness.dispatch([
      createTestMessage(
        envelopeOf('test.unregistered-job', { secret: BODY_MARKER }),
      ),
    ]);

    expect(outcomes).toEqual([ACKED]);
    expect(harness.handled).toEqual([]);
    expect(harness.deadLetters.sent[0]?.body).toMatchObject({
      messageId: FIRST_ID,
      type: 'test.unregistered-job',
      attempts: 1,
      reason: 'unknown-type',
      errorName: undefined,
    });
    expect(JSON.stringify(harness.deadLetters.sent)).not.toContain(BODY_MARKER);
    expect(consumerLogs()[0]).toMatchObject({
      correlationId: FIRST_ID,
      result: 'dead-lettered',
      reason: 'unknown-type',
    });
  });

  test('本文が検証規則に合わなければ再試行せずに通知を送ってackする', async () => {
    const harness = createHarness(done);

    const { outcomes } = await harness.dispatch([
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 1, note: BODY_MARKER }),
      ),
    ]);

    expect(outcomes).toEqual([ACKED]);
    expect(harness.handled).toEqual([]);
    expect(harness.deadLetters.sent[0]?.body).toMatchObject({
      messageId: FIRST_ID,
      type: greetingContract.type,
      reason: 'invalid-body',
      errorName: undefined,
    });
    expect(JSON.stringify(harness.deadLetters.sent)).not.toContain(BODY_MARKER);
    expect(JSON.stringify(consumerLogs())).not.toContain(BODY_MARKER);
  });

  test('通知の送信に失敗したら元のメッセージをretryし、ackしない', async () => {
    const harness = createHarness(failing, {
      deadLetterFailure: new Error('デッドレターへ送れません'),
    });

    const { outcomes } = await harness.dispatch([
      createTestMessage(envelopeOf('test.unregistered-job', {}, FIRST_ID)),
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'a' }, SECOND_ID),
        5,
      ),
    ]);

    expect(outcomes).toEqual([
      RETRIED_WITH_QUEUE_DELAY,
      RETRIED_WITH_QUEUE_DELAY,
    ]);
    expect(consumerLogs().map(({ result }) => result)).toEqual([
      'retried',
      'retried',
    ]);
  });

  test('1件の失敗は同じバッチの他のメッセージの処理と結果に影響しない', async () => {
    const harness = createHarness(({ recipient }) =>
      recipient === 'fail'
        ? Promise.reject(new Error('失敗'))
        : Promise.resolve({ kind: 'done' }),
    );

    const { outcomes } = await harness.dispatch([
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'fail' }, FIRST_ID),
      ),
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: '' }, SECOND_ID),
      ),
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'ok' }, THIRD_ID),
      ),
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'fail' }, FOURTH_ID),
        5,
      ),
    ]);

    expect(outcomes).toEqual([retriedAfter(30), ACKED, ACKED, ACKED]);
    expect(harness.handled.map(({ meta }) => meta.id)).toEqual([
      FIRST_ID,
      THIRD_ID,
      FOURTH_ID,
    ]);
    expect(harness.deadLetters.sent.map(({ body }) => body.reason)).toEqual([
      'invalid-body',
      'handler-failed',
    ]);
    expect(
      consumerLogs().map(({ correlationId, result }) => [
        correlationId,
        result,
      ]),
    ).toEqual([
      [FIRST_ID, 'retried'],
      [SECOND_ID, 'dead-lettered'],
      [THIRD_ID, 'done'],
      [FOURTH_ID, 'dead-lettered'],
    ]);
  });

  test('本体とデッドレターのどちらでもないQueueのバッチはエラーログを出して例外にする', async () => {
    const harness = createHarness(done);

    const result = await harness.dispatch(
      [
        createTestMessage(
          envelopeOf(greetingContract.type, { recipient: 'a' }),
        ),
      ],
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

  test('1件の処理中の想定外の例外はエラートラッキングへ送り、そのメッセージだけを再試行させて後続を処理する', async () => {
    const harness = createHarness(failing);

    const result = await harness.dispatch([
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'a' }, FIRST_ID),
        0,
      ),
      createTestMessage(envelopeOf('test.unregistered-job', {}, SECOND_ID)),
    ]);

    expect(result.error).toBeUndefined();
    expect(result.outcomes).toEqual([RETRIED_WITH_QUEUE_DELAY, ACKED]);
    const errorLogs = recording.calls.filter(
      ({ method }) => method === 'error',
    );
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.object).toMatchObject({ correlationId: FIRST_ID });
    const events = sentEvents(result);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      exception: { values: [{ type: 'RangeError' }] },
      tags: { correlation_id: FIRST_ID },
    });
  });

  test('想定外の例外のエラーレポートの相関IDは、そのメッセージだけに付き後続のメッセージへ残らない', async () => {
    const harness = createHarness(failing);

    const result = await harness.dispatch([
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'a' }, FIRST_ID),
        0,
      ),
      // 同じ文言の例外が続くとSentryの組み込みのdedupeが後続を捨てるため、試行回数を変えて文言を変える
      createTestMessage(
        envelopeOf(greetingContract.type, { recipient: 'b' }, SECOND_ID),
        -1,
      ),
    ]);

    expect(sentEvents(result).map((event) => event.tags)).toEqual([
      expect.objectContaining({ correlation_id: FIRST_ID }),
      expect.objectContaining({ correlation_id: SECOND_ID }),
    ]);
  });

  test('同じ種別を重複して登録すると組み立て時に例外にする', () => {
    const registration: MessageHandlerRegistration<unknown> = {
      contract: greetingContract,
      handler: TEST_TYPES.GreetingHandler,
    };

    expect(() =>
      createQueueDispatcher([registration, registration], []),
    ).toThrow(RangeError);
  });

  test('再試行の上書きの試行回数の上限がQueuesの再試行回数の上限を超えると組み立て時に例外にする', () => {
    const registration: MessageHandlerRegistration<unknown> = {
      contract: greetingContract,
      handler: TEST_TYPES.GreetingHandler,
      retry: { maxAttempts: QUEUE_MAX_RETRIES + 1 },
    };

    expect(() => createQueueDispatcher([registration], [])).toThrow(RangeError);
  });
});
