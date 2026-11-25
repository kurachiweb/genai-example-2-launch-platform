import { beforeEach, describe, expect, test } from 'vitest';

import type {
  DataExportIncident,
  DataExportIncidentReporter,
  DataExportStore,
  ExportArchiveStorage,
} from '../../../lib/core/data-export/ports.ts';
import type { ScheduledJobContext } from '../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import { D1DataExportStore } from '../../../lib/workers/data-export/d1-data-export-store.ts';
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
} from '../../../lib/workers/data-export/testing/data-export-fixtures.ts';
import {
  ARCHIVE_EXPIRY_JOB_DEFINITION,
  ArchiveExpiryJob,
} from '../../application/data-export/jobs/archive-expiry-job.ts';

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

const uploadIdOf = (index: number): string =>
  `multipart-upload-${String(index)}`;

const hoursFromNow = (hours: number): Date =>
  new Date(SCHEDULED_TIME.getTime() + hours * HOUR_MS);

const readyRow = (index: number, expiresAt: Date) =>
  queuedRowOf(index, OWNER, {
    ...readyColumnsOf(expiresAt),
    objectKey: keyOf(index),
  });

const failedRow = (
  index: number,
  uploadId: string | null = uploadIdOf(index),
) =>
  queuedRowOf(index, OWNER, {
    ...failedColumnsOf(),
    objectKey: uploadId === null ? null : keyOf(index),
    uploadId,
  });

interface RecordingStorage {
  readonly storage: ExportArchiveStorage;
  readonly deleted: string[];
  readonly aborted: { readonly objectKey: string; readonly uploadId: string }[];
}

// 保存先の操作を記録し、指定したオブジェクトの削除と指定したアップロードの破棄だけを失敗させる
function createStorage(
  failures: {
    readonly deleteKeys?: readonly string[];
    readonly abortKeys?: readonly string[];
  } = {},
): RecordingStorage {
  const deleted: string[] = [];
  const aborted: { objectKey: string; uploadId: string }[] = [];
  const unused = () => Promise.reject(new Error('使わない操作'));
  return {
    deleted,
    aborted,
    storage: {
      objectKeyOf: (exportId) => `data-exports/${exportId}.zip`,
      beginUpload: unused,
      open: unused,
      delete: (objectKeys) => {
        if (objectKeys.some((key) => failures.deleteKeys?.includes(key))) {
          return Promise.reject(new Error('R2に接続できません'));
        }
        deleted.push(...objectKeys);
        return Promise.resolve();
      },
      abortUpload: (objectKey, uploadId) => {
        if (failures.abortKeys?.includes(objectKey)) {
          return Promise.reject(new Error('R2に接続できません'));
        }
        aborted.push({ objectKey, uploadId });
        return Promise.resolve();
      },
    },
  };
}

class RecordingIncidentReporter implements DataExportIncidentReporter {
  readonly incidents: DataExportIncident[] = [];

  report(incident: DataExportIncident): void {
    this.incidents.push(incident);
  }
}

interface Rig {
  readonly job: ArchiveExpiryJob;
  readonly storage: RecordingStorage;
  readonly reporter: RecordingIncidentReporter;
}

function createRig(
  failures: Parameters<typeof createStorage>[0] = {},
  records: DataExportStore = store,
): Rig {
  const storage = createStorage(failures);
  const reporter = new RecordingIncidentReporter();
  return {
    job: new ArchiveExpiryJob(records, storage.storage, reporter),
    storage,
    reporter,
  };
}

async function snapshotOf(indexes: readonly number[]) {
  return Promise.all(indexes.map((index) => store.find(exportIdOf(index))));
}

beforeEach(async () => {
  await clearDataExportState();
  await insertUsers([OWNER]);
});

describe('ArchiveExpiryJobの定義', () => {
  test('業務時刻4:21の起動に、順序2100で登録する名前の定義を持つ', () => {
    expect(ARCHIVE_EXPIRY_JOB_DEFINITION).toMatchObject({
      name: 'data-export.archive-expiry',
      at: { hour: 4, minute: 21 },
      order: 2100,
    });
  });
});

describe('ArchiveExpiryJob(期限を過ぎた完了のZIPの削除)', () => {
  test('期限を過ぎた完了のオブジェクトを削除して期限切れにし、記録は削除せず名前と大きさを残す', async () => {
    await seed([readyRow(1, hoursFromNow(-1)), readyRow(2, SCHEDULED_TIME)]);
    const { job, storage, reporter } = createRig();

    await job.run(context);

    expect(storage.deleted.toSorted()).toEqual([keyOf(1), keyOf(2)]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'expired',
      objectKey: null,
      fileName: 'launch-stadium-export.zip',
      byteSize: 1024,
    });
    expect(await store.find(exportIdOf(2))).toMatchObject({
      status: 'expired',
      objectKey: null,
    });
    expect(reporter.incidents).toEqual([]);
  });

  test('期限の前の完了は削除も変更もしない', async () => {
    await seed([readyRow(1, new Date(SCHEDULED_TIME.getTime() + 1))]);
    const before = await snapshotOf([1]);
    const { job, storage } = createRig();

    await job.run(context);

    expect(storage.deleted).toEqual([]);
    expect(await snapshotOf([1])).toEqual(before);
  });

  test('作成中・失敗・期限切れの記録は、期限の列があっても削除の対象にしない', async () => {
    await seed([
      queuedRowOf(1, OWNER, { expiresAt: hoursFromNow(-5) }),
      queuedRowOf(2, OWNER, {
        ...failedColumnsOf(),
        expiresAt: hoursFromNow(-5),
        objectKey: keyOf(2),
      }),
      queuedRowOf(3, OWNER, expiredColumnsOf()),
    ]);
    const before = await snapshotOf([1, 2, 3]);
    const { job, storage } = createRig();

    await job.run(context);

    expect(storage.deleted).toEqual([]);
    expect(await snapshotOf([1, 2, 3])).toEqual(before);
  });

  test('オブジェクトが保存先に無い完了も、削除を成功として期限切れにする', async () => {
    await seed([readyRow(1, hoursFromNow(-1))]);
    const { job, storage } = createRig();

    await job.run(context);

    expect(storage.deleted).toEqual([keyOf(1)]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'expired',
      objectKey: null,
    });
  });

  test('1件の削除が失敗しても、その記録を完了のまま残して次の記録へ進み、失敗した件数を1回だけエラートラッキングへ渡す', async () => {
    await seed([
      readyRow(1, hoursFromNow(-3)),
      readyRow(2, hoursFromNow(-2)),
      readyRow(3, hoursFromNow(-1)),
    ]);
    const { job, storage, reporter } = createRig({ deleteKeys: [keyOf(2)] });

    await job.run(context);

    expect(storage.deleted).toEqual([keyOf(1), keyOf(3)]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'expired',
    });
    expect(await store.find(exportIdOf(2))).toMatchObject({
      status: 'ready',
      objectKey: keyOf(2),
    });
    expect(await store.find(exportIdOf(3))).toMatchObject({
      status: 'expired',
    });
    expect(reporter.incidents).toEqual([
      {
        kind: 'archive-deletion-failed',
        job: 'data-export.archive-expiry',
        count: 1,
      },
    ]);
  });

  test('先頭の100件の削除が失敗し続けても、同じ起動の後ろの記録を期限切れにする', async () => {
    const stuckKeys = Array.from({ length: 100 }, (_, index) =>
      keyOf(index + 1),
    );
    await seed([
      ...stuckKeys.map((_, index) => readyRow(index + 1, hoursFromNow(-48))),
      readyRow(101, hoursFromNow(-1)),
      readyRow(102, hoursFromNow(-1)),
    ]);
    const { job, storage, reporter } = createRig({ deleteKeys: stuckKeys });

    await job.run(context);

    expect(storage.deleted).toEqual([keyOf(101), keyOf(102)]);
    expect(await store.find(exportIdOf(101))).toMatchObject({
      status: 'expired',
    });
    expect(await store.find(exportIdOf(102))).toMatchObject({
      status: 'expired',
    });
    expect(await store.find(exportIdOf(1))).toMatchObject({ status: 'ready' });
    expect(reporter.incidents).toEqual([
      {
        kind: 'archive-deletion-failed',
        job: 'data-export.archive-expiry',
        count: 100,
      },
    ]);
  });

  test('期限切れの削除は100件ずつ最大10回まで行い、残りを翌日の起動に任せる', async () => {
    await seed(
      Array.from({ length: 1001 }, (_, index) =>
        readyRow(index + 1, hoursFromNow(-1)),
      ),
    );
    const limits: number[] = [];
    const recording: DataExportStore = new Proxy(store, {
      get: (target, property, receiver) => {
        if (property === 'listExpired') {
          return (input: Parameters<DataExportStore['listExpired']>[0]) => {
            limits.push(input.limit);
            return target.listExpired(input);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const { job, storage } = createRig({}, recording);

    await job.run(context);

    expect(limits).toEqual(Array.from({ length: 10 }, () => 100));
    expect(storage.deleted).toHaveLength(1000);
    expect(await store.find(exportIdOf(1001))).toMatchObject({
      status: 'ready',
    });

    await job.run(context);

    expect(storage.deleted).toHaveLength(1001);
    expect(await store.find(exportIdOf(1001))).toMatchObject({
      status: 'expired',
    });
  });
});

describe('ArchiveExpiryJob(失敗の記録に残る未完了のアップロードの破棄)', () => {
  test('アップロードが残る失敗の記録だけアップロードを破棄して記録から外し、記録は削除せず失敗のまま残す', async () => {
    await seed([
      failedRow(1),
      failedRow(2, null),
      queuedRowOf(3, OWNER, { uploadId: uploadIdOf(3), objectKey: keyOf(3) }),
    ]);
    const { job, storage } = createRig();

    await job.run(context);

    expect(storage.aborted).toEqual([
      { objectKey: keyOf(1), uploadId: uploadIdOf(1) },
    ]);
    expect(storage.deleted).toEqual([]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'failed',
      uploadId: null,
      failureKind: 'error',
    });
    expect(await store.find(exportIdOf(2))).toMatchObject({
      status: 'failed',
      uploadId: null,
    });
    expect(await store.find(exportIdOf(3))).toMatchObject({
      status: 'queued',
      uploadId: uploadIdOf(3),
    });
  });

  test('アップロードの破棄が失敗した記録はアップロードを残して次の記録へ進み、失敗した件数をエラートラッキングへ渡す', async () => {
    await seed([failedRow(1), failedRow(2), failedRow(3)]);
    const { job, storage, reporter } = createRig({ abortKeys: [keyOf(2)] });

    await job.run(context);

    expect(storage.aborted.map(({ objectKey }) => objectKey)).toEqual([
      keyOf(1),
      keyOf(3),
    ]);
    expect(await store.find(exportIdOf(1))).toMatchObject({ uploadId: null });
    expect(await store.find(exportIdOf(2))).toMatchObject({
      uploadId: uploadIdOf(2),
    });
    expect(await store.find(exportIdOf(3))).toMatchObject({ uploadId: null });
    expect(reporter.incidents).toEqual([
      {
        kind: 'archive-deletion-failed',
        job: 'data-export.archive-expiry',
        count: 1,
      },
    ]);
  });

  test('期限切れの削除の失敗とアップロードの破棄の失敗は、合わせた件数を1回だけ渡す', async () => {
    await seed([readyRow(1, hoursFromNow(-1)), failedRow(2)]);
    const { job, reporter } = createRig({
      deleteKeys: [keyOf(1)],
      abortKeys: [keyOf(2)],
    });

    await job.run(context);

    expect(reporter.incidents).toEqual([
      {
        kind: 'archive-deletion-failed',
        job: 'data-export.archive-expiry',
        count: 2,
      },
    ]);
  });

  test('アップロードの破棄は100件ずつ最大10回まで行う', async () => {
    await seed(
      Array.from({ length: 1001 }, (_, index) => failedRow(index + 1)),
    );
    const limits: number[] = [];
    const recording: DataExportStore = new Proxy(store, {
      get: (target, property, receiver) => {
        if (property === 'listFailedWithUpload') {
          return (
            input: Parameters<DataExportStore['listFailedWithUpload']>[0],
          ) => {
            limits.push(input.limit);
            return target.listFailedWithUpload(input);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const { job, storage } = createRig({}, recording);

    await job.run(context);

    expect(limits.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 100));
    expect(storage.aborted).toHaveLength(1000);
    expect(await store.find(exportIdOf(1001))).toMatchObject({
      uploadId: uploadIdOf(1001),
    });
  });
});

describe('ArchiveExpiryJob(再実行)', () => {
  test('2回目の実行では何も削除も破棄もせず、記録も変わらない', async () => {
    await seed([
      readyRow(1, hoursFromNow(-1)),
      readyRow(2, hoursFromNow(1)),
      failedRow(3),
    ]);
    const first = createRig();
    await first.job.run(context);
    const afterFirst = await snapshotOf([1, 2, 3]);
    const second = createRig();

    await second.job.run(context);

    expect(second.storage.deleted).toEqual([]);
    expect(second.storage.aborted).toEqual([]);
    expect(second.reporter.incidents).toEqual([]);
    expect(await snapshotOf([1, 2, 3])).toEqual(afterFirst);
  });

  test('削除に失敗した記録は、保存先が戻った次の実行で期限切れにする', async () => {
    await seed([readyRow(1, hoursFromNow(-1))]);
    await createRig({ deleteKeys: [keyOf(1)] }).job.run(context);
    const retry = createRig();

    await retry.job.run(context);

    expect(retry.storage.deleted).toEqual([keyOf(1)]);
    expect(await store.find(exportIdOf(1))).toMatchObject({
      status: 'expired',
    });
  });
});

describe('ArchiveExpiryJob(記録の読み書きの失敗)', () => {
  test('記録の読み取りの例外は握りつぶさず、そのまま投げる', async () => {
    const broken: DataExportStore = new Proxy(store, {
      get: (target, property, receiver) =>
        property === 'listExpired'
          ? () => Promise.reject(new Error('D1に接続できません'))
          : (Reflect.get(target, property, receiver) as unknown),
    });
    const { job } = createRig({}, broken);

    await expect(job.run(context)).rejects.toThrow('D1に接続できません');
  });
});
