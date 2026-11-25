import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  ModerationRecord,
  ModerationRecordStore,
} from '../../../../lib/core/moderation/ports.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import type {
  ModerationNoticeDispatch,
  ModerationNotifier,
} from '../moderation-notifier.ts';
import { MODERATION_TYPES } from '../moderation-types.ts';
import type {
  ModerationIncident,
  ModerationIncidentContext,
  ModerationIncidentReporter,
} from '../ports.ts';
import {
  MODERATION_MAINTENANCE_JOB_DEFINITION,
  MODERATION_NOTICE_REDISPATCH_LIMIT,
  MODERATION_RECORD_ERASE_BATCH_SIZE,
  MODERATION_RECORD_ERASE_MAX_BATCHES,
  ModerationMaintenanceJob,
  moderationRecordRetentionCutoff,
} from './moderation-maintenance-job.ts';

// 業務日付2026-11-20の業務時刻4:21
const SCHEDULED_TIME = new Date('2026-11-20T12:21:00.000Z');
const ONE_HOUR_BEFORE = new Date('2026-11-20T11:21:00.000Z');
const THREE_YEARS_BEFORE = new Date('2023-11-20T12:21:00.000Z');
const JOB_NAME = 'ugc-moderation.maintenance';

const CONTEXT: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: {
    date: parseBusinessDate('2026-11-20'),
    weekday: 5,
    hour: 4,
    minute: 21,
  },
};

function actionIdOf(index: number): string {
  return `01JQ0MDR${String(index).padStart(18, '0')}`;
}

function pendingRecordOf(index: number): ModerationRecord {
  return {
    id: actionIdOf(index),
    action: 'user.suspend',
    targetId: `01JQ0USR${String(index).padStart(18, '0')}`,
    subjectUserId: `01JQ0USR${String(index).padStart(18, '0')}`,
    productId: null,
    operatorAdminId: '01JQ0ADM000000000000000001',
    reason: '規約違反の投稿を繰り返したため',
    lifecycleEventId: null,
    occurredAt: new Date('2026-11-19T12:00:00.000Z'),
    noticeStatus: 'pending',
    noticeRequestedAt: null,
  };
}

interface ListPendingCall {
  readonly occurredBefore: Date;
  readonly limit: number;
}

interface EraseCall {
  readonly threshold: Date;
  readonly limit: number;
}

interface FakeOptions {
  readonly pending?: readonly ModerationRecord[];
  readonly dispatch?: (actionId: string) => Promise<ModerationNoticeDispatch>;
  readonly erasedCounts?: readonly number[];
  readonly listError?: Error;
  readonly eraseError?: Error;
}

function createJob(options: FakeOptions = {}) {
  const steps: string[] = [];
  const listCalls: ListPendingCall[] = [];
  const eraseCalls: EraseCall[] = [];
  const dispatched: string[] = [];
  const reports: {
    readonly incident: ModerationIncident;
    readonly context: ModerationIncidentContext;
  }[] = [];
  const erasedCounts = [...(options.erasedCounts ?? [0])];
  const store: Pick<
    ModerationRecordStore,
    'listPendingNotices' | 'eraseOccurredBefore'
  > = {
    listPendingNotices: (input) => {
      steps.push('list');
      listCalls.push(input);
      if (options.listError !== undefined) {
        return Promise.reject(options.listError);
      }
      return Promise.resolve(options.pending ?? []);
    },
    eraseOccurredBefore: (threshold, limit) => {
      steps.push('erase');
      eraseCalls.push({ threshold, limit });
      if (options.eraseError !== undefined) {
        return Promise.reject(options.eraseError);
      }
      return Promise.resolve(erasedCounts.shift() ?? 0);
    },
  };
  const notifier: ModerationNotifier = {
    dispatch: (actionId) => {
      steps.push(`dispatch:${actionId}`);
      dispatched.push(actionId);
      return (
        options.dispatch?.(actionId) ??
        Promise.resolve<ModerationNoticeDispatch>('requested')
      );
    },
  };
  const reporter: ModerationIncidentReporter = {
    report: (incident, context) => {
      steps.push(`report:${incident}`);
      reports.push({ incident, context });
    },
  };
  const job = new ModerationMaintenanceJob(
    store as ModerationRecordStore,
    notifier,
    reporter,
  );
  return { job, steps, listCalls, eraseCalls, dispatched, reports };
}

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

function moderationLogs() {
  return records
    .filter(
      (record) => record.category.join('.') === 'api.application.moderation',
    )
    .map(({ level, message, properties }) => ({
      level,
      message: message.join(''),
      properties,
    }));
}

describe('保守のジョブの定義', () => {
  test('4:21の起動でorder 1910に、保守のジョブの識別子を実行する', () => {
    expect(MODERATION_MAINTENANCE_JOB_DEFINITION).toEqual({
      name: JOB_NAME,
      at: { hour: 4, minute: 21 },
      order: 1910,
      handler: MODERATION_TYPES.ModerationMaintenanceJob,
    });
    expect(Object.isFrozen(MODERATION_MAINTENANCE_JOB_DEFINITION)).toBe(true);
    expect(Object.isFrozen(MODERATION_MAINTENANCE_JOB_DEFINITION.at)).toBe(
      true,
    );
  });

  test('送り直しは100件、記録の削除は500件ずつ最大10回である', () => {
    expect(MODERATION_NOTICE_REDISPATCH_LIMIT).toBe(100);
    expect(MODERATION_RECORD_ERASE_BATCH_SIZE).toBe(500);
    expect(MODERATION_RECORD_ERASE_MAX_BATCHES).toBe(10);
  });
});

describe('moderationRecordRetentionCutoff', () => {
  test.each([
    ['2026-11-20T12:21:00.000Z', '2023-11-20T12:21:00.000Z'],
    ['2028-02-29T12:21:00.000Z', '2025-02-28T12:21:00.000Z'],
    ['2027-03-01T12:21:00.000Z', '2024-03-01T12:21:00.000Z'],
    ['2026-01-01T00:00:00.000Z', '2023-01-01T00:00:00.000Z'],
  ])('実行時刻%sの3年前(UTCの暦の3年)は%sである', (scheduled, expected) => {
    expect(moderationRecordRetentionCutoff(new Date(scheduled))).toEqual(
      new Date(expected),
    );
  });
});

describe('ModerationMaintenanceJob', () => {
  test('実行時刻の1時間以上前の依頼待ちの通知を100件まで引き、1件ずつ送り直してから記録を削除する', async () => {
    const pending = [pendingRecordOf(1), pendingRecordOf(2)];
    const { job, steps, listCalls } = createJob({ pending });

    await job.run(CONTEXT);

    expect(listCalls).toEqual([
      {
        occurredBefore: ONE_HOUR_BEFORE,
        limit: MODERATION_NOTICE_REDISPATCH_LIMIT,
      },
    ]);
    expect(steps).toEqual([
      'list',
      `dispatch:${actionIdOf(1)}`,
      `dispatch:${actionIdOf(2)}`,
      'erase',
    ]);
  });

  test('送り直しが全て成功・送らなかった・依頼待ちでなかったときは定型の通知を送らず、結果ごとの件数をログに残す', async () => {
    const outcomes: Record<string, ModerationNoticeDispatch> = {
      [actionIdOf(1)]: 'requested',
      [actionIdOf(2)]: 'skipped',
      [actionIdOf(3)]: 'not-pending',
    };
    const { job, reports } = createJob({
      pending: [pendingRecordOf(1), pendingRecordOf(2), pendingRecordOf(3)],
      dispatch: (actionId) =>
        Promise.resolve(outcomes[actionId] ?? 'requested'),
    });

    await job.run(CONTEXT);

    expect(reports).toEqual([]);
    expect(moderationLogs()).toEqual([
      {
        level: 'info',
        message:
          '措置の通知を送り直し、保持期間を過ぎた措置の記録を削除しました',
        properties: {
          found: 3,
          requested: 1,
          skipped: 1,
          notPending: 1,
          failed: 0,
          erased: 0,
          batches: 1,
          limitReached: false,
        },
      },
    ]);
  });

  test('送り直しに失敗した通知があっても残りを送り、失敗の件数を定型の通知のポートへ送って、ジョブは成功で終える', async () => {
    const failure = new Error('Queueへの送信に失敗しました');
    const { job, dispatched, reports, steps } = createJob({
      pending: [pendingRecordOf(1), pendingRecordOf(2), pendingRecordOf(3)],
      dispatch: (actionId) =>
        actionId === actionIdOf(3)
          ? Promise.resolve('requested')
          : Promise.reject(failure),
    });

    await job.run(CONTEXT);

    expect(dispatched).toEqual([actionIdOf(1), actionIdOf(2), actionIdOf(3)]);
    expect(reports).toEqual([
      {
        incident: 'notice-redispatch-failed',
        context: { job: JOB_NAME, count: 2 },
      },
    ]);
    expect(steps.at(-1)).toBe('erase');
    const logs = moderationLogs();
    expect(logs.filter(({ level }) => level === 'warning')).toEqual([
      {
        level: 'warning',
        message: '措置の通知を送り直せませんでした',
        properties: { actionId: actionIdOf(1), error: failure },
      },
      {
        level: 'warning',
        message: '措置の通知を送り直せませんでした',
        properties: { actionId: actionIdOf(2), error: failure },
      },
    ]);
    expect(logs.at(-1)?.properties).toMatchObject({
      found: 3,
      requested: 1,
      failed: 2,
    });
  });

  test('依頼待ちの通知の一覧を引けないときも記録を削除し、一覧の例外を投げる', async () => {
    const failure = new Error('D1の読み取りに失敗しました');
    const { job, steps, reports } = createJob({
      listError: failure,
      erasedCounts: [3],
    });

    const error: unknown = await job
      .run(CONTEXT)
      .catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(steps).toEqual(['list', 'erase']);
    expect(reports).toEqual([]);
  });

  test('3年を過ぎた記録を500件ずつ削除し、500件に満たない回で終える', async () => {
    const { job, eraseCalls } = createJob({
      erasedCounts: [500, 500, 12],
    });

    await job.run(CONTEXT);

    expect(eraseCalls).toEqual([
      { threshold: THREE_YEARS_BEFORE, limit: 500 },
      { threshold: THREE_YEARS_BEFORE, limit: 500 },
      { threshold: THREE_YEARS_BEFORE, limit: 500 },
    ]);
    expect(moderationLogs().at(-1)?.properties).toMatchObject({
      erased: 1012,
      batches: 3,
      limitReached: false,
    });
  });

  test('毎回500件を削除しても10回で止め、残りを翌日の起動に任せる', async () => {
    const { job, eraseCalls } = createJob({
      erasedCounts: Array.from({ length: 12 }, () => 500),
    });

    await job.run(CONTEXT);

    expect(eraseCalls).toHaveLength(MODERATION_RECORD_ERASE_MAX_BATCHES);
    expect(moderationLogs().at(-1)?.properties).toMatchObject({
      erased: 5000,
      batches: 10,
      limitReached: true,
    });
  });

  test('ちょうど500件で削除が終わったときは、次の回の0件で終える', async () => {
    const { job, eraseCalls } = createJob({ erasedCounts: [500, 0] });

    await job.run(CONTEXT);

    expect(eraseCalls).toHaveLength(2);
    expect(moderationLogs().at(-1)?.properties).toMatchObject({
      erased: 500,
      batches: 2,
      limitReached: false,
    });
  });

  test('記録の削除に失敗したときは例外を投げ、定期実行の記録に失敗を任せる', async () => {
    const failure = new Error('D1の削除に失敗しました');
    const { job, reports } = createJob({ eraseError: failure });

    const error: unknown = await job
      .run(CONTEXT)
      .catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(reports).toEqual([]);
    expect(moderationLogs().filter(({ level }) => level === 'info')).toEqual(
      [],
    );
  });
});
