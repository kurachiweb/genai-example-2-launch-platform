import { describe, expect, test } from 'vitest';

import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import {
  EXPAND_NOTIFICATION_EVENT_MESSAGE,
  FLUSH_NOTIFICATION_SLOT_MESSAGE,
} from '../../core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import { systemClock } from '../../core/time/clock.ts';
import {
  createMessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import { MessageWorkRequester } from './message-work-requester.ts';

const EVENT_ID = '01JC0AWARD0000000000000001';

interface SentMessage {
  readonly envelope: QueueEnvelope;
  readonly options: QueueSendOptions | undefined;
}

function createRequester(): {
  readonly requester: MessageWorkRequester;
  readonly sent: readonly SentMessage[];
} {
  const sent: SentMessage[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (envelope, options) => {
      sent.push({ envelope, options });
      return Promise.resolve({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  const requester = new MessageWorkRequester(
    createMessagePublisher(
      queue,
      MESSAGE_CONTRACTS,
      createUlidGenerator(systemClock),
      systemClock,
    ),
  );
  return { requester, sent };
}

describe('MessageWorkRequester', () => {
  test('送り出しの依頼は枠のキーだけを本文にし、指定した秒数だけ遅らせて送る', async () => {
    const { requester, sent } = createRequester();

    await requester.flushSlot('evening:2026-11-01', 600);
    await requester.flushSlot(`award:${EVENT_ID}`, 0);

    expect(sent).toEqual([
      {
        envelope: expect.objectContaining({
          type: FLUSH_NOTIFICATION_SLOT_MESSAGE.type,
          body: { slotKey: 'evening:2026-11-01' },
        }) as QueueEnvelope,
        options: { delaySeconds: 600 },
      },
      {
        envelope: expect.objectContaining({
          type: FLUSH_NOTIFICATION_SLOT_MESSAGE.type,
          body: { slotKey: `award:${EVENT_ID}` },
        }) as QueueEnvelope,
        options: { delaySeconds: 0 },
      },
    ]);
  });

  test('展開の依頼は通知イベントのIDだけを本文にし、遅らせずに送る', async () => {
    const { requester, sent } = createRequester();

    await requester.expandEvent(EVENT_ID);

    expect(sent).toEqual([
      {
        envelope: expect.objectContaining({
          type: EXPAND_NOTIFICATION_EVENT_MESSAGE.type,
          body: { eventId: EVENT_ID },
        }) as QueueEnvelope,
        options: undefined,
      },
    ]);
  });

  test('不正な枠のキー・遅延秒数・通知イベントのIDは送らずに例外を投げる', async () => {
    const { requester, sent } = createRequester();

    await expect(requester.flushSlot('weekly:2026-11-01', 0)).rejects.toThrow(
      MessagePublishError,
    );
    await expect(
      requester.flushSlot('evening:2026-11-01', 43_201),
    ).rejects.toThrow(MessagePublishError);
    await expect(requester.expandEvent(EVENT_ID.toLowerCase())).rejects.toThrow(
      MessagePublishError,
    );
    expect(sent).toEqual([]);
  });
});
