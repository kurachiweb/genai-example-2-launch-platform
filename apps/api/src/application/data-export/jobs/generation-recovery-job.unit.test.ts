import { describe, expect, test } from 'bun:test';

import { GENERATION_STALL_SECONDS } from '../../../../lib/core/data-export/data-export-messages.ts';
import type {
  DataExportIncident,
  DataExportNotifier,
  DataExportRecord,
  DataExportStore,
  DataExportTerminator,
} from '../../../../lib/core/data-export/ports.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import { NOW, recordOf } from '../testing/data-export-request-fakes.ts';
import {
  GENERATION_RECOVERY_JOB_DEFINITION,
  GenerationRecoveryJob,
} from './generation-recovery-job.ts';

const CONTEXT: ScheduledJobContext = {
  scheduledTime: NOW,
  cron: '21 12 * * *',
  business: toBusinessDateTime(NOW),
};

const HOUR_MS = 3_600_000;

const ID_1 = '01JE0DXEXPT000000000000001';
const ID_2 = '01JE0DXEXPT000000000000002';

interface Scenario {
  readonly stalled?: readonly DataExportRecord[];
  readonly pending?: readonly DataExportRecord[];
  readonly terminateOutcomes?: Readonly<
    Record<string, 'failed' | 'already_finished' | Error>
  >;
  readonly failNotifies?: readonly string[];
}

function harnessOf(scenario: Scenario) {
  const terminated: { id: string; kind: string; now: Date; notify: boolean }[] =
    [];
  const notified: string[] = [];
  const incidents: DataExportIncident[] = [];
  const calls: { requestedBefore?: Date; updatedBefore?: Date }[] = [];
  const store = {
    listStalled: (input: { requestedBefore: Date; limit: number }) => {
      calls.push({ requestedBefore: input.requestedBefore });
      return Promise.resolve(
        (scenario.stalled ?? [])
          .filter(
            ({ id }) =>
              scenario.terminateOutcomes?.[id] instanceof Error ||
              !terminated.some((t) => t.id === id),
          )
          .slice(0, input.limit),
      );
    },
    listPendingNotices: (input: { updatedBefore: Date; limit: number }) => {
      calls.push({ updatedBefore: input.updatedBefore });
      return Promise.resolve(
        (scenario.pending ?? [])
          .filter(
            ({ id }) =>
              scenario.failNotifies?.includes(id) || !notified.includes(id),
          )
          .slice(0, input.limit),
      );
    },
  } as unknown as DataExportStore;
  const terminator: DataExportTerminator = {
    fail: (input) => {
      terminated.push({
        id: input.exportId,
        kind: input.kind,
        now: input.now,
        notify: input.notify,
      });
      const outcome = scenario.terminateOutcomes?.[input.exportId] ?? 'failed';
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
  };
  const notifier: DataExportNotifier = {
    notify: (id) => {
      notified.push(id);
      return scenario.failNotifies?.includes(id)
        ? Promise.reject(new Error('Queueの障害'))
        : Promise.resolve('requested');
    },
  };
  const job = new GenerationRecoveryJob(store, terminator, notifier, {
    report: (incident) => {
      incidents.push(incident);
    },
  });
  return { job, terminated, notified, incidents, calls };
}

const stalledOf = (id: string): DataExportRecord =>
  recordOf({ id, status: 'generating' });

const pendingOf = (id: string): DataExportRecord =>
  recordOf({ id, status: 'failed', noticeStatus: 'pending' });

describe('GenerationRecoveryJob', () => {
  test('定義は4:21に2110の順で、基準の時刻より前に要求された未完了の要求を通知付きで失敗にして運用者へ知らせる', async () => {
    const harness = harnessOf({ stalled: [stalledOf(ID_1), stalledOf(ID_2)] });

    await harness.job.run(CONTEXT);

    expect(GENERATION_RECOVERY_JOB_DEFINITION).toMatchObject({
      name: 'data-export.generation-recovery',
      at: { hour: 4, minute: 21 },
      order: 2110,
    });
    expect(harness.calls[0]?.requestedBefore).toEqual(
      new Date(NOW.getTime() - GENERATION_STALL_SECONDS * 1000),
    );
    expect(harness.terminated).toEqual([
      { id: ID_1, kind: 'error', now: NOW, notify: true },
      { id: ID_2, kind: 'error', now: NOW, notify: true },
    ]);
    expect(harness.incidents).toEqual([
      { kind: 'generation-abandoned', exportId: ID_1, by: 'recovery' },
      { kind: 'generation-abandoned', exportId: ID_2, by: 'recovery' },
    ]);
  });

  test('既に確定していた要求は運用者へ知らせず、確定から1時間以上の依頼待ちの通知を送り直す', async () => {
    const harness = harnessOf({
      stalled: [stalledOf(ID_1)],
      pending: [pendingOf(ID_2)],
      terminateOutcomes: { [ID_1]: 'already_finished' },
    });

    await harness.job.run(CONTEXT);

    expect(harness.incidents).toEqual([]);
    expect(harness.notified).toEqual([ID_2]);
    expect(harness.calls[1]?.updatedBefore).toEqual(
      new Date(NOW.getTime() - HOUR_MS),
    );
  });

  test('通知の送り直しに失敗しても例外にせず、失敗の件数を運用者へ知らせる', async () => {
    const harness = harnessOf({
      pending: [pendingOf(ID_1), pendingOf(ID_2)],
      failNotifies: [ID_1],
    });

    await harness.job.run(CONTEXT);

    expect(harness.notified.toSorted()).toEqual([ID_1, ID_2]);
    expect(harness.incidents).toEqual([
      { kind: 'notice-redispatch-failed', count: 1 },
    ]);
  });

  test('失敗として確定できなかった要求があれば、通知の送り直しまで終えた後に例外を投げる', async () => {
    const harness = harnessOf({
      stalled: [stalledOf(ID_1)],
      pending: [pendingOf(ID_2)],
      terminateOutcomes: { [ID_1]: new Error('D1の障害') },
    });

    const failure = await harness.job.run(CONTEXT).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      '失敗として確定できなかった要求があります',
    );

    expect(harness.notified).toEqual([ID_2]);
    expect(harness.incidents).toEqual([]);
  });

  test('対象が無ければ何もせず、何も知らせない', async () => {
    const harness = harnessOf({});

    await harness.job.run(CONTEXT);

    expect(harness.terminated).toEqual([]);
    expect(harness.notified).toEqual([]);
    expect(harness.incidents).toEqual([]);
  });
});
