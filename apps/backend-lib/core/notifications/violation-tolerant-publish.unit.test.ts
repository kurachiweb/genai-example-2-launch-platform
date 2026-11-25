import { describe, expect, test } from 'bun:test';

import type { Logger } from '@logtape/logtape';

import {
  type NotificationEvent,
  notificationEventDedupeKey,
  type NotificationEventPublisher,
  NOTIFICATION_PUBLISH_EVENT_LIMIT,
  NotificationPublishError,
  type NotificationPublishErrorReason,
  type NotificationPublishRequest,
  type NotificationPublishResult,
} from './notification-event-contract.ts';
import { publishExcludingViolations } from './violation-tolerant-publish.ts';

const NAME = 'tournament-week';

const AT = new Date('2026-11-24T14:45:00.000Z');

const ULID_PREFIX = '01JQ00000000000000000';

function idOf(index: number): string {
  return `${ULID_PREFIX}${String(index).padStart(5, '0')}`;
}

function idsOf(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => idOf(from + offset));
}

const resultOf = (matchId: string): NotificationEvent => ({
  type: 'match_result',
  matchId,
});

const previewOf = (matchId: string): NotificationEvent => ({
  type: 'match_preview',
  matchId,
});

const awardOf = (productId: string): NotificationEvent => ({
  type: 'award',
  award: 'product_of_the_week',
  period: '2026-W47',
  productId,
});

const keyOf = notificationEventDedupeKey;

// 実物の発行の口と同じく、記録済みの通知イベントを重複として数え、新しい通知イベントに1件でも違反があれば何も記録せずに違反の位置を返す
class FakeNotificationEventPublisher implements NotificationEventPublisher {
  readonly requests: NotificationPublishRequest[] = [];
  readonly recorded = new Map<string, NotificationEvent>();
  failure: Error | undefined;

  constructor(
    private readonly violations: ReadonlyMap<
      string,
      NotificationPublishErrorReason
    > = new Map(),
  ) {}

  publish(
    request: NotificationPublishRequest,
  ): Promise<NotificationPublishResult> {
    this.requests.push(request);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    const { events } = request;
    if (events.length < 1 || events.length > NOTIFICATION_PUBLISH_EVENT_LIMIT) {
      return Promise.reject(new NotificationPublishError('invalid-request'));
    }
    const newEvents = events.filter(
      (event) => !this.recorded.has(keyOf(event)),
    );
    for (const [index, event] of events.entries()) {
      const reason = this.violations.get(keyOf(event));
      if (!this.recorded.has(keyOf(event)) && reason !== undefined) {
        return Promise.reject(new NotificationPublishError(reason, index));
      }
    }
    for (const event of newEvents) {
      this.recorded.set(keyOf(event), event);
    }
    return Promise.resolve({
      recorded: newEvents.length,
      duplicates: events.length - newEvents.length,
    });
  }

  recordedKeys(): string[] {
    return [...this.recorded.keys()].toSorted();
  }
}

interface LoggedRecord {
  readonly level: 'info' | 'error';
  readonly message: string;
  readonly properties: unknown;
}

function recordingLogger(): {
  readonly logger: Logger;
  readonly records: LoggedRecord[];
} {
  const records: LoggedRecord[] = [];
  const recorder =
    (level: LoggedRecord['level']) =>
    (message: string, properties: unknown) => {
      records.push({ level, message, properties });
    };
  const logger = {
    info: recorder('info'),
    error: recorder('error'),
  } as unknown as Logger;
  return { logger, records };
}

function publish(
  publisher: NotificationEventPublisher,
  events: readonly NotificationEvent[],
  logger: Logger = recordingLogger().logger,
): Promise<void> {
  return publishExcludingViolations({
    publisher,
    name: NAME,
    events,
    at: AT,
    logger,
  });
}

describe('publishExcludingViolations', () => {
  test('通知イベントを渡した順のまま、発行元の名前と時刻を付けて50件ずつ発行する', async () => {
    const publisher = new FakeNotificationEventPublisher();
    const events = [
      ...idsOf(1, 60).map(resultOf),
      ...idsOf(101, 40).map(previewOf),
    ];

    await publish(publisher, events);

    expect(
      publisher.requests.map(({ publisher: name, at, events: page }) => ({
        name,
        at,
        count: page.length,
      })),
    ).toEqual([
      { name: NAME, at: AT, count: 50 },
      { name: NAME, at: AT, count: 50 },
    ]);
    expect(publisher.requests.flatMap(({ events: page }) => page)).toEqual(
      events,
    );
    expect(publisher.recorded.size).toBe(100);
  });

  test('50件を超える端数は最後の組で発行する', async () => {
    const publisher = new FakeNotificationEventPublisher();

    await publish(publisher, idsOf(1, 101).map(resultOf));

    expect(publisher.requests.map(({ events: page }) => page.length)).toEqual([
      50, 50, 1,
    ]);
  });

  test('通知イベントが無ければ発行の口を呼ばない', async () => {
    const publisher = new FakeNotificationEventPublisher();

    await publish(publisher, []);

    expect(publisher.requests).toEqual([]);
  });

  test('50件の中の開始済みのマッチの予告1件だけを除いて残りを発行し、除いたマッチをinfoのログに識別と理由だけで残す', async () => {
    const previews = idsOf(1, 50);
    const started = idOf(23);
    const publisher = new FakeNotificationEventPublisher(
      new Map([[keyOf(previewOf(started)), 'match-not-previewable']]),
    );
    const { logger, records } = recordingLogger();

    await publish(publisher, previews.map(previewOf), logger);

    expect(publisher.requests.map(({ events }) => events.length)).toEqual([
      50, 49,
    ]);
    expect(publisher.recordedKeys()).toEqual(
      previews
        .filter((matchId) => matchId !== started)
        .map((matchId) => keyOf(previewOf(matchId)))
        .toSorted(),
    );
    expect(records).toEqual([
      {
        level: 'info',
        message: expect.any(String) as string,
        properties: { matchId: started, reason: 'match-not-previewable' },
      },
    ]);
  });

  test('他の理由の違反も1件ずつ除いて違反が無くなるまで発行し直し、除いたマッチとプロダクトをerrorのログに識別と理由だけで残す', async () => {
    const missing = idOf(2);
    const undecided = idOf(4);
    const hiddenProduct = idOf(901);
    const publisher = new FakeNotificationEventPublisher(
      new Map<string, NotificationPublishErrorReason>([
        [keyOf(resultOf(missing)), 'match-not-found'],
        [keyOf(resultOf(undecided)), 'match-not-decided'],
        [keyOf(awardOf(hiddenProduct)), 'invalid-event'],
      ]),
    );
    const { logger, records } = recordingLogger();

    await publish(
      publisher,
      [
        ...idsOf(1, 5).map(resultOf),
        previewOf(idOf(6)),
        awardOf(hiddenProduct),
      ],
      logger,
    );

    expect(publisher.requests.map(({ events }) => events.length)).toEqual([
      7, 6, 5, 4,
    ]);
    expect(publisher.recordedKeys()).toEqual(
      [
        keyOf(resultOf(idOf(1))),
        keyOf(resultOf(idOf(3))),
        keyOf(resultOf(idOf(5))),
        keyOf(previewOf(idOf(6))),
      ].toSorted(),
    );
    expect(
      records.map(({ level, properties }) => ({ level, properties })),
    ).toEqual([
      {
        level: 'error',
        properties: { matchId: missing, reason: 'match-not-found' },
      },
      {
        level: 'error',
        properties: { matchId: undecided, reason: 'match-not-decided' },
      },
      {
        level: 'error',
        properties: { productId: hiddenProduct, reason: 'invalid-event' },
      },
    ]);
  });

  test('違反を除いた組の後の組も続けて発行する', async () => {
    const started = idOf(10);
    const publisher = new FakeNotificationEventPublisher(
      new Map([[keyOf(previewOf(started)), 'match-not-previewable']]),
    );

    await publish(publisher, idsOf(1, 60).map(previewOf));

    expect(publisher.requests.map(({ events }) => events.length)).toEqual([
      50, 49, 10,
    ]);
    expect(publisher.recorded.size).toBe(59);
  });

  test('全件が違反なら全てを除き、空の発行はしない', async () => {
    const only = idOf(1);
    const publisher = new FakeNotificationEventPublisher(
      new Map([[keyOf(previewOf(only)), 'match-not-previewable']]),
    );

    await publish(publisher, [previewOf(only)]);

    expect(publisher.requests.map(({ events }) => events.length)).toEqual([1]);
    expect(publisher.recorded.size).toBe(0);
  });

  test('一時的な失敗は除かずに呼び出し元へ返し、ログに残さない', async () => {
    const publisher = new FakeNotificationEventPublisher();
    const failure = new Error('D1の一時的な失敗');
    publisher.failure = failure;
    const { logger, records } = recordingLogger();

    const thrown = await publish(publisher, [resultOf(idOf(1))], logger).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBe(failure);
    expect(publisher.requests).toHaveLength(1);
    expect(records).toEqual([]);
  });

  test('違反の位置の無い拒否は除けないため呼び出し元へ返す', async () => {
    const publisher = new FakeNotificationEventPublisher();
    const rejection = new NotificationPublishError('invalid-request');
    publisher.failure = rejection;

    const thrown = await publish(publisher, [resultOf(idOf(1))]).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBe(rejection);
    expect(publisher.requests).toHaveLength(1);
  });

  test('範囲外の違反の位置は除けないため呼び出し元へ返す', async () => {
    const publisher = new FakeNotificationEventPublisher();
    const rejection = new NotificationPublishError('match-not-found', 1);
    publisher.failure = rejection;
    const { logger, records } = recordingLogger();

    const thrown = await publish(publisher, [resultOf(idOf(1))], logger).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBe(rejection);
    expect(publisher.requests).toHaveLength(1);
    expect(records).toEqual([]);
  });
});
