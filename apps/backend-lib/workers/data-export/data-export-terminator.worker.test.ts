import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type {
  DataExportNotifier,
  DataExportStore,
  ExportArchiveStorage,
} from '../../core/data-export/ports.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import { D1DataExportStore } from './d1-data-export-store.ts';
import { StoreDataExportTerminator } from './data-export-terminator.ts';
import {
  clearDataExportState,
  daysAfter,
  db,
  exportIdOf,
  expiredColumnsOf,
  failedColumnsOf,
  insertUsers,
  minutesAfter,
  queuedRowOf,
  readyColumnsOf,
  seed,
} from './testing/data-export-fixtures.ts';

const EXPORT = 1;

const OWNER = 1;

const UPLOAD_ID = 'multipart-upload-1';

const OBJECT_KEY = `data-exports/${exportIdOf(EXPORT)}.zip`;

const FAILED_AT = minutesAfter(90);

const TERMINATOR_CATEGORY = 'event.infrastructure.data-export';

const store: DataExportStore = new D1DataExportStore(db);

interface RecordingStorage {
  readonly storage: ExportArchiveStorage;
  readonly aborted: { readonly objectKey: string; readonly uploadId: string }[];
}

function createStorage(failure?: Error): RecordingStorage {
  const aborted: { objectKey: string; uploadId: string }[] = [];
  const unused = () => Promise.reject(new Error('使わない操作'));
  return {
    aborted,
    storage: {
      objectKeyOf: (exportId) => `data-exports/${exportId}.zip`,
      beginUpload: unused,
      open: unused,
      delete: unused,
      abortUpload: (objectKey, uploadId) => {
        aborted.push({ objectKey, uploadId });
        return failure === undefined
          ? Promise.resolve()
          : Promise.reject(failure);
      },
    },
  };
}

interface RecordingNotifier {
  readonly notifier: DataExportNotifier;
  readonly notified: string[];
}

function createNotifier(failure?: Error): RecordingNotifier {
  const notified: string[] = [];
  return {
    notified,
    notifier: {
      notify: (exportId) => {
        notified.push(exportId);
        return failure === undefined
          ? Promise.resolve('requested')
          : Promise.reject(failure);
      },
    },
  };
}

function createTerminator(
  storage: ExportArchiveStorage,
  notifier: DataExportNotifier,
): StoreDataExportTerminator {
  return new StoreDataExportTerminator(store, storage, notifier, 'event');
}

function seedGenerating(withUpload: boolean): Promise<void> {
  return seed([
    queuedRowOf(EXPORT, OWNER, {
      status: 'generating',
      runToken: 'run-token-a',
      leaseExpiresAt: minutesAfter(30),
      attempts: 2,
      ...(withUpload ? { uploadId: UPLOAD_ID, objectKey: OBJECT_KEY } : {}),
    }),
  ]);
}

function failInput(
  notify: boolean,
): Parameters<StoreDataExportTerminator['fail']>[0] {
  return {
    exportId: exportIdOf(EXPORT),
    kind: 'error',
    now: FAILED_AT,
    notify,
  };
}

let logs: LogObject[] = [];

beforeEach(async () => {
  logs = recordLogs('event');
  installRecordingSentry();
  await clearDataExportState();
  await insertUsers([OWNER]);
});

afterEach(() => {
  resetObservability();
});

describe('失敗の確定', () => {
  test('未完了のアップロードを破棄し、失敗の種別と日時を記録して、通知を依頼待ちにして通知を試みる', async () => {
    await seedGenerating(true);
    const { storage, aborted } = createStorage();
    const { notifier, notified } = createNotifier();

    const outcome = await createTerminator(storage, notifier).fail(
      failInput(true),
    );

    expect(outcome).toBe('failed');
    expect(aborted).toStrictEqual([
      { objectKey: OBJECT_KEY, uploadId: UPLOAD_ID },
    ]);
    expect(await store.find(exportIdOf(EXPORT))).toMatchObject({
      status: 'failed',
      failureKind: 'error',
      failedAt: FAILED_AT,
      noticeStatus: 'pending',
    });
    expect(notified).toStrictEqual([exportIdOf(EXPORT)]);
  });

  test('通知しない確定は、通知を送らない扱いにして通知の部品を呼ばない', async () => {
    await seedGenerating(true);
    const { storage } = createStorage();
    const { notifier, notified } = createNotifier();

    const outcome = await createTerminator(storage, notifier).fail(
      failInput(false),
    );

    expect(outcome).toBe('failed');
    expect(await store.find(exportIdOf(EXPORT))).toMatchObject({
      status: 'failed',
      noticeStatus: 'skipped',
    });
    expect(notified).toStrictEqual([]);
  });

  test('アップロードの記録が無い要求は、破棄を呼ばずに失敗を確定する', async () => {
    await seed([queuedRowOf(EXPORT, OWNER)]);
    const { storage, aborted } = createStorage();
    const { notifier } = createNotifier();

    const outcome = await createTerminator(storage, notifier).fail({
      ...failInput(true),
      kind: 'too_large',
    });

    expect(outcome).toBe('failed');
    expect(aborted).toStrictEqual([]);
    expect(await store.find(exportIdOf(EXPORT))).toMatchObject({
      status: 'failed',
      failureKind: 'too_large',
    });
  });

  test('アップロードの破棄に失敗しても、警告を残して失敗を確定し、通知も試みる', async () => {
    await seedGenerating(true);
    const { storage, aborted } = createStorage(new Error('保存先に届かない'));
    const { notifier, notified } = createNotifier();

    const outcome = await createTerminator(storage, notifier).fail(
      failInput(true),
    );

    expect(outcome).toBe('failed');
    expect(aborted).toHaveLength(1);
    expect(await store.find(exportIdOf(EXPORT))).toMatchObject({
      status: 'failed',
      uploadId: UPLOAD_ID,
    });
    expect(notified).toHaveLength(1);
    expect(logs).toStrictEqual([
      expect.objectContaining({
        level: 'warning',
        category: TERMINATOR_CATEGORY,
        exportId: exportIdOf(EXPORT),
      }),
    ]);
  });

  test('通知の失敗は警告に留め、失敗の確定と依頼待ちの状態を残す', async () => {
    await seedGenerating(false);
    const { storage } = createStorage();
    const { notifier } = createNotifier(new Error('メールの基盤が応答しない'));

    const outcome = await createTerminator(storage, notifier).fail(
      failInput(true),
    );

    expect(outcome).toBe('failed');
    expect(await store.find(exportIdOf(EXPORT))).toMatchObject({
      status: 'failed',
      noticeStatus: 'pending',
    });
    expect(logs).toStrictEqual([
      expect.objectContaining({
        level: 'warning',
        category: TERMINATOR_CATEGORY,
        exportId: exportIdOf(EXPORT),
      }),
    ]);
  });

  test.each([
    ['完了', readyColumnsOf(daysAfter(7))],
    ['期限切れ', expiredColumnsOf()],
    ['失敗', failedColumnsOf()],
  ])(
    '%s済みの要求は何も変えず、破棄も通知もしない',
    async (_label, columns) => {
      await seed([queuedRowOf(EXPORT, OWNER, columns)]);
      const before = await store.find(exportIdOf(EXPORT));
      const { storage, aborted } = createStorage();
      const { notifier, notified } = createNotifier();

      const outcome = await createTerminator(storage, notifier).fail(
        failInput(true),
      );

      expect(outcome).toBe('already_finished');
      expect(await store.find(exportIdOf(EXPORT))).toStrictEqual(before);
      expect(aborted).toStrictEqual([]);
      expect(notified).toStrictEqual([]);
    },
  );

  test('記録が無い要求は、何もせずに確定済みとして扱う', async () => {
    const { storage, aborted } = createStorage();
    const { notifier, notified } = createNotifier();

    const outcome = await createTerminator(storage, notifier).fail(
      failInput(true),
    );

    expect(outcome).toBe('already_finished');
    expect(aborted).toStrictEqual([]);
    expect(notified).toStrictEqual([]);
  });

  test('2回続けて確定しても、2回目は確定済みとして扱い、通知は1回だけ依頼する', async () => {
    await seedGenerating(true);
    const { storage, aborted } = createStorage();
    const { notifier, notified } = createNotifier();
    const terminator = createTerminator(storage, notifier);

    const outcomes = [
      await terminator.fail(failInput(true)),
      await terminator.fail(failInput(true)),
    ];

    expect(outcomes).toStrictEqual(['failed', 'already_finished']);
    expect(aborted).toHaveLength(1);
    expect(notified).toHaveLength(1);
  });
});
