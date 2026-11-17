import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
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
  addBusinessDays,
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import {
  type YearSchedule,
  yearScheduleFor,
} from '../../core/year-tournament/year-schedule.ts';
import { D1MatchDirectory } from '../match/d1-match-directory.ts';
import {
  clearMatchTables,
  type EntryFixture,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../match/testing/match-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  productIdOf,
} from '../product/testing/product-fixtures.ts';
import { recordLogs } from '../tournament/testing/observability-fixtures.ts';
import { D1YearTournamentStore } from './d1-year-tournament-store.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  type YearEntryFixture,
  yearEntryIdOf,
  type YearTournamentFixture,
} from './testing/year-tournament-fixtures.ts';
import { YearTournamentNotificationPublisher } from './year-notification-publisher.ts';

const PUBLISHER_CATEGORY = 'api.year-tournament.notification';

// 2027年の既定の決勝日(5/30)の前の夜
const EVENING_DATE = parseBusinessDate('2027-05-28');

const NEXT_DATE = addBusinessDays(EVENING_DATE, 1);

const EVENING_AT = eveningAtOf(EVENING_DATE);

const START_OF_EVENING_DATE = fromBusinessDateTime(EVENING_DATE, {
  hour: 0,
  minute: 0,
});

// 決勝日が1月初旬の2028年は、組み合わせ決定が前年12月の夜になる
const JANUARY_FINAL_SCHEDULE = yearScheduleFor(
  2028,
  parseBusinessDate('2028-01-02'),
);

// ラウンドの遅れで2026年の決勝が翌年1月の夜に決着する
const LATE_FINAL_DATE = parseBusinessDate('2027-01-05');

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

  publishedEvents(): NotificationEvent[] {
    return this.requests.flatMap(({ events }) => events);
  }
}

interface Harness {
  readonly service: YearTournamentNotificationPublisher;
  readonly notifications: FakeNotificationEventPublisher;
}

function createHarness(
  violations?: ReadonlyMap<string, NotificationPublishErrorReason>,
): Harness {
  const notifications = new FakeNotificationEventPublisher(violations);
  return {
    service: new YearTournamentNotificationPublisher(
      new D1YearTournamentStore(db),
      new D1MatchDirectory(db),
      notifications,
      'api',
    ),
    notifications,
  };
}

function eveningAtOf(date: BusinessDate): Date {
  return fromBusinessDateTime(date, { hour: 23, minute: 45 });
}

function idsOf(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => matchIdOf(from + offset));
}

const resultKey = (matchId: string) => `match_result:${matchId}`;

const previewKey = (matchId: string) => `match_preview:${matchId}`;

function awardEventOf(year: number, product: number): NotificationEvent {
  return {
    type: 'award',
    award: 'product_of_the_year',
    period: String(year),
    productId: productIdOf(product),
  };
}

function sidesOf(match: number, count: 1 | 2): EntryFixture[] {
  return Array.from({ length: count }, (_, offset) => ({
    index: match * 10 + offset + 1,
    launch: null,
    product: null,
    owner: null,
  }));
}

function matchOn(
  index: number,
  date: BusinessDate,
  columns: NonNullable<MatchFixture['columns']>,
  sides: 1 | 2 = 2,
): MatchFixture {
  const window = matchWindow(date);
  return {
    index,
    columns: {
      kind: 'year',
      matchDate: date,
      round: 1,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      ...columns,
    },
    entries: sidesOf(index, sides),
  };
}

function decidedOn(date: BusinessDate) {
  const window = matchWindow(date);
  return {
    startedAt: window.startsAt,
    decidedAt: new Date(window.endsAt.getTime() + 60_000),
    decision: 'votes',
  } as const;
}

const DECIDED = decidedOn(EVENING_DATE);

// 当日のYearの確定(1・2・側が1つの3)と未確定(4)、当日の確定したWeekと予選(5・6)、翌日のYearの側が2つの予定(7・8)と側が1つの予定(9)、翌日のWeekの予定(10)
async function seedEveningMatches(): Promise<void> {
  await insertMatches([
    matchOn(1, EVENING_DATE, DECIDED),
    matchOn(2, EVENING_DATE, DECIDED),
    matchOn(3, EVENING_DATE, { ...DECIDED, decision: 'bye' }, 1),
    matchOn(4, EVENING_DATE, { startedAt: DECIDED.startedAt }),
    matchOn(5, EVENING_DATE, { ...DECIDED, kind: 'week' }),
    matchOn(6, EVENING_DATE, { ...DECIDED, kind: 'qualifier', round: null }),
    matchOn(7, NEXT_DATE, {}),
    matchOn(8, NEXT_DATE, {}),
    matchOn(9, NEXT_DATE, {}, 1),
    matchOn(10, NEXT_DATE, { kind: 'week' }),
  ]);
}

function scheduleColumnsOf(
  schedule: YearSchedule,
): NonNullable<YearTournamentFixture['columns']> {
  return {
    year: schedule.year,
    finalDate: schedule.finalDate,
    finalDateSource: 'explicit',
    finalDateVersion: 1,
    deadlineDate: schedule.deadlineDate,
    acceptUntil: schedule.acceptUntil,
    deadlineAt: schedule.deadlineAt,
    drawAt: schedule.drawAt,
    changeLockAt: schedule.changeLockAt,
  };
}

// 年の番号と同じ番号の優勝の枠・プロダクトで受賞を記録した年
function awardedYear(
  index: number,
  year: number,
  awardedAt: Date,
  columns: YearTournamentFixture['columns'] = {},
): YearTournamentFixture {
  return {
    index,
    year,
    columns: {
      status: 'finished',
      drawStartedAt: awardedAt,
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(index),
      awardedAt,
      finishedAt: awardedAt,
      updatedAt: awardedAt,
      ...columns,
    },
  };
}

function championEntryOf(index: number, year: number): YearEntryFixture {
  return {
    index,
    launch: index,
    product: index,
    owner: 1,
    columns: {
      status: 'drawn',
      entitlementSource: 'ultras',
      classifiedYear: year,
    },
  };
}

async function unlinkEntry(index: number): Promise<void> {
  await db
    .update(yearTournamentEntries)
    .set({ launchId: null, productId: null, ownerUserId: null })
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
}

// 当日の0:00の前(1)・当日の0:00ちょうど(2)・発行の時刻の直前(3)・発行の時刻ちょうど(4)に受賞を記録した年
async function seedEveningAwards(): Promise<void> {
  await insertYearTournaments([
    awardedYear(1, 2024, new Date(START_OF_EVENING_DATE.getTime() - 1)),
    awardedYear(2, 2025, START_OF_EVENING_DATE),
    awardedYear(3, 2027, new Date(EVENING_AT.getTime() - 300_000)),
    awardedYear(4, 2026, EVENING_AT),
  ]);
  await insertYearEntries([
    championEntryOf(1, 2024),
    championEntryOf(2, 2025),
    championEntryOf(3, 2027),
    championEntryOf(4, 2026),
  ]);
}

let logs: LogObject[] = [];

function publisherLogs(): LogObject[] {
  return logs.filter(({ category }) => category === PUBLISHER_CATEGORY);
}

// 利用者1のプロダクト1〜4を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  logs = recordLogs();
  await clearYearTournamentTables();
  await clearMatchTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
});

describe('YearTournamentNotificationPublisher.publishRound', () => {
  test('確定したマッチの結果と側が2つのマッチの予告を、結果・予告の順に50件ずつYearの発行元で発行する', async () => {
    const { service, notifications } = createHarness();
    const decided = idsOf(1, 60);
    const previews = idsOf(101, 40);

    await service.publishRound({
      decidedMatchIds: decided,
      previewMatchIds: previews,
      at: EVENING_AT,
    });

    expect(
      notifications.requests.map(({ publisher, at, events }) => ({
        publisher,
        at,
        count: events.length,
      })),
    ).toEqual([
      { publisher: 'tournament-year', at: EVENING_AT, count: 50 },
      { publisher: 'tournament-year', at: EVENING_AT, count: 50 },
    ]);
    expect(notifications.publishedEvents()).toEqual([
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
      at: EVENING_AT,
    });

    expect(notifications.requests).toEqual([]);
  });

  test('開始済みのマッチの予告1件だけを除いて残りを発行し、除いたマッチをinfoのログに残す', async () => {
    const started = matchIdOf(3);
    const { service, notifications } = createHarness(
      new Map([[previewKey(started), 'match-not-previewable']]),
    );

    await service.publishRound({
      decidedMatchIds: [matchIdOf(1)],
      previewMatchIds: idsOf(2, 3),
      at: EVENING_AT,
    });

    expect(notifications.requests.map(({ events }) => events.length)).toEqual([
      4, 3,
    ]);
    expect(notifications.recordedKeys()).toEqual(
      [
        resultKey(matchIdOf(1)),
        previewKey(matchIdOf(2)),
        previewKey(matchIdOf(4)),
      ].toSorted(),
    );
    expect(publisherLogs()).toEqual([
      expect.objectContaining({
        level: 'info',
        matchId: started,
        reason: 'match-not-previewable',
      }),
    ]);
  });

  test('一時的な失敗は除かずに呼び出し元へ返す', async () => {
    const { service, notifications } = createHarness();
    const failure = new Error('D1の一時的な失敗');
    notifications.failure = failure;

    await expect(
      service.publishRound({
        decidedMatchIds: [matchIdOf(1)],
        previewMatchIds: [],
        at: EVENING_AT,
      }),
    ).rejects.toBe(failure);
    expect(notifications.requests).toHaveLength(1);
    expect(publisherLogs()).toEqual([]);
  });
});

describe('YearTournamentNotificationPublisher.publishAward', () => {
  test('受賞をYearの賞の種類と対象年で発行する', async () => {
    const { service, notifications } = createHarness();

    await service.publishAward({
      year: 2027,
      productId: productIdOf(1),
      at: EVENING_AT,
    });

    expect(notifications.requests).toEqual([
      {
        publisher: 'tournament-year',
        at: EVENING_AT,
        events: [awardEventOf(2027, 1)],
      },
    ]);
  });

  test('同じ受賞を2回発行しても、2回目は重複として数えられる', async () => {
    const { service, notifications } = createHarness();
    const input = { year: 2027, productId: productIdOf(1), at: EVENING_AT };

    await service.publishAward(input);
    await service.publishAward(input);

    expect(notifications.recordedKeys()).toEqual([
      'award:product_of_the_year:2027:' + productIdOf(1),
    ]);
    expect(notifications.results).toEqual([
      { recorded: 1, duplicates: 0 },
      { recorded: 0, duplicates: 1 },
    ]);
  });
});

describe('YearTournamentNotificationPublisher.publishEvening', () => {
  test('その日のYearの確定したマッチの結果・翌日のYearの側が2つで開始前のマッチの予告・当日の0:00から発行の時刻までに記録した受賞を発行する', async () => {
    await seedEveningMatches();
    await seedEveningAwards();
    const { service, notifications } = createHarness();

    await service.publishEvening({ date: EVENING_DATE, at: EVENING_AT });

    expect(notifications.publishedEvents()).toEqual([
      { type: 'match_result', matchId: matchIdOf(1) },
      { type: 'match_result', matchId: matchIdOf(2) },
      { type: 'match_result', matchId: matchIdOf(3) },
      { type: 'match_preview', matchId: matchIdOf(7) },
      { type: 'match_preview', matchId: matchIdOf(8) },
      awardEventOf(2025, 2),
      awardEventOf(2027, 3),
    ]);
    expect(
      notifications.requests.every(
        ({ publisher, at }) =>
          publisher === 'tournament-year' && at === EVENING_AT,
      ),
    ).toBe(true);
  });

  test('前年12月の組み合わせ決定の夜に参加1で記録した受賞を、翌年の対象年で発行する', async () => {
    const drawDate = JANUARY_FINAL_SCHEDULE.deadlineDate;
    const at = eveningAtOf(drawDate);
    await insertYearTournaments([
      awardedYear(
        1,
        2028,
        new Date(JANUARY_FINAL_SCHEDULE.drawAt.getTime() + 10_000),
        { ...scheduleColumnsOf(JANUARY_FINAL_SCHEDULE), participantCount: 1 },
      ),
    ]);
    await insertYearEntries([championEntryOf(1, 2028)]);
    const { service, notifications } = createHarness();

    await service.publishEvening({
      date: drawDate,
      at: new Date(at.getTime() + 30_000),
    });

    expect(drawDate).toBe('2027-12-27');
    expect(notifications.publishedEvents()).toEqual([awardEventOf(2028, 1)]);
  });

  test('ラウンドの遅れで翌年の夜に記録した受賞を、遅れた年の対象年で決勝の結果とともに発行する', async () => {
    const at = eveningAtOf(LATE_FINAL_DATE);
    await insertMatches([
      matchOn(1, LATE_FINAL_DATE, { ...decidedOn(LATE_FINAL_DATE), round: 6 }),
    ]);
    await insertYearTournaments([
      awardedYear(1, 2026, new Date(at.getTime() - 120_000)),
    ]);
    await insertYearEntries([championEntryOf(1, 2026)]);
    const { service, notifications } = createHarness();

    await service.publishEvening({ date: LATE_FINAL_DATE, at });

    expect(notifications.publishedEvents()).toEqual([
      { type: 'match_result', matchId: matchIdOf(1) },
      awardEventOf(2026, 1),
    ]);
  });

  test('物理削除で優勝の枠の紐付けを解除した受賞は発行しない', async () => {
    await seedEveningAwards();
    await unlinkEntry(3);
    const { service, notifications } = createHarness();

    await service.publishEvening({ date: EVENING_DATE, at: EVENING_AT });

    expect(notifications.publishedEvents()).toEqual([awardEventOf(2025, 2)]);
  });

  test('Yearのマッチも受賞も無い夜は、他の種類のマッチがあっても発行の口を呼ばない', async () => {
    await insertMatches([
      matchOn(5, EVENING_DATE, { ...DECIDED, kind: 'week' }),
      matchOn(6, EVENING_DATE, { ...DECIDED, kind: 'qualifier', round: null }),
      matchOn(10, NEXT_DATE, { kind: 'week' }),
    ]);
    await insertYearTournaments([
      awardedYear(1, 2024, new Date(START_OF_EVENING_DATE.getTime() - 1)),
    ]);
    await insertYearEntries([championEntryOf(1, 2024)]);
    const { service, notifications } = createHarness();

    await service.publishEvening({ date: EVENING_DATE, at: EVENING_AT });

    expect(notifications.requests).toEqual([]);
  });

  test('開始済みの予告が1件混ざっても残りを発行し、同じ夜の発行を2回行っても記録は変わらず全て重複として数えられる', async () => {
    await seedEveningMatches();
    await seedEveningAwards();
    const { service, notifications } = createHarness(
      new Map([[previewKey(matchIdOf(8)), 'match-not-previewable']]),
    );

    await service.publishEvening({ date: EVENING_DATE, at: EVENING_AT });
    const first = notifications.recordedKeys();
    const firstResults = notifications.results.length;
    await service.publishEvening({ date: EVENING_DATE, at: EVENING_AT });

    expect(first).toEqual(
      [
        resultKey(matchIdOf(1)),
        resultKey(matchIdOf(2)),
        resultKey(matchIdOf(3)),
        previewKey(matchIdOf(7)),
        notificationEventDedupeKey(awardEventOf(2025, 2)),
        notificationEventDedupeKey(awardEventOf(2027, 3)),
      ].toSorted(),
    );
    expect(notifications.recordedKeys()).toEqual(first);
    expect(notifications.results.slice(firstResults)).toEqual([
      { recorded: 0, duplicates: 6 },
    ]);
    expect(publisherLogs()).toEqual([
      expect.objectContaining({
        level: 'info',
        matchId: matchIdOf(8),
        reason: 'match-not-previewable',
      }),
      expect.objectContaining({
        level: 'info',
        matchId: matchIdOf(8),
        reason: 'match-not-previewable',
      }),
    ]);
  });

  test('一時的な失敗は例外にする', async () => {
    await seedEveningMatches();
    const { service, notifications } = createHarness();
    const failure = new Error('D1の一時的な失敗');
    notifications.failure = failure;

    await expect(
      service.publishEvening({ date: EVENING_DATE, at: EVENING_AT }),
    ).rejects.toBe(failure);
  });
});
