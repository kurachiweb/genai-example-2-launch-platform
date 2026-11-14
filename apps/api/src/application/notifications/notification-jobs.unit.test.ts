import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  eveningSlot,
  morningSlot,
} from '../../../lib/core/notifications/notification-slots.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  EveningDispatchJob,
  MorningDispatchJob,
  NOTIFICATION_CLEANUP_BATCH_SIZE,
  NOTIFICATION_CLEANUP_MAX_BATCHES,
  NOTIFICATION_EVENT_REDISPATCH_LIMIT,
  NOTIFICATION_SLOT_OVERDUE_LIMIT,
  NotificationMaintenanceJob,
} from './notification-jobs.ts';
import {
  type CallLog,
  createFakeMaintenanceStore,
  createFakeSlotStore,
  createRecordingEveningSlotOpener,
  createRecordingIncidentReporter,
  createRecordingWorkRequester,
  type FakeMaintenanceStoreOptions,
  type FakeSlotStoreOptions,
  fixedClock,
  jobContextOf,
  scheduledAt,
  storedSlotOf,
} from './testing/notification-job-fakes.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function notificationLogs() {
  return records
    .filter(
      (record) => record.category.join('.') === 'api.application.notifications',
    )
    .map(({ level, properties }) => ({ level, properties }));
}

const JOB_DATE = parseBusinessDate('2026-11-20');
const PREVIOUS_DATE = parseBusinessDate('2026-11-19');
const EVENING_TIME = { hour: 23, minute: 45 } as const;
const MIDNIGHT = { hour: 0, minute: 0 } as const;
const MAINTENANCE_TIME = { hour: 4, minute: 21 } as const;
const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

function eveningJobOf(now: Date, requested: boolean) {
  const log: CallLog = [];
  const opener = createRecordingEveningSlotOpener(log, requested);
  const job = new EveningDispatchJob(opener, fixedClock(now));
  return { job, log, opener };
}

function morningJobOf(now: Date) {
  const log: CallLog = [];
  const slots = createFakeSlotStore(log);
  const requester = createRecordingWorkRequester(log);
  const job = new MorningDispatchJob(slots, requester, fixedClock(now));
  return { job, log, slots, requester };
}

function maintenanceJobOf(
  now: Date,
  options: {
    readonly slots?: FakeSlotStoreOptions;
    readonly maintenance?: FakeMaintenanceStoreOptions;
  } = {},
) {
  const log: CallLog = [];
  const slots = createFakeSlotStore(log, options.slots);
  const maintenance = createFakeMaintenanceStore(log, options.maintenance);
  const requester = createRecordingWorkRequester(log);
  const reporter = createRecordingIncidentReporter(log);
  const job = new NotificationMaintenanceJob(
    slots,
    maintenance,
    requester,
    reporter,
    fixedClock(now),
  );
  return { job, log, slots, maintenance, requester, reporter };
}

const MAINTENANCE_AT = scheduledAt(JOB_DATE, MAINTENANCE_TIME);
const MAINTENANCE_NOW = new Date(MAINTENANCE_AT.getTime() + 7 * ONE_SECOND_MS);
const PREVIOUS_EVENING = eveningSlot(PREVIOUS_DATE);
const TODAY_MORNING = morningSlot(JOB_DATE);
const ALL_DONE: FakeSlotStoreOptions = {
  phases: { [PREVIOUS_EVENING.key]: 'done', [TODAY_MORNING.key]: 'done' },
};

describe('EveningDispatchJob(23:45)', () => {
  test('業務時刻23:45:00の予定時刻で、当日の業務日付の夜の枠を偽の時計の時刻で開く', async () => {
    const scheduled = scheduledAt(JOB_DATE, EVENING_TIME);
    const now = new Date(scheduled.getTime() + 12 * ONE_SECOND_MS);
    const { job, opener } = eveningJobOf(now, false);

    await job.run(jobContextOf(scheduled));

    expect(opener.calls).toEqual([{ date: JOB_DATE, at: now }]);
  });

  test('23:44:59の予定時刻でも同じ業務日付の夜の枠を開き、枠の日付は予定時刻の業務日付で決まる', async () => {
    const scheduled = scheduledAt(JOB_DATE, EVENING_TIME, -ONE_SECOND_MS);
    const now = scheduledAt(JOB_DATE, MIDNIGHT, ONE_DAY_MS);
    const { job, opener } = eveningJobOf(now, true);

    await job.run(jobContextOf(scheduled));

    expect(opener.calls).toEqual([{ date: JOB_DATE, at: now }]);
  });

  test.each([true, false])(
    '開いた結果(直ちに依頼したか=%p)をinfoのログに出す',
    async (requested) => {
      const scheduled = scheduledAt(JOB_DATE, EVENING_TIME);
      const { job } = eveningJobOf(scheduled, requested);

      await job.run(jobContextOf(scheduled));

      expect(notificationLogs()).toEqual([
        {
          level: 'info',
          properties: {
            slot: eveningSlot(JOB_DATE).key,
            requested,
          },
        },
      ]);
    },
  );
});

describe('MorningDispatchJob(0:00)', () => {
  test('0:00の予定時刻で当日の朝の枠を作り、遅らせずに送り出しを依頼する', async () => {
    const scheduled = scheduledAt(JOB_DATE, MIDNIGHT);
    const now = new Date(scheduled.getTime() + 3 * ONE_SECOND_MS);
    const { job, log, slots, requester } = morningJobOf(now);

    await job.run(jobContextOf(scheduled));

    expect(slots.ensured).toEqual([{ slot: morningSlot(JOB_DATE), at: now }]);
    expect(requester.flushes).toEqual([
      { slotKey: morningSlot(JOB_DATE).key, delaySeconds: 0 },
    ]);
    expect(log).toEqual([
      `ensure:${morningSlot(JOB_DATE).key}`,
      `flush:${morningSlot(JOB_DATE).key}`,
    ]);
    expect(notificationLogs()).toEqual([
      { level: 'info', properties: { slot: morningSlot(JOB_DATE).key } },
    ]);
  });

  test('23:59:59の予定時刻は前日の業務日付の朝の枠になる', async () => {
    const scheduled = scheduledAt(JOB_DATE, MIDNIGHT, -ONE_SECOND_MS);
    const { job, slots, requester } = morningJobOf(scheduled);

    await job.run(jobContextOf(scheduled));

    expect(slots.ensured.map(({ slot }) => slot)).toEqual([
      morningSlot(PREVIOUS_DATE),
    ]);
    expect(requester.flushes).toEqual([
      { slotKey: morningSlot(PREVIOUS_DATE).key, delaySeconds: 0 },
    ]);
  });
});

describe('NotificationMaintenanceJob(4:21)の前日の夜の枠と当日の朝の枠', () => {
  test('予定時刻の業務日付の前日の夜の枠と当日の朝の枠を偽の時計の時刻で作り、どちらも完了していなければ遅らせずに送り出しを依頼する', async () => {
    const { job, slots, requester } = maintenanceJobOf(MAINTENANCE_NOW);

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(slots.ensured).toEqual([
      { slot: PREVIOUS_EVENING, at: MAINTENANCE_NOW },
      { slot: TODAY_MORNING, at: MAINTENANCE_NOW },
    ]);
    expect(requester.flushes).toEqual([
      { slotKey: PREVIOUS_EVENING.key, delaySeconds: 0 },
      { slotKey: TODAY_MORNING.key, delaySeconds: 0 },
    ]);
  });

  test('完了した枠には送り出しを依頼しない', async () => {
    const { job, requester } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: { phases: { [PREVIOUS_EVENING.key]: 'done' } },
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(requester.flushes).toEqual([
      { slotKey: TODAY_MORNING.key, delaySeconds: 0 },
    ]);
  });

  test.each(['collecting', 'sending'] as const)(
    '途中の段(%s)の枠には送り出しを依頼する',
    async (phase) => {
      const { job, requester } = maintenanceJobOf(MAINTENANCE_NOW, {
        slots: {
          phases: {
            [PREVIOUS_EVENING.key]: phase,
            [TODAY_MORNING.key]: 'done',
          },
        },
      });

      await job.run(jobContextOf(MAINTENANCE_AT));

      expect(requester.flushes).toEqual([
        { slotKey: PREVIOUS_EVENING.key, delaySeconds: 0 },
      ]);
    },
  );
});

describe('NotificationMaintenanceJob(4:21)の遅れた枠', () => {
  const overdueSlot = storedSlotOf(
    eveningSlot(parseBusinessDate('2026-11-17')),
    'collecting',
  );
  const donePendingSlot = storedSlotOf(
    morningSlot(parseBusinessDate('2026-11-18')),
    'done',
  );

  test('1時間前より前が期限の未完了の枠と、1時間前より前に作った未送信の通知が残る完了の枠を50件ずつ探す', async () => {
    const { job, slots } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    const before = new Date(MAINTENANCE_NOW.getTime() - ONE_HOUR_MS);
    expect(NOTIFICATION_SLOT_OVERDUE_LIMIT).toBe(50);
    expect(slots.overdueQueries).toEqual([{ before, limit: 50 }]);
    expect(slots.doneWithPendingQueries).toEqual([{ before, limit: 50 }]);
  });

  test('見つかった枠へ遅らせずに送り出しを依頼し、枠ごとに遅れを異常の通知へ報告する', async () => {
    const { job, requester, reporter } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: {
        ...ALL_DONE,
        overdue: [overdueSlot],
        doneWithPending: [donePendingSlot],
      },
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(requester.flushes).toEqual([
      { slotKey: overdueSlot.key, delaySeconds: 0 },
      { slotKey: donePendingSlot.key, delaySeconds: 0 },
    ]);
    expect(reporter.incidents).toEqual([
      { kind: 'slot-overdue', slotKey: overdueSlot.key },
      { kind: 'slot-overdue', slotKey: donePendingSlot.key },
    ]);
  });

  test('前日の夜の枠と当日の朝の枠が遅れた枠にも含まれるとき、送り出しの依頼は1回にして遅れを報告する', async () => {
    const { job, requester, reporter } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: {
        phases: { [TODAY_MORNING.key]: 'done' },
        overdue: [storedSlotOf(PREVIOUS_EVENING, 'waiting')],
      },
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(requester.flushes).toEqual([
      { slotKey: PREVIOUS_EVENING.key, delaySeconds: 0 },
    ]);
    expect(reporter.incidents).toEqual([
      { kind: 'slot-overdue', slotKey: PREVIOUS_EVENING.key },
    ]);
  });

  test('遅れた枠が無ければ報告しない', async () => {
    const { job, requester, reporter } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(requester.flushes).toEqual([]);
    expect(reporter.incidents).toEqual([]);
  });
});

describe('NotificationMaintenanceJob(4:21)の滞った通知イベント', () => {
  const EVENT_A = '01JF0EVENT0000000000000001';
  const EVENT_B = '01JF0EVENT0000000000000002';
  const EVENT_C = '01JF0EVENT0000000000000003';

  test('最後の依頼から10分を過ぎて展開を終えていない通知イベントを100件まで探す', async () => {
    const { job, maintenance } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(NOTIFICATION_EVENT_REDISPATCH_LIMIT).toBe(100);
    expect(maintenance.staleQueries).toEqual([
      {
        dispatchedBefore: new Date(
          MAINTENANCE_NOW.getTime() - 10 * ONE_MINUTE_MS,
        ),
        limit: 100,
      },
    ]);
  });

  test('見つかった全ての通知イベントへ展開を依頼した後に依頼の回数を進め、今回が3回目以降(これまで2回以上)の通知イベントだけを報告する', async () => {
    const { job, log, maintenance, requester, reporter } = maintenanceJobOf(
      MAINTENANCE_NOW,
      {
        slots: ALL_DONE,
        maintenance: {
          staleEvents: [
            { eventId: EVENT_A, dispatchCount: 1 },
            { eventId: EVENT_B, dispatchCount: 2 },
            { eventId: EVENT_C, dispatchCount: 5 },
          ],
        },
      },
    );

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(requester.expansions).toEqual([EVENT_A, EVENT_B, EVENT_C]);
    expect(reporter.incidents).toEqual([
      { kind: 'event-stalled', eventId: EVENT_B },
      { kind: 'event-stalled', eventId: EVENT_C },
    ]);
    expect(maintenance.redispatched).toEqual([
      { eventIds: [EVENT_A, EVENT_B, EVENT_C], at: MAINTENANCE_NOW },
    ]);
    const stepsOfEvents = log.filter(
      (entry) =>
        entry === 'listStalePendingEvents' ||
        entry.startsWith('expand:') ||
        entry === 'markEventsRedispatched',
    );
    expect(stepsOfEvents).toEqual([
      'listStalePendingEvents',
      `expand:${EVENT_A}`,
      `expand:${EVENT_B}`,
      `expand:${EVENT_C}`,
      'markEventsRedispatched',
    ]);
  });

  test('滞った通知イベントが無ければ依頼も回数の更新も行わない', async () => {
    const { job, maintenance, requester } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(requester.expansions).toEqual([]);
    expect(maintenance.redispatched).toEqual([]);
  });
});

describe('NotificationMaintenanceJob(4:21)の期限切れと削除', () => {
  test('送信枠の期日から3日を過ぎた未送信の通知を、偽の時計の時刻で期限切れにする', async () => {
    const { job, maintenance } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(maintenance.expirations).toEqual([
      {
        dueBefore: new Date(MAINTENANCE_NOW.getTime() - 3 * ONE_DAY_MS),
        at: MAINTENANCE_NOW,
      },
    ]);
  });

  test('30日を過ぎた通知・枠・通知イベントを、それぞれ500件ずつ消し、500件未満の回で打ち切る', async () => {
    const { job, maintenance } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
      maintenance: {
        deletedNotices: [500, 500, 12],
        deletedSlots: [3],
        deletedEvents: [500, 0],
      },
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    const cutoff = new Date(MAINTENANCE_NOW.getTime() - 30 * ONE_DAY_MS);
    const call = { cutoff, limit: 500 };
    expect(NOTIFICATION_CLEANUP_BATCH_SIZE).toBe(500);
    expect(maintenance.noticeDeletions).toEqual([call, call, call]);
    expect(maintenance.slotDeletions).toEqual([call]);
    expect(maintenance.eventDeletions).toEqual([call, call]);
  });

  test('削除は1種類につき最大10回で打ち切り、残りは翌日の起動に任せる', async () => {
    const { job, maintenance } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
      maintenance: {
        deletedNotices: Array.from({ length: 11 }, () => 500),
        deletedSlots: Array.from({ length: 11 }, () => 500),
        deletedEvents: Array.from({ length: 11 }, () => 500),
      },
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(NOTIFICATION_CLEANUP_MAX_BATCHES).toBe(10);
    expect(maintenance.noticeDeletions).toHaveLength(10);
    expect(maintenance.slotDeletions).toHaveLength(10);
    expect(maintenance.eventDeletions).toHaveLength(10);
  });

  test('枠の確かめ・遅れた枠・滞った通知イベント・期限切れ・削除(通知→枠→通知イベント)の順に行い、件数をinfoのログに出す', async () => {
    const { job, log } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: {
        overdue: [
          storedSlotOf(eveningSlot(parseBusinessDate('2026-11-17')), 'waiting'),
        ],
      },
      maintenance: {
        staleEvents: [
          { eventId: '01JF0EVENT0000000000000001', dispatchCount: 2 },
        ],
        expired: 4,
        deletedNotices: [7],
        deletedSlots: [500, 2],
        deletedEvents: [1],
      },
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    const steps = log.filter(
      (entry) => !entry.startsWith('flush:') && !entry.startsWith('report:'),
    );
    expect(steps).toEqual([
      `ensure:${PREVIOUS_EVENING.key}`,
      `ensure:${TODAY_MORNING.key}`,
      'listOverdue',
      'listDoneWithPending',
      'listStalePendingEvents',
      'expand:01JF0EVENT0000000000000001',
      'markEventsRedispatched',
      'expirePending',
      'deleteSettledBefore',
      'deleteCompletedSlotsBefore',
      'deleteCompletedSlotsBefore',
      'deleteExpandedEventsBefore',
    ]);
    expect(notificationLogs()).toEqual([
      {
        level: 'info',
        properties: {
          requestedSlots: 3,
          overdueSlots: 1,
          redispatchedEvents: 1,
          stalledEvents: 1,
          expiredNotices: 4,
          deletedNotices: 7,
          deletedSlots: 502,
          deletedEvents: 1,
          cleanupLimitReached: false,
        },
      },
    ]);
  });

  test('いずれかの削除が最大の回数で打ち切られたら、打ち切りをログに出す', async () => {
    const { job } = maintenanceJobOf(MAINTENANCE_NOW, {
      slots: ALL_DONE,
      maintenance: {
        deletedEvents: Array.from({ length: 10 }, () => 500),
      },
    });

    await job.run(jobContextOf(MAINTENANCE_AT));

    expect(notificationLogs().map(({ properties }) => properties)).toEqual([
      expect.objectContaining({
        deletedEvents: 5000,
        cleanupLimitReached: true,
      }) as Record<string, unknown>,
    ]);
  });
});
