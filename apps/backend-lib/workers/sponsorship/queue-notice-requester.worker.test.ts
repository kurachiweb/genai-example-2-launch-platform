import { describe, expect, test } from 'vitest';

import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import {
  SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
  SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE,
} from '../../core/messaging/contracts/sponsorship.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import type { Clock } from '../../core/time/clock.ts';
import { createMessagePublisher } from '../messaging/queue-publisher.ts';
import { QueueNoticeRequester } from './queue-notice-requester.ts';

const REQUESTED_AT = new Date('2026-11-25T08:07:00.000Z');

const fixedClock: Clock = { now: () => new Date(REQUESTED_AT) };

function createRequester(
  send: (envelope: QueueEnvelope) => Promise<void> = () => Promise.resolve(),
): {
  readonly requester: QueueNoticeRequester;
  readonly sent: readonly QueueEnvelope[];
} {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: async (envelope) => {
      await send(envelope);
      sent.push(envelope);
      return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  const requester = new QueueNoticeRequester(
    createMessagePublisher(
      queue,
      MESSAGE_CONTRACTS,
      createUlidGenerator(fixedClock),
      fixedClock,
    ),
    fixedClock,
  );
  return { requester, sent };
}

describe('QueueNoticeRequester', () => {
  test('送信の依頼は通知の送信のメッセージを依頼の時刻だけを本文にして1件送る', async () => {
    const { requester, sent } = createRequester();

    await requester.request();

    expect(sent).toEqual([
      expect.objectContaining({
        type: SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
        body: { requestedAt: REQUESTED_AT.toISOString() },
      }),
    ]);
  });

  test('精算の依頼は掲載終了の精算のメッセージを依頼の時刻だけを本文にして1件送る', async () => {
    const { requester, sent } = createRequester();

    await requester.requestSettlement();

    expect(sent).toEqual([
      expect.objectContaining({
        type: SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
        body: { requestedAt: REQUESTED_AT.toISOString() },
      }),
    ]);
  });

  test('キューへの送信の失敗は例外にする', async () => {
    const failure = new Error('キューへ送れない');
    const { requester, sent } = createRequester(() => Promise.reject(failure));

    await expect(requester.request()).rejects.toBe(failure);
    await expect(requester.requestSettlement()).rejects.toBe(failure);
    expect(sent).toEqual([]);
  });
});
