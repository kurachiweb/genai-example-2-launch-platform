import { resetSync } from '@logtape/logtape';
import { afterAll, describe, expect, test } from 'vitest';

import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import { RUN_MATCH_EVENT_MESSAGE } from '../../core/messaging/contracts/match.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import { systemClock } from '../../core/time/clock.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import { createMessagePublisher } from '../messaging/queue-publisher.ts';
import {
  MATCH_EVENT_PUBLISH_CONCURRENCY,
  QueueMatchEventDispatcher,
} from './queue-match-event-dispatcher.ts';
import {
  createControlledPublisher,
  matchEventIdOf,
} from './testing/event-fixtures.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

function recordLogs(appName: 'api' | 'event' = 'api'): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

function eventIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => matchEventIdOf(i + 1));
}

afterAll(() => {
  resetSync();
});

describe('QueueMatchEventDispatcher', () => {
  test('イベントのIDだけを本文にしたマッチイベントの実行のメッセージを1件ずつQueueへ送る', async () => {
    const sent: unknown[] = [];
    const queue: Queue<QueueEnvelope> = {
      metrics: () => Promise.reject(new Error('テストでは使わない')),
      send: (body) => {
        sent.push(body);
        return Promise.resolve({
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        });
      },
      sendBatch: () => Promise.reject(new Error('テストでは使わない')),
    };
    const dispatcher = new QueueMatchEventDispatcher(
      createMessagePublisher(
        queue,
        MESSAGE_CONTRACTS,
        createUlidGenerator(systemClock),
        systemClock,
      ),
      'api',
    );

    await dispatcher.publish([matchEventIdOf(1), matchEventIdOf(2)]);

    expect(sent).toMatchObject([
      {
        type: RUN_MATCH_EVENT_MESSAGE.type,
        body: { eventId: matchEventIdOf(1) },
      },
      {
        type: RUN_MATCH_EVENT_MESSAGE.type,
        body: { eventId: matchEventIdOf(2) },
      },
    ]);
  });

  test('6件までを並行して送り、すべてのイベントを1回ずつ送る', async () => {
    const publisher = createControlledPublisher();
    const ids = eventIds(20);

    await new QueueMatchEventDispatcher(publisher, 'api').publish([
      ...ids,
      ids[0] ?? '',
    ]);

    expect(MATCH_EVENT_PUBLISH_CONCURRENCY).toBe(6);
    expect(publisher.maxInFlight()).toBe(MATCH_EVENT_PUBLISH_CONCURRENCY);
    expect(
      publisher.bodies.map((body) => (body as { eventId: string }).eventId),
    ).toEqual(expect.arrayContaining(ids));
    expect(publisher.bodies).toHaveLength(ids.length);
  });

  test('一部の送信の失敗で他の送信を止めず、失敗したイベントのIDだけをwarnのログに残して例外にしない', async () => {
    const logs = recordLogs();
    const ids = eventIds(10);
    const failing = new Set([ids[1], ids[7]]);
    const publisher = createControlledPublisher((id) => failing.has(id));

    await expect(
      new QueueMatchEventDispatcher(publisher, 'api').publish(ids),
    ).resolves.toBeUndefined();

    expect(publisher.bodies).toHaveLength(8);
    const warnings = logs.filter(
      ({ category }) => category === 'api.match.events',
    );
    expect(warnings.map((log) => log.eventId).sort()).toEqual(
      [ids[1], ids[7]].sort(),
    );
    for (const warning of warnings) {
      expect(warning).toMatchObject({
        level: 'warning',
        message: 'マッチイベントを送れず、送り直しに委ねました',
        error: { message: 'Queueへの送信に失敗しました' },
      });
      expect(Object.keys(warning).sort()).toEqual(
        ['time', 'category', 'error', 'eventId', 'level', 'message'].sort(),
      );
    }
  });

  test('ログのカテゴリは束縛したアプリの名前で始まる', async () => {
    const logs = recordLogs('event');
    const publisher = createControlledPublisher(() => true);

    await new QueueMatchEventDispatcher(publisher, 'event').publish(
      eventIds(1),
    );

    expect(
      logs
        .filter(({ message }) => message.startsWith('マッチイベント'))
        .map((log) => log.category),
    ).toEqual(['event.match.events']);
  });

  test('空の一覧は何も送らない', async () => {
    const publisher = createControlledPublisher();

    await new QueueMatchEventDispatcher(publisher, 'api').publish([]);

    expect(publisher.bodies).toEqual([]);
    expect(publisher.maxInFlight()).toBe(0);
  });
});
