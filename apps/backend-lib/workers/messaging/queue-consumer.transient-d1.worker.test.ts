import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import type {
  DeadLetterNotice,
  QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import {
  defineMessageContract,
  type MessageHandler,
  type MessageHandlingResult,
} from '../../core/messaging/message-contract.ts';
import type { RawMessageHandler } from '../../core/messaging/raw-queue.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import { createQueueDispatcher } from './queue-consumer.ts';
import { TRANSIENT_D1_RETRY_DELAYS_MS } from './transient-d1-retry.ts';

const JOBS_QUEUE_NAME = 'genai-example-2-jobs-dev';
const RAW_QUEUE_NAME = 'genai-example-2-delivery-events-dev';
const ENVELOPE_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';

const contract = defineMessageContract(
  'test.transient-d1',
  z.object({ value: z.string() }),
);

const TEST_TYPES = Object.freeze({
  Handler: Symbol.for('test.TransientD1Handler'),
  RawHandler: Symbol.for('test.TransientD1RawHandler'),
});

const lockedError = (): Error =>
  new Error('Failed query', {
    cause: new Error('D1_ERROR: database is locked: SQLITE_BUSY'),
  });

// 何回目の呼び出しで失敗するかを決める。trueを返した呼び出しはロックの競合で失敗する
type FailOn = (call: number) => boolean;

const noopQueue = <Body>(): Queue<Body> => ({
  metrics: () => Promise.reject(new Error('テストでは使わない')),
  send: () => Promise.reject(new Error('テストでは送らない')),
  sendBatch: () => Promise.reject(new Error('テストでは使わない')),
});

function createDispatcher(failOn: FailOn) {
  const calls = { envelope: 0, raw: 0 };
  const bindings = new ContainerModule(({ bind }) => {
    bind<MessageHandler<{ readonly value: string }>>(
      TEST_TYPES.Handler,
    ).toConstantValue({
      handle: (): Promise<MessageHandlingResult> => {
        calls.envelope += 1;
        return failOn(calls.envelope)
          ? Promise.reject(lockedError())
          : Promise.resolve({ kind: 'done' });
      },
    });
    bind<RawMessageHandler>(TEST_TYPES.RawHandler).toConstantValue({
      handle: () => {
        calls.raw += 1;
        return failOn(calls.raw)
          ? Promise.reject(lockedError())
          : Promise.resolve();
      },
    });
  });
  const testEnv = {
    ...env,
    JOBS_QUEUE: noopQueue<QueueEnvelope>(),
    JOBS_DLQ: noopQueue<DeadLetterNotice>(),
    JOBS_QUEUE_NAME,
    JOBS_DLQ_NAME: 'genai-example-2-jobs-dlq-dev',
  };
  const dispatcher = createQueueDispatcher<typeof testEnv>(
    [{ contract, handler: TEST_TYPES.Handler }],
    [{ bindings }],
    {
      rawQueues: [
        {
          name: 'delivery-events',
          queueName: () => RAW_QUEUE_NAME,
          handler: TEST_TYPES.RawHandler,
        },
      ],
    },
  );
  const dispatch = async (queueName: string, body: unknown) => {
    const batch = createMessageBatch(queueName, [
      { id: 'queue-message-1', timestamp: new Date(), attempts: 1, body },
    ]);
    const [message] = batch.messages;
    const retrySpy =
      message === undefined ? undefined : vi.spyOn(message, 'retry');
    const ctx = createExecutionContext();
    await dispatcher.dispatch(batch, testEnv, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    return {
      acked: explicitAcks.length === 1,
      retried: retryMessages.length === 1,
      delaySeconds: retrySpy?.mock.calls.at(-1)?.[0]?.delaySeconds,
    };
  };
  return { calls, dispatch };
}

const envelope: QueueEnvelope = {
  v: 1,
  type: contract.type,
  id: ENVELOPE_ID,
  sentAt: '2026-10-25T03:00:00.000Z',
  body: { value: 'a' },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  ensureLoggingConfigured({ appName: 'event', level: 'error' });
});

afterAll(() => {
  vi.useRealTimers();
  resetSync();
});

// 偽のタイマーでやり直しの待ちを進めながら配信を終える
async function settle<T>(run: Promise<T>): Promise<T> {
  const state = { settled: false };
  const tracked = run.finally(() => {
    state.settled = true;
  });
  while (!state.settled) {
    await vi.advanceTimersByTimeAsync(TRANSIENT_D1_RETRY_DELAYS_MS.at(-1) ?? 0);
  }
  return tracked;
}

describe('createQueueDispatcherのD1の一時的な失敗のやり直し', () => {
  test('封筒付きのメッセージは、ロックの競合の後に同じ配信の中でやり直し、成功すればackする', async () => {
    const { calls, dispatch } = createDispatcher((call) => call === 1);

    const outcome = await settle(dispatch(JOBS_QUEUE_NAME, envelope));

    expect(outcome).toMatchObject({ acked: true, retried: false });
    expect(calls.envelope).toBe(2);
  });

  test('封筒付きのメッセージは、ロックの競合が続けば決めた回数だけやり直した後に再試行の方針で再試行させる', async () => {
    const { calls, dispatch } = createDispatcher(() => true);

    const outcome = await settle(dispatch(JOBS_QUEUE_NAME, envelope));

    expect(outcome).toEqual({ acked: false, retried: true, delaySeconds: 30 });
    expect(calls.envelope).toBe(TRANSIENT_D1_RETRY_DELAYS_MS.length + 1);
  });

  test('封筒の無いメッセージも、ロックの競合の後に同じ配信の中でやり直し、成功すればackする', async () => {
    const { calls, dispatch } = createDispatcher((call) => call === 1);

    const outcome = await settle(dispatch(RAW_QUEUE_NAME, { any: 'body' }));

    expect(outcome).toMatchObject({ acked: true, retried: false });
    expect(calls.raw).toBe(2);
  });
});
