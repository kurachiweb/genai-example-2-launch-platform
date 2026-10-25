import { resetSync } from '@logtape/logtape';
import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import type {
  DeadLetterNotice,
  QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../observability/sentry.ts';
import { createQueueDispatcher } from './queue-consumer.ts';

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
}

const ACKED: MessageOutcome = { acked: true, retried: false };

interface TestMessage {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
}

function createTestMessage(
  body: unknown,
  attempts: number,
  id: string,
): TestMessage {
  return { id, body, attempts };
}

const JOBS_QUEUE_NAME = 'genai-example-2-jobs-dev';
const JOBS_DLQ_NAME = 'genai-example-2-jobs-dlq-dev';
const MESSAGE_TIMESTAMP = new Date('2026-10-25T03:04:05.678Z');

function createUnusedQueue<Body>(): Queue<Body> {
  return {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: () => Promise.reject(new Error('デッドレターの処理では送らない')),
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const NOTICE_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';
const AUTO_MOVED_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W2';
const BODY_MARKER = 'body-marker-that-must-not-leak';
const FAILED_AT = '2026-10-25T03:10:00.000Z';

const notice: DeadLetterNotice = {
  v: 1,
  kind: 'dead-letter-notice',
  messageId: NOTICE_ID,
  type: 'test.send-greeting',
  attempts: 5,
  reason: 'handler-failed',
  errorName: 'TypeError',
  failedAt: FAILED_AT,
};

const autoMovedEnvelope: QueueEnvelope = {
  v: 1,
  type: 'test.send-greeting',
  id: AUTO_MOVED_ID,
  sentAt: '2026-10-25T03:00:00.000Z',
  body: { recipient: BODY_MARKER },
};

interface DispatchResult {
  readonly items: SentItem[];
  readonly outcomes: readonly MessageOutcome[];
}

async function dispatchWithSentry(
  messages: readonly TestMessage[],
): Promise<DispatchResult> {
  const batch = createMessageBatch(
    JOBS_DLQ_NAME,
    messages.map(({ id, body, attempts }) => ({
      id,
      timestamp: MESSAGE_TIMESTAMP,
      attempts,
      body,
    })),
  );
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseSentryEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const testEnv = {
    ...env,
    JOBS_QUEUE: createUnusedQueue<QueueEnvelope>(),
    JOBS_DLQ: createUnusedQueue<DeadLetterNotice>(),
    JOBS_QUEUE_NAME,
    JOBS_DLQ_NAME,
  };
  const dispatcher = createQueueDispatcher<typeof testEnv>([], []);
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
    { queue: (queueBatch, e, ctx) => dispatcher.dispatch(queueBatch, e, ctx) },
  );
  const ctx = createExecutionContext();
  await handler.queue?.(batch, testEnv, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  const outcomes = messages.map(({ id }) => ({
    acked: explicitAcks.includes(id),
    retried: retryMessages.some(({ msgId }) => msgId === id),
  }));
  return { items, outcomes };
}

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

function deadLetterLogs(): ConsoleCall[] {
  return recording.calls.filter(
    ({ object }) => object.category === 'event.queue.dead-letter',
  );
}

function sentEvents(result: DispatchResult): Record<string, unknown>[] {
  return result.items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

describe('createQueueDispatcher(デッドレター)', () => {
  test('通知の種別・ID・試行回数・理由をエラーログとエラートラッキングへ送ってackする', async () => {
    const message = createTestMessage(notice, 1, 'dlq-message-1');

    const result = await dispatchWithSentry([message]);

    expect(result.outcomes).toEqual([ACKED]);
    const logs = deadLetterLogs();
    expect(logs.map(({ method }) => method)).toEqual(['error']);
    expect(logs[0]?.object).toMatchObject({
      level: 'error',
      correlationId: NOTICE_ID,
      messageId: NOTICE_ID,
      messageType: 'test.send-greeting',
      attempts: 5,
      reason: 'handler-failed',
      errorName: 'TypeError',
      failedAt: FAILED_AT,
    });
    const events = sentEvents(result);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      logentry: { message: 'デッドレターへ移ったメッセージを受け取りました' },
      fingerprint: ['dead-letter', 'handler-failed', 'test.send-greeting'],
      tags: {
        message_type: 'test.send-greeting',
        dead_letter_reason: 'handler-failed',
      },
      contexts: {
        dead_letter: {
          messageId: NOTICE_ID,
          attempts: 5,
          errorName: 'TypeError',
        },
      },
    });
  });

  test('自動で移った元のメッセージは本文を読まずに封筒のIDと種別を理由auto-movedで通知する', async () => {
    const message = createTestMessage(autoMovedEnvelope, 2, 'dlq-message-2');

    const result = await dispatchWithSentry([message]);

    expect(result.outcomes).toEqual([ACKED]);
    expect(deadLetterLogs()[0]?.object).toMatchObject({
      level: 'error',
      correlationId: AUTO_MOVED_ID,
      messageId: AUTO_MOVED_ID,
      messageType: 'test.send-greeting',
      attempts: 2,
      reason: 'auto-moved',
    });
    expect(sentEvents(result)[0]).toMatchObject({
      level: 'error',
      tags: {
        message_type: 'test.send-greeting',
        dead_letter_reason: 'auto-moved',
      },
    });
  });

  test('封筒として読めないメッセージも種別とIDを不明のまま通知してackする', async () => {
    const message = createTestMessage(
      { secret: BODY_MARKER },
      1,
      'dlq-message-3',
    );

    const result = await dispatchWithSentry([message]);

    expect(result.outcomes).toEqual([ACKED]);
    const logged = deadLetterLogs()[0]?.object;
    expect(logged).toMatchObject({ reason: 'auto-moved', attempts: 1 });
    expect(logged?.messageId).toBeUndefined();
    expect(logged?.messageType).toBeUndefined();
    const [event] = sentEvents(result);
    expect(event?.tags).toEqual({ dead_letter_reason: 'auto-moved' });
  });

  test('ログとエラーレポートに本文を含めず、バッチの全件をackする', async () => {
    const messages = [
      createTestMessage(notice, 1, 'dlq-message-1'),
      createTestMessage(autoMovedEnvelope, 4, 'dlq-message-2'),
      createTestMessage({ secret: BODY_MARKER }, 1, 'dlq-message-3'),
      createTestMessage(`raw ${BODY_MARKER}`, 1, 'dlq-message-4'),
    ];

    const result = await dispatchWithSentry(messages);

    expect(result.outcomes).toEqual(messages.map(() => ACKED));
    expect(deadLetterLogs()).toHaveLength(4);
    expect(sentEvents(result)).toHaveLength(4);
    expect(JSON.stringify(recording.calls)).not.toContain(BODY_MARKER);
    expect(JSON.stringify(result.items)).not.toContain(BODY_MARKER);
  });
});
