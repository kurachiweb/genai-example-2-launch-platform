import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import { SPONSORSHIP_TYPES } from '../sponsorship-types.ts';
import { sponsorshipRecordOf } from '../testing/sponsorship-application-fakes.ts';
import {
  createJobFakes,
  type JobFakeOptions,
  type JobStep,
  jobContextOf,
} from '../testing/sponsorship-job-fakes.ts';
import {
  displayStopRetentionCutoff,
  MaintenanceJob,
  SPONSORSHIP_DISPLAY_STOP_DELETE_LIMIT,
  SPONSORSHIP_MAINTENANCE_JOB_DEFINITION,
  SPONSORSHIP_UNPAID_DELETE_BATCH_SIZE,
  SPONSORSHIP_UNPAID_DELETE_MAX_BATCHES,
} from './maintenance-job.ts';

const TODAY = parseBusinessDate('2026-11-25');
const CONTEXT = jobContextOf(TODAY, { hour: 4, minute: 21 });
// 2026-11-25の400日前(2025-10-21)の基準時刻の0:00
const CUTOFF = new Date('2025-10-21T08:00:00.000Z');

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

function sponsorshipLogs() {
  return records
    .filter(
      (record) => record.category.join('.') === 'api.application.sponsorship',
    )
    .map(({ level, properties }) => ({ level, properties }));
}

function createJob(options: JobFakeOptions = {}) {
  const fakes = createJobFakes(options);
  return {
    ...fakes,
    job: new MaintenanceJob(
      fakes.store,
      fakes.scheduler,
      fakes.requester,
      fakes.displayStops,
    ),
  };
}

const ENDED_UNSETTLED = sponsorshipRecordOf({
  state: 'paid',
  startsOn: parseBusinessDate('2026-11-18'),
  endsOn: parseBusinessDate('2026-11-24'),
});

describe('スポンサー広告の4:21の日次の処理の定義', () => {
  test('名前sponsorship.maintenance・業務時刻4:21・順序1600で、ジョブの識別子を指す', () => {
    expect(SPONSORSHIP_MAINTENANCE_JOB_DEFINITION).toEqual({
      name: 'sponsorship.maintenance',
      at: { hour: 4, minute: 21 },
      order: 1600,
      handler: SPONSORSHIP_TYPES.MaintenanceJob,
    });
    expect(Object.isFrozen(SPONSORSHIP_MAINTENANCE_JOB_DEFINITION)).toBe(true);
  });

  test('未決済の削除は500件ずつ最大20回、表示停止の区間の削除は500件まで', () => {
    expect(SPONSORSHIP_UNPAID_DELETE_BATCH_SIZE).toBe(500);
    expect(SPONSORSHIP_UNPAID_DELETE_MAX_BATCHES).toBe(20);
    expect(SPONSORSHIP_DISPLAY_STOP_DELETE_LIMIT).toBe(500);
  });

  test('表示停止の区間を消す境界は、予定時刻の業務日付の400日前の基準時刻の0:00', () => {
    expect(displayStopRetentionCutoff(TODAY)).toEqual(CUTOFF);
  });
});

describe('スポンサー広告の4:21の日次の処理', () => {
  test('未決済の削除・精算の依頼・依頼待ちの記録・区間の削除・送信の依頼の順に、予定時刻の業務日付で行う', async () => {
    const { job, calls } = createJob({
      deletedUnpaidCounts: [3],
      unsettled: [ENDED_UNSETTLED],
      pending: true,
      deletedDisplayStops: 2,
    });

    await job.run(CONTEXT);

    expect(calls).toEqual([
      { kind: 'deleteExpiredUnpaid', today: TODAY, limit: 500 },
      { kind: 'listUnsettledEnded', today: TODAY, limit: 1 },
      { kind: 'requestSettlement' },
      { kind: 'markDue', today: TODAY },
      { kind: 'deleteEndedBefore', cutoff: CUTOFF, limit: 500 },
      { kind: 'hasPending' },
      { kind: 'request' },
    ]);
    expect(sponsorshipLogs()).toEqual([
      {
        level: 'info',
        properties: {
          deletedUnpaid: 3,
          unpaidLimitReached: false,
          settlementRequested: true,
          deletedDisplayStops: 2,
          noticesRequested: true,
        },
      },
    ]);
  });

  test('未精算の終了した広告と依頼待ちの通知が無ければ、精算も送信も依頼しない', async () => {
    const { job, calls } = createJob();

    await job.run(CONTEXT);

    expect(calls.map(({ kind }) => kind)).toEqual([
      'deleteExpiredUnpaid',
      'listUnsettledEnded',
      'markDue',
      'deleteEndedBefore',
      'hasPending',
    ]);
    expect(sponsorshipLogs()[0]?.properties).toMatchObject({
      settlementRequested: false,
      noticesRequested: false,
    });
  });

  test('未決済の削除は、1回の件数が上限に満たなくなるまで繰り返す', async () => {
    const { job, calls } = createJob({ deletedUnpaidCounts: [500, 500, 7] });

    await job.run(CONTEXT);

    expect(
      calls.filter(({ kind }) => kind === 'deleteExpiredUnpaid'),
    ).toHaveLength(3);
    expect(sponsorshipLogs()[0]?.properties).toMatchObject({
      deletedUnpaid: 1007,
      unpaidLimitReached: false,
    });
  });

  test('未決済の削除は20回で打ち切り、残りは翌日の起動に任せる', async () => {
    const { job, calls } = createJob({
      deletedUnpaidCounts: Array.from({ length: 25 }, () => 500),
    });

    await job.run(CONTEXT);

    expect(
      calls.filter(({ kind }) => kind === 'deleteExpiredUnpaid'),
    ).toHaveLength(20);
    expect(sponsorshipLogs()[0]?.properties).toMatchObject({
      deletedUnpaid: 10_000,
      unpaidLimitReached: true,
    });
  });

  test.each<[JobStep, readonly JobStep[]]>([
    ['deleteExpiredUnpaid', ['deleteExpiredUnpaid']],
    ['listUnsettledEnded', ['deleteExpiredUnpaid', 'listUnsettledEnded']],
    [
      'requestSettlement',
      ['deleteExpiredUnpaid', 'listUnsettledEnded', 'requestSettlement'],
    ],
    [
      'markDue',
      [
        'deleteExpiredUnpaid',
        'listUnsettledEnded',
        'requestSettlement',
        'markDue',
      ],
    ],
    [
      'deleteEndedBefore',
      [
        'deleteExpiredUnpaid',
        'listUnsettledEnded',
        'requestSettlement',
        'markDue',
        'deleteEndedBefore',
      ],
    ],
    [
      'hasPending',
      [
        'deleteExpiredUnpaid',
        'listUnsettledEnded',
        'requestSettlement',
        'markDue',
        'deleteEndedBefore',
        'hasPending',
      ],
    ],
    [
      'request',
      [
        'deleteExpiredUnpaid',
        'listUnsettledEnded',
        'requestSettlement',
        'markDue',
        'deleteEndedBefore',
        'hasPending',
        'request',
      ],
    ],
  ])(
    '%sの例外をそのまま投げ、後の手順を行わず要約のログを出さない',
    async (failing, expected) => {
      const failure = new Error(`${failing}に失敗しました`);
      const { job, calls } = createJob({
        deletedUnpaidCounts: [1],
        unsettled: [ENDED_UNSETTLED],
        pending: true,
        failures: { [failing]: failure },
      });

      const error = await job.run(CONTEXT).then(
        () => undefined,
        (rejected: unknown) => rejected,
      );

      expect(error).toBe(failure);
      expect(calls.map(({ kind }) => kind)).toEqual([...expected]);
      expect(sponsorshipLogs()).toEqual([]);
    },
  );
});
