import { describe, expect, test } from 'bun:test';

import { SPONSORSHIP_DAILY_NOTICES_TIME } from '../../../../lib/core/sponsorship/notice-schedule.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import { SPONSORSHIP_TYPES } from '../sponsorship-types.ts';
import {
  createJobFakes,
  type JobFakeOptions,
  type JobStep,
  jobContextOf,
} from '../testing/sponsorship-job-fakes.ts';
import {
  DailyNoticesJob,
  SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION,
} from './daily-notices-job.ts';

const TODAY = parseBusinessDate('2026-11-25');
const CONTEXT = jobContextOf(TODAY, { hour: 0, minute: 7 });

function createJob(options: JobFakeOptions = {}) {
  const fakes = createJobFakes(options);
  return {
    ...fakes,
    job: new DailyNoticesJob(fakes.scheduler, fakes.requester),
  };
}

describe('スポンサー広告の0:07の通知のジョブの定義', () => {
  test('名前sponsorship.daily-notices・業務時刻0:07・順序1600で、ジョブの識別子を指す', () => {
    expect(SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION).toEqual({
      name: 'sponsorship.daily-notices',
      at: { hour: 0, minute: 7 },
      order: 1600,
      handler: SPONSORSHIP_TYPES.DailyNoticesJob,
    });
    expect(SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION.at).toBe(
      SPONSORSHIP_DAILY_NOTICES_TIME,
    );
    expect(Object.isFrozen(SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION)).toBe(
      true,
    );
  });
});

describe('スポンサー広告の0:07の通知のジョブ', () => {
  test('予定時刻の業務日付で開始・終了の通知を依頼待ちにし、送信を依頼してから精算を依頼する', async () => {
    const { job, calls } = createJob();

    await job.run(CONTEXT);

    expect(calls).toEqual([
      { kind: 'markDue', today: TODAY },
      { kind: 'request' },
      { kind: 'requestSettlement' },
    ]);
  });

  test('精算は自分で行わず、申込の照会・未決済の削除・表示停止の区間の削除をしない', async () => {
    const { job, calls } = createJob();

    await job.run(CONTEXT);

    expect(
      calls.filter(
        ({ kind }) =>
          kind === 'listUnsettledEnded' ||
          kind === 'deleteExpiredUnpaid' ||
          kind === 'deleteEndedBefore' ||
          kind === 'hasPending',
      ),
    ).toEqual([]);
  });

  test.each<[JobStep, readonly JobStep[]]>([
    ['markDue', ['markDue']],
    ['request', ['markDue', 'request']],
    ['requestSettlement', ['markDue', 'request', 'requestSettlement']],
  ])(
    '%sの例外をそのまま投げ、後の手順を行わない',
    async (failing, expected) => {
      const failure = new Error(`${failing}に失敗しました`);
      const { job, calls } = createJob({ failures: { [failing]: failure } });

      const error = await job.run(CONTEXT).then(
        () => undefined,
        (rejected: unknown) => rejected,
      );

      expect(error).toBe(failure);
      expect(calls.map(({ kind }) => kind)).toEqual([...expected]);
    },
  );
});
