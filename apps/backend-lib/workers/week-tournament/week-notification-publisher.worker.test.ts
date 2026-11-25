import { beforeEach, describe, expect, test } from 'vitest';

import { isoWeekKey } from '../../../common-lib/tournament/week-period.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import { matchWindow } from '../../core/match/match-model.ts';
import {
  type NotificationEvent,
  notificationEventDedupeKey,
  type NotificationEventPublisher,
  NOTIFICATION_PUBLISH_EVENT_LIMIT,
  NotificationPublishError,
  type NotificationPublishErrorReason,
  type NotificationPublishRequest,
  type NotificationPublishResult,
} from '../../core/notifications/notification-event-contract.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type {
  WeekAwardedProduct,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import { D1MatchDirectory } from '../match/d1-match-directory.ts';
import {
  clearMatchTables,
  type EntryFixture,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../match/testing/match-fixtures.ts';
import { db, productIdOf } from '../product/testing/product-fixtures.ts';
import { recordLogs } from '../tournament/testing/observability-fixtures.ts';
import { WEEK_START } from './testing/week-tournament-fixtures.ts';
import { WeekTournamentNotificationPublisher } from './week-notification-publisher.ts';

const PUBLISHER_CATEGORY = 'api.week-tournament.notification';

const NIGHT_DATE = parseBusinessDate('2026-11-24');

const NEXT_DATE = parseBusinessDate('2026-11-25');

const AT = fromBusinessDateTime(NIGHT_DATE, { hour: 23, minute: 45 });

const START_OF_NIGHT_DATE = fromBusinessDateTime(NIGHT_DATE, {
  hour: 0,
  minute: 0,
});

const NEXT_WEEK_START = parseBusinessDate('2026-11-23');

interface RecordedAward extends WeekAwardedProduct {
  readonly awardedAt: Date;
}

interface AwardQuery {
  readonly from: Date;
  readonly to: Date;
}

// 実物の発行の口と同じく、記録済みの通知イベントを重複として数え、新しい通知イベントに1件でも違反があれば何も記録せずに違反の位置を返す
class FakeNotificationEventPublisher implements NotificationEventPublisher {
  readonly requests: NotificationPublishRequest[] = [];
  readonly results: NotificationPublishResult[] = [];
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
      (event) => !this.recorded.has(notificationEventDedupeKey(event)),
    );
    for (const [index, event] of events.entries()) {
      const key = notificationEventDedupeKey(event);
      const reason = this.violations.get(key);
      if (!this.recorded.has(key) && reason !== undefined) {
        return Promise.reject(new NotificationPublishError(reason, index));
      }
    }
    for (const event of newEvents) {
      this.recorded.set(notificationEventDedupeKey(event), event);
    }
    const result = {
      recorded: newEvents.length,
      duplicates: events.length - newEvents.length,
    };
    this.results.push(result);
    return Promise.resolve(result);
  }

  recordedKeys(): string[] {
    return [...this.recorded.keys()].toSorted();
  }
}

interface Harness {
  readonly service: WeekTournamentNotificationPublisher;
  readonly notifications: FakeNotificationEventPublisher;
  readonly awardQueries: AwardQuery[];
}

function createHarness(
  options: {
    readonly violations?: ReadonlyMap<string, NotificationPublishErrorReason>;
    readonly awards?: readonly RecordedAward[];
  } = {},
): Harness {
  const notifications = new FakeNotificationEventPublisher(options.violations);
  const awardQueries: AwardQuery[] = [];
  const awards = options.awards ?? [];
  const listAwardedBetween: WeekTournamentStore['listAwardedBetween'] = (
    from,
    to,
  ) => {
    awardQueries.push({ from, to });
    return Promise.resolve(
      awards
        .filter(
          ({ awardedAt }) =>
            awardedAt.getTime() >= from.getTime() &&
            awardedAt.getTime() < to.getTime(),
        )
        .map(({ weekStart, productId }) => ({ weekStart, productId })),
    );
  };
  const store = { listAwardedBetween } as unknown as WeekTournamentStore;
  return {
    service: new WeekTournamentNotificationPublisher(
      store,
      new D1MatchDirectory(db),
      notifications,
      'api',
    ),
    notifications,
    awardQueries,
  };
}

function idsOf(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => matchIdOf(from + offset));
}

const resultKey = (matchId: string) => `match_result:${matchId}`;

const previewKey = (matchId: string) => `match_preview:${matchId}`;

function awardKey(weekStart: BusinessDate, productId: string): string {
  return `award:product_of_the_week:${isoWeekKey(weekStart)}:${productId}`;
}

function sidesOf(match: number, count: 1 | 2): EntryFixture[] {
  return Array.from({ length: count }, (_, offset) => ({
    index: match * 10 + offset + 1,
    launch: null,
    product: null,
    owner: null,
  }));
}

function weekMatch(
  index: number,
  date: BusinessDate,
  columns: NonNullable<MatchFixture['columns']>,
  sides: 1 | 2 = 2,
): MatchFixture {
  const window = matchWindow(date);
  return {
    index,
    columns: {
      kind: 'week',
      matchDate: date,
      round: 1,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      ...columns,
    },
    entries: sidesOf(index, sides),
  };
}

const NIGHT_WINDOW = matchWindow(NIGHT_DATE);

const DECIDED = {
  startedAt: NIGHT_WINDOW.startsAt,
  decidedAt: new Date(NIGHT_WINDOW.endsAt.getTime() + 60_000),
  decision: 'votes',
} as const;

// 当日のWeekの確定(1・2・側が1つの3)と未確定(4)、当日の確定した予選(5)、翌日のWeekの側が2つの予定(6・7)と側が1つの予定(8)
async function seedNight(): Promise<void> {
  await insertMatches([
    weekMatch(1, NIGHT_DATE, DECIDED),
    weekMatch(2, NIGHT_DATE, DECIDED),
    weekMatch(3, NIGHT_DATE, { ...DECIDED, decision: 'bye' }, 1),
    weekMatch(4, NIGHT_DATE, { startedAt: NIGHT_WINDOW.startsAt }),
    weekMatch(5, NIGHT_DATE, { ...DECIDED, kind: 'qualifier', round: null }),
    weekMatch(6, NEXT_DATE, {}),
    weekMatch(7, NEXT_DATE, {}),
    weekMatch(8, NEXT_DATE, {}, 1),
  ]);
}

const NIGHT_AWARDS: readonly RecordedAward[] = [
  {
    weekStart: WEEK_START,
    productId: productIdOf(1),
    awardedAt: new Date(AT.getTime() - 300_000),
  },
  {
    weekStart: NEXT_WEEK_START,
    productId: productIdOf(2),
    awardedAt: new Date(START_OF_NIGHT_DATE.getTime() - 1),
  },
  {
    weekStart: NEXT_WEEK_START,
    productId: productIdOf(3),
    awardedAt: AT,
  },
];

let logs: LogObject[] = [];

function publisherLogs(): LogObject[] {
  return logs.filter(({ category }) => category === PUBLISHER_CATEGORY);
}

beforeEach(async () => {
  logs = recordLogs();
  await clearMatchTables();
});

describe('WeekTournamentNotificationPublisher.publishRound', () => {
  test('確定したマッチの結果と側が2つのマッチの予告を、結果・予告の順に50件ずつ発行する', async () => {
    const { service, notifications } = createHarness();
    const decided = idsOf(1, 60);
    const previews = idsOf(101, 40);

    await service.publishRound({
      decidedMatchIds: decided,
      previewMatchIds: previews,
      at: AT,
    });

    expect(
      notifications.requests.map(({ publisher, at, events }) => ({
        publisher,
        at,
        count: events.length,
      })),
    ).toEqual([
      { publisher: 'tournament-week', at: AT, count: 50 },
      { publisher: 'tournament-week', at: AT, count: 50 },
    ]);
    expect(notifications.requests.flatMap(({ events }) => events)).toEqual([
      ...decided.map((matchId) => ({ type: 'match_result', matchId })),
      ...previews.map((matchId) => ({ type: 'match_preview', matchId })),
    ]);
    expect(notifications.recorded.size).toBe(100);
  });

  test('結果も予告も無ければ発行の口を呼ばない', async () => {
    const { service, notifications } = createHarness();

    await service.publishRound({
      decidedMatchIds: [],
      previewMatchIds: [],
      at: AT,
    });

    expect(notifications.requests).toEqual([]);
  });

  test('50件の中の開始済みのマッチの予告1件だけを除いて残りを発行し、除いたマッチをinfoのログに残す', async () => {
    const previews = idsOf(1, 50);
    const started = matchIdOf(23);
    const { service, notifications } = createHarness({
      violations: new Map([[previewKey(started), 'match-not-previewable']]),
    });

    await service.publishRound({
      decidedMatchIds: [],
      previewMatchIds: previews,
      at: AT,
    });

    expect(notifications.requests.map(({ events }) => events.length)).toEqual([
      50, 49,
    ]);
    expect(notifications.recordedKeys()).toEqual(
      previews
        .filter((matchId) => matchId !== started)
        .map(previewKey)
        .toSorted(),
    );
    expect(publisherLogs()).toEqual([
      expect.objectContaining({
        level: 'info',
        matchId: started,
        reason: 'match-not-previewable',
      }),
    ]);
  });

  test('他の理由の違反も1件ずつ除いて違反が無くなるまで発行し直し、除いたマッチをerrorのログに残す', async () => {
    const missing = matchIdOf(2);
    const undecided = matchIdOf(4);
    const { service, notifications } = createHarness({
      violations: new Map<string, NotificationPublishErrorReason>([
        [resultKey(missing), 'match-not-found'],
        [resultKey(undecided), 'match-not-decided'],
      ]),
    });

    await service.publishRound({
      decidedMatchIds: idsOf(1, 5),
      previewMatchIds: [matchIdOf(6)],
      at: AT,
    });

    expect(notifications.requests.map(({ events }) => events.length)).toEqual([
      6, 5, 4,
    ]);
    expect(notifications.recordedKeys()).toEqual(
      [
        resultKey(matchIdOf(1)),
        resultKey(matchIdOf(3)),
        resultKey(matchIdOf(5)),
        previewKey(matchIdOf(6)),
      ].toSorted(),
    );
    expect(publisherLogs()).toEqual([
      expect.objectContaining({
        level: 'error',
        matchId: missing,
        reason: 'match-not-found',
      }),
      expect.objectContaining({
        level: 'error',
        matchId: undecided,
        reason: 'match-not-decided',
      }),
    ]);
  });

  test('全件が違反なら全てを除き、空の発行はしない', async () => {
    const only = matchIdOf(1);
    const { service, notifications } = createHarness({
      violations: new Map([[previewKey(only), 'match-not-previewable']]),
    });

    await service.publishRound({
      decidedMatchIds: [],
      previewMatchIds: [only],
      at: AT,
    });

    expect(notifications.requests.map(({ events }) => events.length)).toEqual([
      1,
    ]);
    expect(notifications.recorded.size).toBe(0);
  });

  test('一時的な失敗は除かずに呼び出し元へ返す', async () => {
    const { service, notifications } = createHarness();
    const failure = new Error('D1の一時的な失敗');
    notifications.failure = failure;

    await expect(
      service.publishRound({
        decidedMatchIds: [matchIdOf(1)],
        previewMatchIds: [],
        at: AT,
      }),
    ).rejects.toBe(failure);
    expect(notifications.requests).toHaveLength(1);
    expect(publisherLogs()).toEqual([]);
  });

  test('違反の位置の無い拒否は除けないため呼び出し元へ返す', async () => {
    const { service, notifications } = createHarness();
    const rejection = new NotificationPublishError('invalid-request');
    notifications.failure = rejection;

    await expect(
      service.publishRound({
        decidedMatchIds: [matchIdOf(1)],
        previewMatchIds: [],
        at: AT,
      }),
    ).rejects.toBe(rejection);
    expect(notifications.requests).toHaveLength(1);
  });
});

describe('WeekTournamentNotificationPublisher.publishAward', () => {
  test('受賞をWeekの賞の種類と週(ISO週)で発行する', async () => {
    const { service, notifications } = createHarness();

    await service.publishAward({
      weekStart: WEEK_START,
      productId: productIdOf(1),
      at: AT,
    });

    expect(notifications.requests).toEqual([
      {
        publisher: 'tournament-week',
        at: AT,
        events: [
          {
            type: 'award',
            award: 'product_of_the_week',
            period: '2026-W47',
            productId: productIdOf(1),
          },
        ],
      },
    ]);
  });
});

describe('WeekTournamentNotificationPublisher.publishNight', () => {
  test('その日のWeekの確定したマッチの結果・翌日の側が2つのマッチの予告・その日に記録した受賞を1回の呼び出しでそろえる', async () => {
    await seedNight();
    const { service, notifications, awardQueries } = createHarness({
      awards: NIGHT_AWARDS,
    });

    await service.publishNight({ date: NIGHT_DATE, at: AT });

    expect(awardQueries).toEqual([{ from: START_OF_NIGHT_DATE, to: AT }]);
    expect(notifications.requests.flatMap(({ events }) => events)).toEqual([
      { type: 'match_result', matchId: matchIdOf(1) },
      { type: 'match_result', matchId: matchIdOf(2) },
      { type: 'match_result', matchId: matchIdOf(3) },
      { type: 'match_preview', matchId: matchIdOf(6) },
      { type: 'match_preview', matchId: matchIdOf(7) },
      {
        type: 'award',
        award: 'product_of_the_week',
        period: isoWeekKey(WEEK_START),
        productId: productIdOf(1),
      },
    ]);
    expect(
      notifications.requests.every(
        ({ publisher, at }) => publisher === 'tournament-week' && at === AT,
      ),
    ).toBe(true);
  });

  test('発行の対象が無い夜は発行の口を呼ばない', async () => {
    const { service, notifications } = createHarness();

    await service.publishNight({ date: NIGHT_DATE, at: AT });

    expect(notifications.requests).toEqual([]);
  });

  test('同じ夜の発行を2回行っても、違反の除外を含めて記録は変わらず全て重複として数えられる', async () => {
    await seedNight();
    const { service, notifications } = createHarness({
      violations: new Map([
        [previewKey(matchIdOf(7)), 'match-not-previewable'],
      ]),
      awards: NIGHT_AWARDS,
    });

    await service.publishNight({ date: NIGHT_DATE, at: AT });
    const first = notifications.recordedKeys();
    const firstResults = notifications.results.length;
    await service.publishNight({ date: NIGHT_DATE, at: AT });

    expect(first).toEqual(
      [
        resultKey(matchIdOf(1)),
        resultKey(matchIdOf(2)),
        resultKey(matchIdOf(3)),
        previewKey(matchIdOf(6)),
        awardKey(WEEK_START, productIdOf(1)),
      ].toSorted(),
    );
    expect(notifications.recordedKeys()).toEqual(first);
    expect(notifications.results.slice(firstResults)).toEqual([
      { recorded: 0, duplicates: 5 },
    ]);
  });

  test('一時的な失敗は例外にする', async () => {
    await seedNight();
    const { service, notifications } = createHarness({
      awards: NIGHT_AWARDS,
    });
    const failure = new Error('D1の一時的な失敗');
    notifications.failure = failure;

    await expect(
      service.publishNight({ date: NIGHT_DATE, at: AT }),
    ).rejects.toBe(failure);
  });
});
