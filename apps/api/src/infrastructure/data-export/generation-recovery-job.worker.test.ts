import { beforeEach, describe, expect, test } from 'vitest';

import type {
  DataExportIncident,
  DataExportIncidentReporter,
  DataExportNotifier,
  DataExportStore,
  DataExportTerminator,
  ExportArchiveStorage,
} from '../../../lib/core/data-export/ports.ts';
import type { ScheduledJobContext } from '../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import { D1DataExportStore } from '../../../lib/workers/data-export/d1-data-export-store.ts';
import { StoreDataExportTerminator } from '../../../lib/workers/data-export/data-export-terminator.ts';
import {
  clearDataExportState,
  db,
  exportIdOf,
  expiredColumnsOf,
  failedColumnsOf,
  insertUsers,
  queuedRowOf,
  readyColumnsOf,
  seed,
  type ExportRow,
} from '../../../lib/workers/data-export/testing/data-export-fixtures.ts';
import {
  GENERATION_RECOVERY_JOB_DEFINITION,
  GenerationRecoveryJob,
} from '../../application/data-export/jobs/generation-recovery-job.ts';

// 業務日付2026-11-22の業務時刻4:21
const SCHEDULED_TIME = new Date('2026-11-22T12:21:00.000Z');

const HOUR_MS = 60 * 60 * 1000;

const OWNER = 1;

const context: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: toBusinessDateTime(SCHEDULED_TIME),
};

const store: DataExportStore = new D1DataExportStore(db);

const keyOf = (index: number): string =>
  `data-exports/${exportIdOf(index)}.zip`;

const beforeNow = (milliseconds: number): Date =>
  new Date(SCHEDULED_TIME.getTime() - milliseconds);

const STALL_MS = 3 * HOUR_MS;

const pendingRow = (
  index: number,
  requestedAt: Date,
  columns: Partial<ExportRow> = {},
) =>
  queuedRowOf(index, OWNER, {
    requestedAt,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    ...columns,
  });

const pendingNoticeRow = (index: number, updatedAt: Date) =>
  queuedRowOf(index, OWNER, {
    ...failedColumnsOf(),
    failedAt: updatedAt,
    noticeStatus: 'pending',
    requestedAt: beforeNow(24 * HOUR_MS),
    updatedAt,
  });

class RecordingIncidentReporter implements DataExportIncidentReporter {
  readonly incidents: DataExportIncident[] = [];

  report(incident: DataExportIncident): void {
    this.incidents.push(incident);
  }
}

interface RecordingNotifier {
  readonly notifier: DataExportNotifier;
  readonly notified: string[];
}

// 依頼待ちの通知を依頼済みへ進める本物の通知の部品と同じ記録の変化を、メールを送らずに再現する
function createNotifier(
  failIndexes: readonly number[] = [],
): RecordingNotifier {
  const notified: string[] = [];
  const failing = new Set(failIndexes.map(exportIdOf));
  return {
    notified,
    notifier: {
      notify: async (exportId) => {
        notified.push(exportId);
        if (failing.has(exportId)) {
          throw new Error('メールを依頼できません');
        }
        const advanced = await store.advanceNotice({
          id: exportId,
          to: 'requested',
        });
        return advanced ? 'requested' : 'not_pending';
      },
    },
  };
}

interface RecordingStorage {
  readonly storage: ExportArchiveStorage;
  readonly aborted: string[];
}

function createStorage(): RecordingStorage {
  const aborted: string[] = [];
  const unused = () => Promise.reject(new Error('使わない操作'));
  return {
    aborted,
    storage: {
      objectKeyOf: (exportId) => `data-exports/${exportId}.zip`,
      beginUpload: unused,
      open: unused,
      delete: unused,
      abortUpload: (objectKey) => {
        aborted.push(objectKey);
        return Promise.resolve();
      },
    },
  };
}

interface Rig {
  readonly job: GenerationRecoveryJob;
  readonly notifier: RecordingNotifier;
  readonly storage: RecordingStorage;
  readonly reporter: RecordingIncidentReporter;
}

function createRig(
  options: {
    readonly notifyFailures?: readonly number[];
    readonly terminator?: (real: DataExportTerminator) => DataExportTerminator;
  } = {},
): Rig {
  const notifier = createNotifier(options.notifyFailures);
  const storage = createStorage();
  const reporter = new RecordingIncidentReporter();
  const real = new StoreDataExportTerminator(
    store,
    storage.storage,
    notifier.notifier,
    'api',
  );
  return {
    job: new GenerationRecoveryJob(
      store,
      options.terminator?.(real) ?? real,
      notifier.notifier,
      reporter,
    ),
    notifier,
    storage,
    reporter,
  };
}

beforeEach(async () => {
  await clearDataExportState();
  await insertUsers([OWNER]);
});

describe('GenerationRecoveryJobの定義', () => {
  test('業務時刻4:21の起動に、順序2110で登録する名前の定義を持つ', () => {
    expect(GENERATION_RECOVERY_JOB_DEFINITION).toMatchObject({
      name: 'data-export.generation-recovery',
      at: { hour: 4, minute: 21 },
      order: 2110,
    });
  });
});

describe('GenerationRecoveryJob(3時間を過ぎた作成中の失敗の確定)', () => {
  test('要求から3時間を過ぎた作成中の記録を、確定した時刻を予定時刻にして失敗にし、通知を依頼して1件ごとに警告を渡す', async () => {
    await seed([
      pendingRow(1, beforeNow(STALL_MS + 1)),
      pendingRow(2, beforeNow(STALL_MS + 2), {
        status: 'generating',
        runToken: 'run-token',
        leaseExpiresAt: beforeNow(HOUR_MS),
      }),
    ]);
    const { job, notifier, reporter } = createRig();

    await job.run(context);

    for (const index of [1, 2]) {
      expect(await store.find(exportIdOf(index))).toMatchObject({
        status: 'failed',
        failureKind: 'error',
        failedAt: SCHEDULED_TIME,
        noticeStatus: 'requested',
      });
    }
    expect(notifier.notified.toSorted()).toEqual([
      exportIdOf(1),
      exportIdOf(2),
    ]);
    expect(reporter.incidents).toEqual([
      { kind: 'generation-abandoned', exportId: exportIdOf(2), by: 'recovery' },
      { kind: 'generation-abandoned', exportId: exportIdOf(1), by: 'recovery' },
    ]);
  });

  test('要求から3時間に満たない作成中の記録と、完了・失敗・期限切れの記録は変えない', async () => {
    await seed([
      pendingRow(1, beforeNow(STALL_MS)),
      pendingRow(2, beforeNow(HOUR_MS), { status: 'generating' }),
      queuedRowOf(3, OWNER, {
        ...readyColumnsOf(beforeNow(-HOUR_MS)),
        requestedAt: beforeNow(2 * STALL_MS),
        noticeStatus: 'requested',
      }),
      queuedRowOf(4, OWNER, {
        ...failedColumnsOf(),
        requestedAt: beforeNow(2 * STALL_MS),
      }),
      queuedRowOf(5, OWNER, {
        ...expiredColumnsOf(),
        requestedAt: beforeNow(2 * STALL_MS),
      }),
    ]);
    const before = await Promise.all(
      [1, 2, 3, 4, 5].map((index) => store.find(exportIdOf(index))),
    );
    const { job, notifier, reporter } = createRig();

    await job.run(context);

    expect(
      await Promise.all(
        [1, 2, 3, 4, 5].map((index) => store.find(exportIdOf(index))),
      ),
    ).toEqual(before);
    expect(notifier.notified).toEqual([]);
    expect(reporter.incidents).toEqual([]);
  });

  test('未完了のアップロードを持つ記録は、失敗の確定でアップロードを破棄する', async () => {
    await seed([
      pendingRow(1, beforeNow(STALL_MS + 1), {
        status: 'generating',
        uploadId: 'multipart-upload-1',
        objectKey: keyOf(1),
      }),
    ]);
    const { job, storage } = createRig();

    await job.run(context);

    expect(storage.aborted).toEqual([keyOf(1)]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'failed',
    });
  });

  test('確定の直前に別の経路で終わっていた記録は警告を渡さない', async () => {
    await seed([pendingRow(1, beforeNow(STALL_MS + 1))]);
    const { job, reporter } = createRig({
      terminator: () => ({ fail: () => Promise.resolve('already_finished') }),
    });

    await job.run(context);

    expect(reporter.incidents).toEqual([]);
  });

  test('失敗の確定を100件ずつ最大10回まで行い、残りを翌日の起動に任せる', async () => {
    await seed(
      Array.from({ length: 1001 }, (_, index) =>
        pendingRow(index + 1, beforeNow(STALL_MS + 5000 - index)),
      ),
    );
    const limits: number[] = [];
    const recording: DataExportStore = new Proxy(store, {
      get: (target, property, receiver) => {
        if (property === 'listStalled') {
          return (input: Parameters<DataExportStore['listStalled']>[0]) => {
            limits.push(input.limit);
            return target.listStalled(input);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const reporter = new RecordingIncidentReporter();
    const failed: string[] = [];
    const job = new GenerationRecoveryJob(
      recording,
      {
        fail: async ({ exportId, kind, now }) => {
          failed.push(exportId);
          await store.markFailed({
            id: exportId,
            kind,
            failedAt: now,
            notice: 'skipped',
          });
          return 'failed';
        },
      },
      createNotifier().notifier,
      reporter,
    );

    await job.run(context);

    expect(limits.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 100));
    expect(failed).toHaveLength(1000);
    expect(await store.find(exportIdOf(1001))).toMatchObject({
      status: 'queued',
    });
  });

  test('1件の確定が例外で失敗しても、残りの記録と通知の送り直しを続けた後に、失敗を例外として投げる', async () => {
    await seed([
      pendingRow(1, beforeNow(STALL_MS + 3)),
      pendingRow(2, beforeNow(STALL_MS + 2)),
      pendingNoticeRow(3, beforeNow(2 * HOUR_MS)),
    ]);
    const { job, notifier, reporter } = createRig({
      terminator: (real) => ({
        fail: (input) =>
          input.exportId === exportIdOf(1)
            ? Promise.reject(new Error('D1に接続できません'))
            : real.fail(input),
      }),
    });

    await expect(job.run(context)).rejects.toThrow(
      '失敗として確定できなかった要求があります',
    );

    expect(await store.find(exportIdOf(1))).toMatchObject({ status: 'queued' });
    expect(await store.find(exportIdOf(2))).toMatchObject({ status: 'failed' });
    expect(notifier.notified).toContain(exportIdOf(3));
    expect(reporter.incidents).toEqual([
      { kind: 'generation-abandoned', exportId: exportIdOf(2), by: 'recovery' },
    ]);
  });
});

describe('GenerationRecoveryJob(依頼待ちの通知の送り直し)', () => {
  test('確定から1時間を過ぎた依頼待ちの通知を送り直し、1時間に満たないものは送らない', async () => {
    await seed([
      pendingNoticeRow(1, beforeNow(HOUR_MS + 1)),
      pendingNoticeRow(2, beforeNow(HOUR_MS)),
      pendingNoticeRow(3, beforeNow(HOUR_MS - 1)),
      pendingNoticeRow(4, beforeNow(5 * HOUR_MS)),
    ]);
    const { job, notifier, reporter } = createRig();

    await job.run(context);

    expect(notifier.notified.toSorted()).toEqual([
      exportIdOf(1),
      exportIdOf(4),
    ]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      noticeStatus: 'requested',
    });
    expect(await store.find(exportIdOf(2))).toMatchObject({
      noticeStatus: 'pending',
    });
    expect(await store.find(exportIdOf(3))).toMatchObject({
      noticeStatus: 'pending',
    });
    expect(reporter.incidents).toEqual([]);
  });

  test('送り直しが失敗した通知は依頼待ちのまま残して次へ進み、失敗した件数を1回だけエラートラッキングへ渡す', async () => {
    await seed([
      pendingNoticeRow(1, beforeNow(5 * HOUR_MS)),
      pendingNoticeRow(2, beforeNow(4 * HOUR_MS)),
      pendingNoticeRow(3, beforeNow(3 * HOUR_MS)),
    ]);
    const { job, notifier, reporter } = createRig({ notifyFailures: [1, 2] });

    await job.run(context);

    expect(notifier.notified).toEqual([
      exportIdOf(1),
      exportIdOf(2),
      exportIdOf(3),
    ]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      noticeStatus: 'pending',
    });
    expect(await store.find(exportIdOf(2))).toMatchObject({
      noticeStatus: 'pending',
    });
    expect(await store.find(exportIdOf(3))).toMatchObject({
      noticeStatus: 'requested',
    });
    expect(reporter.incidents).toEqual([
      { kind: 'notice-redispatch-failed', count: 2 },
    ]);
  });

  test('送り直しの失敗で読み取りの先頭が埋まっても、同じ起動の後ろの通知を送り直す', async () => {
    await seed([
      ...Array.from({ length: 100 }, (_, index) =>
        pendingNoticeRow(index + 1, beforeNow(48 * HOUR_MS - index)),
      ),
      pendingNoticeRow(101, beforeNow(2 * HOUR_MS)),
    ]);
    const { job, notifier } = createRig({
      notifyFailures: Array.from({ length: 100 }, (_, index) => index + 1),
    });

    await job.run(context);

    expect(notifier.notified).toHaveLength(101);
    expect(await store.find(exportIdOf(101))).toMatchObject({
      noticeStatus: 'requested',
    });
  });

  test('送り直しは100件ずつ最大10回まで行う', async () => {
    await seed(
      Array.from({ length: 1001 }, (_, index) =>
        pendingNoticeRow(index + 1, beforeNow(48 * HOUR_MS - index)),
      ),
    );
    const { job, notifier } = createRig();

    await job.run(context);

    expect(notifier.notified).toHaveLength(1000);
    expect(await store.find(exportIdOf(1001))).toMatchObject({
      noticeStatus: 'pending',
    });
  });

  test('失敗の確定の直後の通知は、同じ起動の送り直しで重ねて依頼しない', async () => {
    await seed([pendingRow(1, beforeNow(STALL_MS + 1))]);
    const { job, notifier } = createRig();

    await job.run(context);

    expect(notifier.notified).toEqual([exportIdOf(1)]);
  });
});

describe('GenerationRecoveryJob(再実行)', () => {
  test('2回目の実行では記録も通知も警告も変わらない', async () => {
    await seed([
      pendingRow(1, beforeNow(STALL_MS + 1)),
      pendingNoticeRow(2, beforeNow(5 * HOUR_MS)),
      pendingNoticeRow(3, beforeNow(HOUR_MS - 1)),
    ]);
    await createRig().job.run(context);
    const afterFirst = await Promise.all(
      [1, 2, 3].map((index) => store.find(exportIdOf(index))),
    );
    const second = createRig();

    await second.job.run(context);

    expect(second.notifier.notified).toEqual([]);
    expect(second.reporter.incidents).toEqual([]);
    expect(
      await Promise.all(
        [1, 2, 3].map((index) => store.find(exportIdOf(index))),
      ),
    ).toEqual(afterFirst);
  });
});
