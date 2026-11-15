import { resetSync } from '@logtape/logtape';
import {
  CloudflareClient,
  type Event,
  getCurrentScope,
} from '@sentry/cloudflare';
import { afterAll, afterEach, describe, expect, test } from 'vitest';

import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import {
  MAX_SEARCH_SOURCE_ID_LENGTH,
  SEARCH_INDEX_REFRESH_MESSAGE,
} from '../../core/messaging/contracts/search-index-refresh.ts';
import {
  parseEnvelope,
  type QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import { systemClock } from '../../core/time/clock.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  createMessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import { QueueSearchIndexRefreshRequester } from './search-index-refresh-requester.ts';
import {
  createSearchTargetRegistry,
  SearchTargetRegistryError,
} from './search-target-definition.ts';
import {
  FIXTURE_SEARCH_TARGET_NAME,
  fixtureSearchTarget,
} from './testing/fixture-search-target.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: unknown[];
}

const TARGET = FIXTURE_SEARCH_TARGET_NAME;
const SOURCE_ID = '01JBD8G7Q3Z6W0K8N5S2X4Y9TA';
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const registry = createSearchTargetRegistry([fixtureSearchTarget]);

function createRecordingQueue(failure?: Error): RecordingQueue {
  const sent: unknown[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

function createRequester(
  queue: Queue<QueueEnvelope>,
  appName: 'api' | 'event' = 'api',
): QueueSearchIndexRefreshRequester {
  return new QueueSearchIndexRefreshRequester(
    createMessagePublisher(
      queue,
      MESSAGE_CONTRACTS,
      createUlidGenerator(systemClock),
      systemClock,
    ),
    registry,
    appName,
  );
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

function installRecordingSentry(): Event[] {
  const events: Event[] = [];
  const client = new CloudflareClient({
    dsn: TEST_DSN,
    integrations: [],
    stackParser: () => [],
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
    beforeSend: (event) => {
      events.push(event);
      return null;
    },
  });
  getCurrentScope().setClient(client);
  client.init();
  return events;
}

afterEach(() => {
  getCurrentScope().setClient(undefined);
});

afterAll(() => {
  resetSync();
});

describe('QueueSearchIndexRefreshRequester', () => {
  test('検索対象と元データの識別子だけを本文にした索引の更新のメッセージをQueueへ送る', async () => {
    const { queue, sent } = createRecordingQueue();

    await createRequester(queue).requestRefresh(TARGET, SOURCE_ID);

    expect(sent).toHaveLength(1);
    expect(parseEnvelope(sent[0])).toEqual({ ok: true, envelope: sent[0] });
    expect(sent[0]).toMatchObject<Partial<QueueEnvelope>>({
      type: SEARCH_INDEX_REFRESH_MESSAGE.type,
      body: { target: TARGET, sourceId: SOURCE_ID },
    });
  });

  test('登録されていない検索対象は呼び出し側の誤りとして例外にし、送らない', async () => {
    const { queue, sent } = createRecordingQueue();

    await expect(
      createRequester(queue).requestRefresh('unregistered-target', SOURCE_ID),
    ).rejects.toThrow(SearchTargetRegistryError);
    expect(sent).toEqual([]);
  });

  test('送信の失敗は例外にせず、検索対象と識別子を添えたerrorログとSentryの例外のイベントに送る', async () => {
    const logs = recordLogs();
    const events = installRecordingSentry();
    const failure = new Error('Queueへの送信に失敗しました');
    const { queue } = createRecordingQueue(failure);

    await expect(
      createRequester(queue).requestRefresh(TARGET, SOURCE_ID),
    ).resolves.toBeUndefined();

    const errors = logs.filter(({ level }) => level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      category: 'api.search.refresh',
      message: '索引の更新の要求を送れませんでした',
      target: TARGET,
      sourceId: SOURCE_ID,
      error: { name: 'Error', message: failure.message },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.tags).toMatchObject({ search_target: TARGET });
    expect(events[0]?.exception?.values?.[0]?.value).toBe(failure.message);
  });

  test('ログのカテゴリは束縛したアプリの名前で始まる', async () => {
    const logs = recordLogs('event');
    installRecordingSentry();
    const { queue } = createRecordingQueue(new Error('送信の失敗'));

    await createRequester(queue, 'event').requestRefresh(TARGET, SOURCE_ID);

    expect(
      logs.filter(({ level }) => level === 'error').map((log) => log.category),
    ).toEqual(['event.search.refresh']);
  });

  test.each([
    ['空', ''],
    ['65文字', 'x'.repeat(MAX_SEARCH_SOURCE_ID_LENGTH + 1)],
  ])(
    '元データの識別子が%sで本文が契約の検証規則に合わなければ、呼び出し側の誤りとして例外にし、送らない',
    async (_, sourceId) => {
      const logs = recordLogs();
      const events = installRecordingSentry();
      const { queue, sent } = createRecordingQueue();

      const error = await createRequester(queue)
        .requestRefresh(TARGET, sourceId)
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );

      expect(error).toBeInstanceOf(MessagePublishError);
      expect(error).toMatchObject({ reason: 'invalid-body' });
      expect(sent).toEqual([]);
      expect(logs.filter(({ level }) => level === 'error')).toEqual([]);
      expect(events).toEqual([]);
    },
  );
});
