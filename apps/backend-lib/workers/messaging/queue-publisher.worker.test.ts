import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import type { IdGenerator } from '../../core/ids/id-generator.ts';
import {
  parseEnvelope,
  type QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import {
  defineMessageContract,
  type MessageContract,
} from '../../core/messaging/message-contract.ts';
import type { Clock } from '../../core/time/clock.ts';
import {
  createMessagePublisher,
  MessagePublishError,
} from './queue-publisher.ts';

interface SentMessage {
  readonly body: QueueEnvelope;
  readonly options: QueueSendOptions | undefined;
}

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: SentMessage[];
}

function createRecordingQueue(): RecordingQueue {
  const sent: SentMessage[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body, options) => {
      sent.push({ body, options });
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

const SENT_AT = new Date('2026-10-25T03:04:05.678Z');
const fixedClock: Clock = { now: () => new Date(SENT_AT) };
const MESSAGE_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';
const fixedIds: IdGenerator = { generate: () => MESSAGE_ID };

const greetingContract = defineMessageContract(
  'test.send-greeting',
  z.object({ recipient: z.string().min(1), count: z.int().positive() }),
);
const unregisteredContract = defineMessageContract(
  'test.unregistered-job',
  z.object({ recipient: z.string() }),
);
const CONTRACTS: readonly MessageContract<string, unknown>[] = [
  greetingContract,
];

const PRIVATE_RECIPIENT = 'private-recipient@mail.example';

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗するはずの送信が成功した');
}

describe('createMessagePublisher', () => {
  test('封筒に版・種別・ID・送信日時を付けて本文を送り、送ったIDを返す', async () => {
    const { queue, sent } = createRecordingQueue();
    const publisher = createMessagePublisher(
      queue,
      CONTRACTS,
      fixedIds,
      fixedClock,
    );

    const id = await publisher.publish(greetingContract, {
      recipient: 'alice',
      count: 2,
    });

    expect(id).toBe(MESSAGE_ID);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      v: 1,
      type: 'test.send-greeting',
      id: MESSAGE_ID,
      sentAt: '2026-10-25T03:04:05.678Z',
      body: { recipient: 'alice', count: 2 },
    });
    expect(sent[0]?.options?.delaySeconds).toBeUndefined();
    expect(parseEnvelope(sent[0]?.body)).toEqual({
      ok: true,
      envelope: sent[0]?.body,
    });
  });

  test('登録した契約の検証規則に無いキーは封筒の本文に含めない', async () => {
    const { queue, sent } = createRecordingQueue();
    const publisher = createMessagePublisher(
      queue,
      CONTRACTS,
      fixedIds,
      fixedClock,
    );
    const widerBody = {
      recipient: 'alice',
      count: 1,
      email: PRIVATE_RECIPIENT,
    };

    await publisher.publish(greetingContract, widerBody);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.body).toEqual({ recipient: 'alice', count: 1 });
    expect(JSON.stringify(sent[0]?.body)).not.toContain(PRIVATE_RECIPIENT);
  });

  test('送信ごとに採番したIDが付く', async () => {
    const { queue, sent } = createRecordingQueue();
    let counter = 0;
    const ids: IdGenerator = {
      generate: () => {
        counter += 1;
        return `01HZX3Y7Q2M4N5P6R7S8T9V0W${String(counter)}`;
      },
    };
    const publisher = createMessagePublisher(queue, CONTRACTS, ids, fixedClock);

    const first = await publisher.publish(greetingContract, {
      recipient: 'alice',
      count: 1,
    });
    const second = await publisher.publish(greetingContract, {
      recipient: 'bob',
      count: 1,
    });

    expect(first).not.toBe(second);
    expect(sent.map(({ body }) => body.id)).toEqual([first, second]);
  });

  test.each([0, 1, 43_200])(
    '遅延秒数%iを指定するとその秒数で送る',
    async (delaySeconds) => {
      const { queue, sent } = createRecordingQueue();
      const publisher = createMessagePublisher(
        queue,
        CONTRACTS,
        fixedIds,
        fixedClock,
      );

      await publisher.publish(
        greetingContract,
        { recipient: 'alice', count: 1 },
        { delaySeconds },
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]?.options).toEqual({ delaySeconds });
    },
  );

  test('実物のQueueのバインディングへ上限の遅延秒数で送れる', async () => {
    const publisher = createMessagePublisher(
      env.JOBS_QUEUE,
      CONTRACTS,
      fixedIds,
      fixedClock,
    );

    await expect(
      publisher.publish(
        greetingContract,
        { recipient: 'alice', count: 1 },
        { delaySeconds: 43_200 },
      ),
    ).resolves.toBe(MESSAGE_ID);
  });

  test('集約点に無い種別は送らずに理由unknown-typeで失敗する', async () => {
    const { queue, sent } = createRecordingQueue();
    const publisher = createMessagePublisher(
      queue,
      CONTRACTS,
      fixedIds,
      fixedClock,
    );

    const error = await captureRejection(
      publisher.publish(unregisteredContract, { recipient: PRIVATE_RECIPIENT }),
    );

    expect(error).toBeInstanceOf(MessagePublishError);
    expect(error).toMatchObject({
      name: 'MessagePublishError',
      reason: 'unknown-type',
    });
    expect((error as Error).message).toContain('test.unregistered-job');
    expect((error as Error).message).not.toContain(PRIVATE_RECIPIENT);
    expect(sent).toHaveLength(0);
  });

  test('同じ種別名でも集約点に登録された検証規則で本文を検証する', async () => {
    const { queue, sent } = createRecordingQueue();
    const publisher = createMessagePublisher(
      queue,
      CONTRACTS,
      fixedIds,
      fixedClock,
    );
    const looserContract = defineMessageContract(
      'test.send-greeting',
      z.object({ recipient: z.string() }),
    );

    const error = await captureRejection(
      publisher.publish(looserContract, { recipient: PRIVATE_RECIPIENT }),
    );

    expect(error).toMatchObject({ reason: 'invalid-body' });
    expect(sent).toHaveLength(0);
  });

  test('検証に失敗する本文は送らずに理由invalid-bodyで失敗し、例外に本文を含めない', async () => {
    const { queue, sent } = createRecordingQueue();
    const publisher = createMessagePublisher(
      queue,
      CONTRACTS,
      fixedIds,
      fixedClock,
    );
    const invalidBody = { recipient: PRIVATE_RECIPIENT, count: -1 };

    const error = await captureRejection(
      publisher.publish(greetingContract, invalidBody),
    );

    expect(error).toBeInstanceOf(MessagePublishError);
    expect(error).toMatchObject({
      name: 'MessagePublishError',
      reason: 'invalid-body',
    });
    expect((error as Error).message).toContain('test.send-greeting');
    expect((error as Error).message).not.toContain(PRIVATE_RECIPIENT);
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(PRIVATE_RECIPIENT);
    expect(sent).toHaveLength(0);
  });

  test.each([43_201, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '遅延秒数%sは送らずに理由invalid-delayで失敗する',
    async (delaySeconds) => {
      const { queue, sent } = createRecordingQueue();
      const publisher = createMessagePublisher(
        queue,
        CONTRACTS,
        fixedIds,
        fixedClock,
      );

      const error = await captureRejection(
        publisher.publish(
          greetingContract,
          { recipient: PRIVATE_RECIPIENT, count: 1 },
          { delaySeconds },
        ),
      );

      expect(error).toBeInstanceOf(MessagePublishError);
      expect(error).toMatchObject({ reason: 'invalid-delay' });
      expect((error as Error).message).not.toContain(PRIVATE_RECIPIENT);
      expect(sent).toHaveLength(0);
    },
  );

  test('Queueへの送信の失敗はそのまま呼び出し元へ伝わる', async () => {
    const sendFailure = new Error('Queueへの送信に失敗した');
    const failingQueue: Queue<QueueEnvelope> = {
      ...createRecordingQueue().queue,
      send: () => Promise.reject(sendFailure),
    };
    const publisher = createMessagePublisher(
      failingQueue,
      CONTRACTS,
      fixedIds,
      fixedClock,
    );

    await expect(
      publisher.publish(greetingContract, { recipient: 'alice', count: 1 }),
    ).rejects.toBe(sendFailure);
  });
});
