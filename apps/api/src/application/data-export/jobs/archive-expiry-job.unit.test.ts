import { describe, expect, test } from 'bun:test';

import type {
  DataExportIncident,
  DataExportRecord,
  DataExportStore,
  ExportArchiveStorage,
} from '../../../../lib/core/data-export/ports.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import {
  readyRecordOf,
  recordOf,
  NOW,
} from '../testing/data-export-request-fakes.ts';
import {
  ARCHIVE_EXPIRY_JOB_DEFINITION,
  ArchiveExpiryJob,
} from './archive-expiry-job.ts';

const CONTEXT: ScheduledJobContext = {
  scheduledTime: NOW,
  cron: '21 12 * * *',
  business: toBusinessDateTime(NOW),
};

interface Harness {
  readonly job: ArchiveExpiryJob;
  readonly deleted: string[][];
  readonly aborted: { readonly objectKey: string; readonly uploadId: string }[];
  readonly expired: string[];
  readonly cleared: string[];
  readonly incidents: DataExportIncident[];
  readonly listExpiredCalls: { readonly now: Date; readonly limit: number }[];
}

interface Scenario {
  readonly expiredRecords?: readonly DataExportRecord[];
  readonly failedRecords?: readonly DataExportRecord[];
  readonly failDeletes?: readonly string[];
  readonly failAborts?: readonly string[];
}

// 処理した記録は次の読み取りから外れる、実際の保存先と同じ振る舞いの偽物で組み立てる
function harnessOf(scenario: Scenario): Harness {
  const deleted: string[][] = [];
  const aborted: { objectKey: string; uploadId: string }[] = [];
  const expired: string[] = [];
  const cleared: string[] = [];
  const incidents: DataExportIncident[] = [];
  const listExpiredCalls: { now: Date; limit: number }[] = [];
  const store = {
    listExpired: (input: { now: Date; limit: number }) => {
      listExpiredCalls.push(input);
      return Promise.resolve(
        (scenario.expiredRecords ?? [])
          .filter(({ id }) => !expired.includes(id))
          .slice(0, input.limit),
      );
    },
    markExpired: (id: string) => {
      expired.push(id);
      return Promise.resolve(true);
    },
    listFailedWithUpload: ({ limit }: { limit: number }) =>
      Promise.resolve(
        (scenario.failedRecords ?? [])
          .filter(({ id }) => !cleared.includes(id))
          .slice(0, limit),
      ),
    clearUpload: (id: string) => {
      cleared.push(id);
      return Promise.resolve();
    },
  } as unknown as DataExportStore;
  const storage: ExportArchiveStorage = {
    objectKeyOf: (id) => `data-exports/${id}.zip`,
    beginUpload: () => Promise.reject(new Error('呼ばれない想定です')),
    open: () => Promise.reject(new Error('呼ばれない想定です')),
    delete: (keys) => {
      deleted.push([...keys]);
      return keys.some((key) => scenario.failDeletes?.includes(key))
        ? Promise.reject(new Error('R2の障害'))
        : Promise.resolve();
    },
    abortUpload: (objectKey, uploadId) => {
      aborted.push({ objectKey, uploadId });
      return scenario.failAborts?.includes(uploadId)
        ? Promise.reject(new Error('R2の障害'))
        : Promise.resolve();
    },
  };
  const job = new ArchiveExpiryJob(store, storage, {
    report: (incident) => {
      incidents.push(incident);
    },
  });
  return {
    job,
    deleted,
    aborted,
    expired,
    cleared,
    incidents,
    listExpiredCalls,
  };
}

const EXPIRES_AT = new Date('2026-11-20T00:00:00.000Z');

describe('ArchiveExpiryJob', () => {
  test('定義は4:21に2100の順で、期限切れの要求のZIPを削除して期限切れにし、予定の時刻を期限の基準にする', async () => {
    const records = [
      readyRecordOf('01JE0DXEXPT000000000000001', EXPIRES_AT),
      readyRecordOf('01JE0DXEXPT000000000000002', EXPIRES_AT),
    ];
    const harness = harnessOf({ expiredRecords: records });

    await harness.job.run(CONTEXT);

    expect(ARCHIVE_EXPIRY_JOB_DEFINITION).toMatchObject({
      name: 'data-export.archive-expiry',
      at: { hour: 4, minute: 21 },
      order: 2100,
    });
    expect(harness.deleted).toEqual(
      records.map(({ id }) => [`data-exports/${id}.zip`]),
    );
    expect(harness.expired).toEqual(records.map(({ id }) => id));
    expect(harness.listExpiredCalls[0]?.now).toEqual(NOW);
    expect(harness.incidents).toEqual([]);
  });

  test('オブジェクトの置き場所の無い期限切れの要求は削除を呼ばずに期限切れにする', async () => {
    const harness = harnessOf({
      expiredRecords: [
        readyRecordOf('01JE0DXEXPT000000000000001', EXPIRES_AT, {
          objectKey: null,
        }),
      ],
    });

    await harness.job.run(CONTEXT);

    expect(harness.deleted).toEqual([]);
    expect(harness.expired).toEqual(['01JE0DXEXPT000000000000001']);
  });

  test('削除に失敗した要求は完了のまま残し、成功した要求だけを期限切れにし、失敗の件数を運用者へ知らせる', async () => {
    const records = [
      readyRecordOf('01JE0DXEXPT000000000000001', EXPIRES_AT),
      readyRecordOf('01JE0DXEXPT000000000000002', EXPIRES_AT),
    ];
    const harness = harnessOf({
      expiredRecords: records,
      failDeletes: [records[0]?.objectKey ?? ''],
    });

    await harness.job.run(CONTEXT);

    expect(harness.expired).toEqual(['01JE0DXEXPT000000000000002']);
    expect(harness.incidents).toEqual([
      {
        kind: 'archive-deletion-failed',
        job: 'data-export.archive-expiry',
        count: 1,
      },
    ]);
  });

  test('失敗した要求の未完了のアップロードを破棄して記録の列を消し、置き場所の列が無ければ規約のキーで破棄する', async () => {
    const withKey = recordOf({
      id: '01JE0DXEXPT000000000000001',
      status: 'failed',
      uploadId: 'upload-1',
      objectKey: 'data-exports/kept.zip',
    });
    const withoutKey = recordOf({
      id: '01JE0DXEXPT000000000000002',
      status: 'failed',
      uploadId: 'upload-2',
    });
    const harness = harnessOf({ failedRecords: [withKey, withoutKey] });

    await harness.job.run(CONTEXT);

    expect(harness.aborted).toEqual([
      { objectKey: 'data-exports/kept.zip', uploadId: 'upload-1' },
      {
        objectKey: 'data-exports/01JE0DXEXPT000000000000002.zip',
        uploadId: 'upload-2',
      },
    ]);
    expect(harness.cleared).toEqual([withKey.id, withoutKey.id]);
  });

  test('アップロードの識別子が無い要求は破棄を呼ばずに記録の列だけを消し、破棄に失敗した要求は残して件数に数える', async () => {
    const noUpload = recordOf({
      id: '01JE0DXEXPT000000000000001',
      status: 'failed',
    });
    const broken = recordOf({
      id: '01JE0DXEXPT000000000000002',
      status: 'failed',
      uploadId: 'upload-broken',
    });
    const harness = harnessOf({
      failedRecords: [noUpload, broken],
      failAborts: ['upload-broken'],
    });

    await harness.job.run(CONTEXT);

    expect(harness.cleared).toEqual([noUpload.id]);
    expect(harness.incidents).toEqual([
      {
        kind: 'archive-deletion-failed',
        job: 'data-export.archive-expiry',
        count: 1,
      },
    ]);
  });

  test('削除と破棄の失敗は合算して1回だけ知らせ、対象が無ければ何も知らせない', async () => {
    const expiredRecord = readyRecordOf(
      '01JE0DXEXPT000000000000001',
      EXPIRES_AT,
    );
    const failedRecord = recordOf({
      id: '01JE0DXEXPT000000000000002',
      status: 'failed',
      uploadId: 'upload-broken',
    });
    const harness = harnessOf({
      expiredRecords: [expiredRecord],
      failedRecords: [failedRecord],
      failDeletes: [expiredRecord.objectKey ?? ''],
      failAborts: ['upload-broken'],
    });
    const idle = harnessOf({});

    await harness.job.run(CONTEXT);
    await idle.job.run(CONTEXT);

    expect(harness.incidents).toEqual([
      {
        kind: 'archive-deletion-failed',
        job: 'data-export.archive-expiry',
        count: 2,
      },
    ]);
    expect(idle.incidents).toEqual([]);
  });
});
